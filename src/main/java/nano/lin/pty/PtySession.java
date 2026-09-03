package nano.lin.pty;

import java.io.IOException;
import java.util.Arrays;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.function.Consumer;
import java.util.function.IntConsumer;

public final class PtySession implements AutoCloseable {
    private static final int SIGHUP = 1;

    private final Consumer<byte[]> output;
    private final IntConsumer exited;
    private final AtomicBoolean started = new AtomicBoolean();
    private final AtomicBoolean alive = new AtomicBoolean();
    private final AtomicBoolean fdClosed = new AtomicBoolean();
    private final Object writeLock = new Object();
    private volatile int masterFd = -1;
    private volatile int pid = -1;
    private volatile String processName = "shell";

    public PtySession(Consumer<byte[]> output, IntConsumer exited) {
        this.output = output;
        this.exited = exited;
    }

    public void start(int cols, int rows) throws IOException {
        if (!started.compareAndSet(false, true)) throw new IllegalStateException("PTY session already started");
        PtyNative.SpawnResult process = PtyNative.spawn(cols, rows);
        masterFd = process.masterFd();
        pid = process.pid();
        processName = process.processName();
        alive.set(true);
        // A blocking FFM downcall pins a virtual thread's carrier. Dedicated platform
        // threads keep multiple PTYs from starving the WebSocket virtual threads.
        Thread.ofPlatform().name("lin-pty-output-" + pid).daemon(true).start(this::readOutput);
        Thread.ofPlatform().name("lin-pty-wait-" + pid).daemon(true).start(this::waitForExit);
    }

    public String processName() { return processName; }

    public void write(byte[] bytes, int offset, int length) throws IOException {
        synchronized (writeLock) {
            if (!alive.get()) throw new IOException("terminal process has exited");
            PtyNative.write(masterFd, bytes, offset, length);
        }
    }

    public void resize(int cols, int rows) throws IOException {
        if (alive.get()) PtyNative.resize(masterFd, cols, rows);
    }

    private void readOutput() {
        byte[] buffer = new byte[16 * 1024];
        try {
            while (alive.get()) {
                int count = PtyNative.read(masterFd, buffer);
                if (count < 0) return;
                output.accept(Arrays.copyOf(buffer, count));
            }
        } catch (IOException ignored) {
            // The waiter owns the authoritative exit notification.
        }
    }

    private void waitForExit() {
        int exitCode = 255;
        try {
            exitCode = PtyNative.waitFor(pid);
        } catch (IOException ignored) {
            // Preserve an explicit failure code for an unexpected wait error.
        } finally {
            alive.set(false);
            closeFileDescriptor();
            exited.accept(exitCode);
        }
    }

    private void closeFileDescriptor() {
        if (masterFd >= 0 && fdClosed.compareAndSet(false, true)) PtyNative.close(masterFd);
    }

    @Override
    public void close() {
        if (!started.get()) return;
        if (alive.getAndSet(false)) {
            try {
                PtyNative.signal(pid, SIGHUP);
            } catch (IOException ignored) {
                // The child may already have exited between the state check and signal.
            }
        }
    }
}
