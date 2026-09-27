package nano.lin.pty;

import nano.lin.terminal.TerminalState;
import nano.lin.terminal.TerminalOutput;

import java.io.IOException;
import java.util.LinkedHashSet;
import java.util.Set;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.function.Consumer;
import java.util.function.BiConsumer;
import java.util.function.IntConsumer;

public final class PtySession implements AutoCloseable {
    private static final int SIGHUP = 1;
    private final IntConsumer exited;
    private final AtomicBoolean alive = new AtomicBoolean();
    private final AtomicBoolean fdClosed = new AtomicBoolean();
    private final Object writeLock = new Object();
    private final Object stateLock = new Object();
    private final Set<Attachment> attachments = new LinkedHashSet<>();
    private volatile int masterFd = -1;
    private volatile int pid = -1;
    private volatile String processName = "shell";
    private TerminalState screen;
    private final TerminalOutput outputFrames = new TerminalOutput();
    private boolean started;
    private boolean closed;

    public PtySession(IntConsumer exited) { this.exited = exited; }

    public void start(int cols, int rows) throws IOException {
        synchronized (stateLock) {
            if (closed) throw new IOException("terminal session has closed");
            if (started) return;
            screen = new TerminalState(cols, rows);
            try {
                var process = PtyNative.spawn(cols, rows);
                masterFd = process.masterFd();
                pid = process.pid();
                processName = process.processName();
            } catch (IOException | RuntimeException error) {
                screen.close();
                screen = null;
                throw error;
            }
            alive.set(true);
            started = true;
            // Blocking FFM calls pin virtual threads; use dedicated reader/waiter threads.
            Thread.ofPlatform().name("lin-pty-output-" + pid).daemon(true).start(this::readOutput);
            Thread.ofPlatform().name("lin-pty-wait-" + pid).daemon(true).start(this::waitForExit);
        }
    }

    public String processName() { return processName; }
    public boolean isAlive() { return alive.get(); }

    public Attachment attach(Consumer<TerminalState.Snapshot> snapshot, Consumer<byte[]> output, BiConsumer<Integer, Integer> resize, IntConsumer exit) throws IOException {
        synchronized (stateLock) {
            if (closed || !alive.get()) throw new IOException("terminal session has exited");
            var next = new Attachment(output, resize, exit);
            // Snapshot precedes all live output, at the same parser boundary.
            snapshot.accept(screen.snapshot());
            attachments.add(next);
            return next;
        }
    }

    public void detach(Attachment attached) {
        synchronized (stateLock) { attachments.remove(attached); }
    }

    public void write(byte[] bytes, int offset, int length) throws IOException {
        synchronized (writeLock) {
            if (!alive.get()) throw new IOException("terminal process has exited");
            PtyNative.write(masterFd, bytes, offset, length);
        }
    }

    public void resize(int cols, int rows) throws IOException {
        synchronized (stateLock) {
            if (closed || !alive.get()) return;
            if (screen.cols() == cols && screen.rows() == rows) return;
            screen.resize(cols, rows);
            PtyNative.resize(masterFd, cols, rows);
            for (var attachment : attachments) attachment.resize.accept(cols, rows);
        }
    }

    private void readOutput() {
        var buffer = new byte[16 * 1024];
        try {
            while (alive.get()) {
                var count = PtyNative.read(masterFd, buffer);
                if (count < 0) return;
                synchronized (stateLock) {
                    if (closed) return;
                    var bytes = outputFrames.accept(buffer, count);
                    if (bytes.length == 0) continue;
                    screen.write(bytes);
                    var replies = screen.replies();
                    if (replies.length > 0) write(replies, 0, replies.length);
                    for (var attachment : attachments) attachment.output.accept(bytes);
                }
            }
        } catch (IOException ignored) {
            // The waiter owns the authoritative exit notification.
        }
    }

    private void waitForExit() {
        var exitCode = 255;
        try { exitCode = PtyNative.waitFor(pid); }
        catch (IOException ignored) { /* Preserve a failure code for an unexpected wait error. */ }
        finally {
            alive.set(false);
            closeFileDescriptor();
            finish(exitCode);
            exited.accept(exitCode);
        }
    }

    private void finish(int exitCode) {
        synchronized (stateLock) {
            if (closed) return;
            closed = true;
            for (var attachment : attachments) attachment.exit.accept(exitCode);
            attachments.clear();
            if (screen != null) { screen.close(); screen = null; }
        }
    }

    private void closeFileDescriptor() {
        synchronized (writeLock) {
            if (masterFd >= 0 && fdClosed.compareAndSet(false, true)) PtyNative.close(masterFd);
        }
    }

    @Override
    public void close() {
        synchronized (stateLock) {
            if (closed) return;
            if (alive.getAndSet(false)) {
                try { PtyNative.signal(pid, SIGHUP); }
                catch (IOException ignored) { /* The child may already have exited. */ }
            }
            finish(129);
        }
    }

    public static final class Attachment {
        private final Consumer<byte[]> output;
        private final IntConsumer exit;
        private final BiConsumer<Integer, Integer> resize;
        private Attachment(Consumer<byte[]> output, BiConsumer<Integer, Integer> resize, IntConsumer exit) {
            this.output = output;
            this.resize = resize;
            this.exit = exit;
        }
    }
}
