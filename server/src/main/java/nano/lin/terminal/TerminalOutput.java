package nano.lin.terminal;

import java.io.ByteArrayOutputStream;

/** Frames output at UTF-8 / VT sequence boundaries, so reconnect never loses a parser prefix. */
public final class TerminalOutput {
    private static final int MAX_SEQUENCE_BYTES = 1_048_576;
    private enum State { TEXT, ESCAPE, CSI, STRING, STRING_ESCAPE }
    private State state = State.TEXT;
    private final ByteArrayOutputStream pending = new ByteArrayOutputStream();
    private int remainingUtf8;
    private int codepoint;
    private boolean osc;
    private boolean discarding;

    public byte[] accept(byte[] bytes, int length) {
        var complete = new ByteArrayOutputStream(length);
        for (int i = 0; i < length; i++) {
            int value = Byte.toUnsignedInt(bytes[i]);
            if (state == State.TEXT && remainingUtf8 == 0 && pending.size() == 0 && value < 0x80 && value != 0x1b) {
                complete.write(value);
                continue;
            }
            if (!discarding) pending.write(value);
            if (remainingUtf8 > 0 && (value & 0xc0) == 0x80) {
                codepoint = (codepoint << 6) | (value & 0x3f);
                if (--remainingUtf8 > 0) continue;
                advance(codepoint);
            } else if (value >= 0xc2 && value <= 0xf4) {
                remainingUtf8 = value < 0xe0 ? 1 : value < 0xf0 ? 2 : 3;
                codepoint = value & (remainingUtf8 == 1 ? 0x1f : remainingUtf8 == 2 ? 0x0f : 0x07);
                continue;
            } else {
                remainingUtf8 = 0;
                advance(value < 0x80 ? value : 0xfffd);
            }
            if (state == State.TEXT) {
                if (!discarding) complete.writeBytes(pending.toByteArray());
                pending.reset();
                discarding = false;
            } else if (pending.size() > MAX_SEQUENCE_BYTES) {
                // Ignore oversized, incomplete control strings rather than growing without bound.
                pending.reset();
                discarding = true;
            }
        }
        return complete.toByteArray();
    }

    private void advance(int value) {
        if (value == 0x18 || value == 0x1a) { state = State.TEXT; return; }
        if (state == State.STRING || state == State.STRING_ESCAPE) {
            if (value == 0x9c || (osc && value == 7) || (state == State.STRING_ESCAPE && value == '\\')) {
                state = State.TEXT;
            } else {
                state = value == 0x1b ? State.STRING_ESCAPE : State.STRING;
            }
            return;
        }
        if (value == 0x1b) { state = State.ESCAPE; return; }
        if (value == 0x9b) { state = State.CSI; return; }
        if (value == 0x9d || value == 0x90 || value == 0x98 || value == 0x9e || value == 0x9f) {
            osc = value == 0x9d;
            state = State.STRING;
            return;
        }
        if (state == State.ESCAPE) {
            if (value == '[') state = State.CSI;
            else if (value == ']' || value == 'P' || value == 'X' || value == '^' || value == '_') {
                osc = value == ']';
                state = State.STRING;
            } else if (value >= 0x30 && value <= 0x7e) state = State.TEXT;
        } else if (state == State.CSI && value >= 0x40 && value <= 0x7e) {
            state = State.TEXT;
        }
    }
}
