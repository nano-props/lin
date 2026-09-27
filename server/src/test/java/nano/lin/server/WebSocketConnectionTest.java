package nano.lin.server;

import org.junit.jupiter.api.Test;
import java.io.ByteArrayInputStream;
import java.io.OutputStream;
import java.io.IOException;
import java.net.Socket;
import java.time.Duration;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import static org.junit.jupiter.api.Assertions.*;

import static org.junit.jupiter.api.Assertions.assertArrayEquals;

class WebSocketConnectionTest {
    @Test
    void prefixesTerminalOutputSoItCannotCollideWithExitMessages() {
        assertArrayEquals(
            new byte[]{0, 2, 0, 0, 0, 7},
            WebSocketConnection.terminalOutputPayload(new byte[]{2, 0, 0, 0, 7})
        );
    }

    @Test
    void encodesProcessNameMetadata() {
        assertArrayEquals(new byte[]{3, 'b', 'a', 's', 'h'}, WebSocketConnection.metadataPayload("bash"));
    }
    @Test
    void disconnectsBlockedViewerWithoutBlockingTerminalOutput() throws Exception {
        var writing = new CountDownLatch(1);
        var released = new CountDownLatch(1);
        var block = new AtomicBoolean();
        var closed = new AtomicBoolean();
        var socket = new Socket() {
            @Override public synchronized void close() {
                closed.set(true);
                released.countDown();
            }
        };
        var output = new OutputStream() {
            @Override public void write(int value) throws IOException {
                if (!block.get()) return;
                writing.countDown();
                try {
                    if (!released.await(5, TimeUnit.SECONDS)) throw new IOException("blocked writer timed out");
                } catch (InterruptedException error) {
                    Thread.currentThread().interrupt();
                    throw new IOException(error);
                }
            }
        };
        try {
            var connection = WebSocketConnection.accept(socket, new ByteArrayInputStream(new byte[0]), output, "test-key");
            block.set(true);
            connection.sendOutput(new byte[]{1});
            assertTrue(writing.await(2, TimeUnit.SECONDS));
            assertTimeoutPreemptively(Duration.ofSeconds(2), () -> {
                for (int index = 0; index < 300; index++) connection.sendOutput(new byte[16 * 1024]);
            });
            assertTrue(closed.get(), "a blocked viewer must be disconnected when its queue fills");
        } finally {
            socket.close();
        }
    }
}
