package nano.lin.server;

import nano.lin.pty.PtySession;

import java.io.ByteArrayOutputStream;
import java.io.DataInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.Base64;
import java.util.concurrent.atomic.AtomicBoolean;

final class WebSocketConnection {
    private static final String WEBSOCKET_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
    private static final int MAX_MESSAGE_BYTES = 1024 * 1024;

    private final DataInputStream input;
    private final OutputStream output;
    private final Object outputLock = new Object();
    private final AtomicBoolean open = new AtomicBoolean(true);

    private WebSocketConnection(InputStream input, OutputStream output) {
        this.input = new DataInputStream(input);
        this.output = output;
    }

    static WebSocketConnection accept(InputStream input, OutputStream output, String key) throws IOException {
        String accept = acceptKey(key);
        String response = "HTTP/1.1 101 Switching Protocols\r\n"
            + "Upgrade: websocket\r\n"
            + "Connection: Upgrade\r\n"
            + "Sec-WebSocket-Accept: " + accept + "\r\n\r\n";
        output.write(response.getBytes(StandardCharsets.US_ASCII));
        output.flush();
        return new WebSocketConnection(input, output);
    }

    void run(PtySession session) throws IOException {
        session.start(80, 24);
        ByteArrayOutputStream fragmented = null;
        int fragmentedOpcode = -1;

        try {
            while (open.get()) {
                Frame frame = readFrame();
                if (frame.opcode == 0x8) {
                    sendClose(frame.payload);
                    return;
                }
                if (frame.opcode == 0x9) {
                    sendFrame(0xA, frame.payload);
                    continue;
                }
                if (frame.opcode == 0xA) continue;

                if (frame.opcode == 0x0) {
                    if (fragmented == null) throw new IOException("unexpected continuation frame");
                    append(fragmented, frame.payload);
                    if (frame.finished) {
                        handleMessage(fragmentedOpcode, fragmented.toByteArray(), session);
                        fragmented = null;
                        fragmentedOpcode = -1;
                    }
                    continue;
                }
                if (frame.opcode != 0x1 && frame.opcode != 0x2) throw new IOException("unsupported WebSocket opcode");
                if (fragmented != null) throw new IOException("interleaved fragmented message");
                if (frame.finished) {
                    handleMessage(frame.opcode, frame.payload, session);
                } else {
                    fragmented = new ByteArrayOutputStream();
                    fragmentedOpcode = frame.opcode;
                    append(fragmented, frame.payload);
                }
            }
        } finally {
            open.set(false);
        }
    }

    void sendBinary(byte[] bytes) {
        if (!open.get()) return;
        try {
            sendFrame(0x2, bytes);
        } catch (IOException error) {
            open.set(false);
        }
    }

    void sendExit(int exitCode) {
        if (!open.get()) return;
        ByteBuffer payload = ByteBuffer.allocate(5);
        payload.put((byte)2).putInt(exitCode);
        sendBinary(payload.array());
        try {
            sendClose(closePayload(1000, "shell exited"));
        } catch (IOException ignored) {
            open.set(false);
        }
    }

    private void handleMessage(int opcode, byte[] payload, PtySession session) throws IOException {
        if (opcode != 0x2 || payload.length == 0) throw new IOException("binary terminal message required");
        switch (payload[0]) {
            case 0 -> session.write(payload, 1, payload.length - 1);
            case 1 -> {
                if (payload.length != 5) throw new IOException("invalid resize message");
                ByteBuffer size = ByteBuffer.wrap(payload, 1, 4);
                int cols = Short.toUnsignedInt(size.getShort());
                int rows = Short.toUnsignedInt(size.getShort());
                if (cols < 2 || cols > 1000 || rows < 1 || rows > 1000) {
                    throw new IOException("terminal size is out of range");
                }
                session.resize(cols, rows);
            }
            default -> throw new IOException("unknown terminal message");
        }
    }

    private Frame readFrame() throws IOException {
        int first = input.readUnsignedByte();
        int second = input.readUnsignedByte();
        boolean finished = (first & 0x80) != 0;
        int opcode = first & 0x0F;
        boolean masked = (second & 0x80) != 0;
        if (!masked) throw new IOException("client WebSocket frames must be masked");

        long length = second & 0x7F;
        if (length == 126) length = input.readUnsignedShort();
        else if (length == 127) {
            length = input.readLong();
            if (length < 0) throw new IOException("invalid WebSocket frame length");
        }
        if (length > MAX_MESSAGE_BYTES) throw new IOException("WebSocket message is too large");
        if (opcode >= 0x8 && (!finished || length > 125)) throw new IOException("invalid WebSocket control frame");

        byte[] mask = input.readNBytes(4);
        if (mask.length != 4) throw new IOException("truncated WebSocket mask");
        byte[] payload = input.readNBytes((int)length);
        if (payload.length != length) throw new IOException("truncated WebSocket frame");
        for (int index = 0; index < payload.length; index++) payload[index] ^= mask[index & 3];
        return new Frame(finished, opcode, payload);
    }

    private void sendClose(byte[] payload) throws IOException {
        if (!open.compareAndSet(true, false)) return;
        sendFrameUnchecked(0x8, payload);
    }

    private void sendFrame(int opcode, byte[] payload) throws IOException {
        if (!open.get()) throw new IOException("WebSocket is closed");
        sendFrameUnchecked(opcode, payload);
    }

    private void sendFrameUnchecked(int opcode, byte[] payload) throws IOException {
        synchronized (outputLock) {
            output.write(0x80 | opcode);
            if (payload.length <= 125) {
                output.write(payload.length);
            } else if (payload.length <= 65_535) {
                output.write(126);
                output.write((payload.length >>> 8) & 0xFF);
                output.write(payload.length & 0xFF);
            } else {
                output.write(127);
                output.write(new byte[]{0, 0, 0, 0});
                output.write(ByteBuffer.allocate(4).putInt(payload.length).array());
            }
            output.write(payload);
            output.flush();
        }
    }

    private static void append(ByteArrayOutputStream destination, byte[] bytes) throws IOException {
        if (destination.size() + bytes.length > MAX_MESSAGE_BYTES) throw new IOException("WebSocket message is too large");
        destination.write(bytes);
    }

    private static String acceptKey(String key) throws IOException {
        try {
            byte[] digest = MessageDigest.getInstance("SHA-1")
                .digest((key.trim() + WEBSOCKET_GUID).getBytes(StandardCharsets.US_ASCII));
            return Base64.getEncoder().encodeToString(digest);
        } catch (NoSuchAlgorithmException error) {
            throw new IOException("SHA-1 is unavailable", error);
        }
    }

    private static byte[] closePayload(int code, String reason) {
        byte[] text = reason.getBytes(StandardCharsets.UTF_8);
        return ByteBuffer.allocate(2 + text.length).putShort((short)code).put(text).array();
    }

    private record Frame(boolean finished, int opcode, byte[] payload) {}
}
