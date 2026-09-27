package nano.lin.terminal;

import org.junit.jupiter.api.Test;
import java.nio.charset.StandardCharsets;
import static org.junit.jupiter.api.Assertions.*;

class TerminalStateTest {
    private static void write(TerminalState terminal, String text) { terminal.write(text.getBytes(StandardCharsets.UTF_8)); }

    @Test
    void restoresColorsCursorTitleAndAlternateScreen() {
        try (var terminal = new TerminalState(80, 24); var restored = new TerminalState(80, 24)) {
            write(terminal, "shell history\r\n\033]2;editor\007\033[?1049h\033[2J\033[4;6H\033[31m编辑器\033[?2004h");
            var snapshot = terminal.snapshot();
            assertEquals("editor", snapshot.title());
            assertTrue(snapshot.content().contains("shell history"));
            assertTrue(snapshot.content().contains("编辑器"));
            assertTrue(snapshot.content().contains("\033[?1049h"));
            assertTrue(snapshot.content().contains("\033[?2004h"));
            write(restored, snapshot.content());
            assertEquals(snapshot.content(), restored.snapshot().content());
            write(terminal, "!\033[?1049l\r\ncontinued");
            write(restored, "!\033[?1049l\r\ncontinued");
            assertEquals(terminal.snapshot().content(), restored.snapshot().content());
        }
    }

    @Test
    void restoresSavedCursorMarginsAndPendingWrap() {
        for (String input : new String[]{
            "\033[3;4H\033[32m\0337\033[10;8H\033[31mhello",
            "\033[2;20r\033[?6h\033[4;8Hregion",
            "x".repeat(80),
        }) {
            try (var original = new TerminalState(80, 24); var restored = new TerminalState(80, 24)) {
                write(original, input);
                write(restored, original.snapshot().content());
                write(original, "!\0338next");
                write(restored, "!\0338next");
                assertEquals(original.snapshot().content(), restored.snapshot().content());
            }
        }
    }

    @Test
    void boundsScrollbackAndPreservesSplitUtf8() {
        try (var terminal = new TerminalState(80, 24)) {
            write(terminal, "discard-me\r\n" + "line\r\n".repeat(10_050));
            byte[] chinese = "中文".getBytes(StandardCharsets.UTF_8);
            terminal.write(new byte[]{chinese[0], chinese[1]});
            terminal.write(java.util.Arrays.copyOfRange(chinese, 2, chinese.length));
            var snapshot = terminal.snapshot();
            assertFalse(snapshot.content().contains("discard-me"));
            assertTrue(snapshot.content().contains("中文"));
            assertTrue(snapshot.content().length() < 100_000);
        }
    }

    @Test
    void preservesDimensionsAndCarriageReturnUpdates() {
        try (var terminal = new TerminalState(80, 24)) {
            terminal.resize(100, 30);
            write(terminal, "progress 10%\rprogress 90%");
            var snapshot = terminal.snapshot();
            assertEquals(100, snapshot.cols());
            assertEquals(30, snapshot.rows());
            assertTrue(snapshot.content().contains("progress 90%"));
            assertFalse(snapshot.content().contains("progress 10%"));
        }
    }
}
