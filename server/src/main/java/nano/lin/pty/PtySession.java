package nano.lin.pty;

import java.io.IOException;
import java.util.Arrays;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.function.Consumer;
import java.util.function.IntConsumer;

public final class PtySession implements AutoCloseable {
    private static final int SIGHUP = 1;

    private final IntConsumer exited;
    private final AtomicBoolean started = new AtomicBoolean();
    private final AtomicBoolean alive = new AtomicBoolean();
    private final AtomicBoolean fdClosed = new AtomicBoolean();
    private final Object writeLock = new Object();
    private volatile int masterFd = -1;
    private volatile int pid = -1;
    private volatile String processName = "shell";
    private final Object attachmentLock = new Object();
    private Attachment attachment;
    private byte[] backlog = new byte[0];

    public PtySession(IntConsumer exited) {
        this.exited = exited;
    }

    public synchronized void start(int cols, int rows) throws IOException {
        if (started.get()) return;
        var process = PtyNative.spawn(cols, rows);
        masterFd = process.masterFd();
        pid = process.pid();
        processName = process.processName();
        alive.set(true);
        started.set(true);
        // A blocking FFM downcall pins a virtual thread's carrier. Dedicated platform
        // threads keep multiple PTYs from starving the WebSocket virtual threads.
        Thread.ofPlatform().name("lin-pty-output-" + pid).daemon(true).start(this::readOutput);
        Thread.ofPlatform().name("lin-pty-wait-" + pid).daemon(true).start(this::waitForExit);
    }

    public String processName() { return processName; }

    public boolean isAlive() { return alive.get(); }

    public Attachment attach(Consumer<byte[]> output, IntConsumer exit) {
        synchronized (attachmentLock) {
            var next = new Attachment(output, exit);
            attachment = next;
            var pending = backlog;
            backlog = new byte[0];
            next.pending = pending;
            return next;
        }
    }

    public void detach(Attachment attached) {
        synchronized (attachmentLock) {
            if (attachment == attached) attachment = null;
        }
    }

    public void replay(Attachment attached) {
        synchronized (attachmentLock) {
            if (attachment != attached) return;
            var pending = attached.pending;
            attached.pending = new byte[0];
            attached.replaying = false;
            if (pending.length > 0) attached.output.accept(pending);
        }
    }

    public boolean isDetached() {
        synchronized (attachmentLock) {
            return attachment == null;
        }
    }

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
        var buffer = new byte[16 * 1024];
        try {
            while (alive.get()) {
                var count = PtyNative.read(masterFd, buffer);
                if (count < 0) return;
                emitOutput(Arrays.copyOf(buffer, count));
            }
        } catch (IOException ignored) {
            // The waiter owns the authoritative exit notification.
        }
    }

    private void waitForExit() {
        var exitCode = 255;
        try {
            exitCode = PtyNative.waitFor(pid);
        } catch (IOException ignored) {
            // Preserve an explicit failure code for an unexpected wait error.
        } finally {
            alive.set(false);
            closeFileDescriptor();
            Attachment current;
            synchronized (attachmentLock) {
                current = attachment;
                attachment = null;
            }
            if (current != null) current.sendExit(exitCode);
            exited.accept(exitCode);
        }
    }

    private void emitOutput(byte[] bytes) {
        Consumer<byte[]> output;
        synchronized (attachmentLock) {
            if (attachment == null || attachment.replaying) {
                var existing = attachment == null ? backlog : attachment.pending;
                var combined = new byte[Math.min(1_048_576, existing.length + bytes.length)];
                var sourceOffset = Math.max(0, existing.length + bytes.length - combined.length);
                var combinedAll = new byte[existing.length + bytes.length];
                System.arraycopy(existing, 0, combinedAll, 0, existing.length);
                System.arraycopy(bytes, 0, combinedAll, existing.length, bytes.length);
                System.arraycopy(combinedAll, sourceOffset, combined, 0, combined.length);
                if (attachment == null) backlog = combined;
                else attachment.pending = combined;
                return;
            }
            output = attachment.output;
        }
        output.accept(bytes);
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

    public static final class Attachment {
        private final Consumer<byte[]> output;
        private final IntConsumer exit;
        private byte[] pending = new byte[0];
        private boolean replaying = true;

        private Attachment(Consumer<byte[]> output, IntConsumer exit) {
            this.output = output;
            this.exit = exit;
        }

        public void sendExit(int code) {
            exit.accept(code);
        }
    }
}
