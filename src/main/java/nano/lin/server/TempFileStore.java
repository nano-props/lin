package nano.lin.server;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.attribute.PosixFilePermissions;
import java.time.Duration;
import java.util.Comparator;
import java.util.UUID;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;

final class TempFileStore implements AutoCloseable {
    static final int MAX_FILE_BYTES = 10 * 1024 * 1024;
    private static final Duration TTL = Duration.ofHours(1);
    private final Path root;
    private final ScheduledExecutorService cleaner = Executors.newSingleThreadScheduledExecutor(r -> {
        Thread thread = new Thread(r, "lin-temp-cleaner"); thread.setDaemon(true); return thread;
    });

    TempFileStore() throws IOException {
        root = Files.createTempDirectory("lin-upload-");
        cleaner.scheduleAtFixedRate(this::cleanup, 5, 5, TimeUnit.MINUTES);
    }

    Path store(String filename, byte[] bytes) throws IOException {
        cleanup();
        String rawName = filename == null ? "upload" : filename;
        int slash = Math.max(rawName.lastIndexOf('/'), rawName.lastIndexOf('\\'));
        String safeName = rawName.substring(slash + 1).replaceAll("[^A-Za-z0-9._-]", "_");
        if (safeName.isBlank() || safeName.equals(".") || safeName.equals("..")) safeName = "upload";
        String suffix = safeName.contains(".") ? safeName.substring(safeName.lastIndexOf('.')) : "";
        Path target = root.resolve(UUID.randomUUID() + suffix);
        try {
            Files.write(target, bytes);
            try { Files.setPosixFilePermissions(target, PosixFilePermissions.fromString("rw-------")); }
            catch (UnsupportedOperationException ignored) { }
            return target;
        } catch (IOException error) { Files.deleteIfExists(target); throw error; }
    }

    private void cleanup() {
        try (var paths = Files.list(root)) {
            paths.filter(path -> {
                try { return Files.getLastModifiedTime(path).toMillis() < System.currentTimeMillis() - TTL.toMillis(); }
                catch (IOException error) { return true; }
            }).forEach(path -> { try { Files.deleteIfExists(path); } catch (IOException ignored) { } });
        } catch (IOException ignored) { }
    }

    @Override public void close() {
        cleaner.shutdownNow();
        try (var paths = Files.walk(root)) {
            paths.sorted(Comparator.reverseOrder()).forEach(path -> { try { Files.deleteIfExists(path); } catch (IOException ignored) { } });
        } catch (IOException ignored) { }
    }
}
