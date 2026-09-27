package nano.lin.terminal;

import org.graalvm.polyglot.Context;
import org.graalvm.polyglot.Engine;
import org.graalvm.polyglot.Source;
import org.graalvm.polyglot.Value;

import java.io.IOException;
import java.nio.charset.StandardCharsets;

/** Server-owned xterm screen and bounded scrollback; callers serialize access. */
public final class TerminalState implements AutoCloseable {
    private static final Engine ENGINE = Engine.create();
    private static final Source SOURCE = loadSource();
    private final Context context;
    private final Value terminal;
    private int cols;
    private int rows;

    public TerminalState(int cols, int rows) {
        this.cols = cols;
        this.rows = rows;
        context = Context.newBuilder("js").engine(ENGINE).build();
        context.eval(SOURCE);
        terminal = context.getBindings("js").getMember("createTerminalState").execute(cols, rows);
    }

    public void write(byte[] bytes) {
        // Preserve arbitrary UTF-8 chunk boundaries: xterm owns the decoder.
        terminal.invokeMember("write", new String(bytes, StandardCharsets.ISO_8859_1));
    }

    public byte[] replies() {
        return terminal.invokeMember("replies").asString().getBytes(StandardCharsets.UTF_8);
    }

    public int cols() { return cols; }
    public int rows() { return rows; }

    public void resize(int cols, int rows) {
        terminal.invokeMember("resize", cols, rows);
        this.cols = cols;
        this.rows = rows;
    }

    public Snapshot snapshot() {
        return new Snapshot(cols, rows, terminal.invokeMember("snapshot").asString(), terminal.invokeMember("title").asString());
    }

    @Override
    public void close() {
        terminal.invokeMember("dispose");
        context.close();
    }

    private static Source loadSource() {
        try (var input = TerminalState.class.getResourceAsStream("/terminal/terminal-state.js")) {
            if (input == null) throw new IOException("embedded terminal model is missing");
            return Source.newBuilder("js", new String(input.readAllBytes(), StandardCharsets.UTF_8), "terminal-state.js").build();
        } catch (IOException error) {
            throw new ExceptionInInitializerError(error);
        }
    }

    public record Snapshot(int cols, int rows, String content, String title) {}
}
