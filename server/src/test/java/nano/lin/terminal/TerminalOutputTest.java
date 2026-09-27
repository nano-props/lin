package nano.lin.terminal;

import org.junit.jupiter.api.Test;
import java.nio.charset.StandardCharsets;
import static org.junit.jupiter.api.Assertions.*;

class TerminalOutputTest {
    private static String accept(TerminalOutput output, String text) {
        var bytes = text.getBytes(StandardCharsets.UTF_8);
        return new String(output.accept(bytes, bytes.length), StandardCharsets.UTF_8);
    }

    @Test
    void holdsSplitControlSequencesUntilSafeToSnapshot() {
        var output = new TerminalOutput();
        assertEquals("hello", accept(output, "hello\033[31"));
        assertEquals("\033[31mred", accept(output, "mred\033]2;ti"));
        assertEquals("", accept(output, "tle\033"));
        assertEquals("\033]2;title\033\\done", accept(output, "\\done"));
    }

    @Test
    void holdsSplitUtf8AndEightBitControlSequences() {
        var output = new TerminalOutput();
        var bytes = "中".getBytes(StandardCharsets.UTF_8);
        assertEquals(0, output.accept(new byte[]{bytes[0], bytes[1]}, 2).length);
        assertArrayEquals(bytes, output.accept(new byte[]{bytes[2]}, 1));
        assertEquals("", accept(output, "\u009b31"));
        assertEquals("\u009b31m", accept(output, "m"));
    }

    @Test
    void ignoresOversizedControlStringsAndResumesAfterTerminator() {
        var output = new TerminalOutput();
        assertEquals("", accept(output, "\033]2;" + "a".repeat(1_100_000)));
        assertEquals("ok", accept(output, "\007ok"));
    }
}
