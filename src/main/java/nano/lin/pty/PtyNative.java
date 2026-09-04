package nano.lin.pty;

import java.io.IOException;
import java.lang.foreign.AddressLayout;
import java.lang.foreign.Arena;
import java.lang.foreign.FunctionDescriptor;
import java.lang.foreign.Linker;
import java.lang.foreign.MemoryLayout;
import java.lang.foreign.MemorySegment;
import java.lang.foreign.SymbolLookup;
import java.lang.foreign.ValueLayout;
import java.lang.invoke.MethodHandle;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

final class PtyNative {
    private static final Linker LINKER = Linker.nativeLinker();
    private static final ValueLayout.OfInt C_INT = (ValueLayout.OfInt)LINKER.canonicalLayouts().get("int");
    private static final ValueLayout.OfLong C_LONG_LONG = (ValueLayout.OfLong)LINKER.canonicalLayouts().get("long long");
    private static final AddressLayout C_POINTER = (AddressLayout)LINKER.canonicalLayouts().get("void*");
    private static final SymbolLookup LOOKUP = loadLookup();

    private static final MethodHandle SPAWN = downcall(
        "lin_pty_spawn",
        FunctionDescriptor.of(C_INT, C_POINTER, C_POINTER, C_POINTER, C_INT, C_INT, C_POINTER, C_POINTER)
    );
    private static final MethodHandle RESIZE = downcall(
        "lin_pty_resize",
        FunctionDescriptor.of(C_INT, C_INT, C_INT, C_INT)
    );
    private static final MethodHandle READ = downcall(
        "lin_pty_read",
        FunctionDescriptor.of(C_LONG_LONG, C_INT, C_POINTER, C_INT)
    );
    private static final MethodHandle WRITE = downcall(
        "lin_pty_write",
        FunctionDescriptor.of(C_LONG_LONG, C_INT, C_POINTER, C_INT)
    );
    private static final MethodHandle SIGNAL = downcall(
        "lin_pty_signal",
        FunctionDescriptor.of(C_INT, C_INT, C_INT)
    );
    private static final MethodHandle WAIT = downcall(
        "lin_pty_wait",
        FunctionDescriptor.of(C_INT, C_INT, C_POINTER)
    );
    private static final MethodHandle CLOSE = downcall(
        "lin_pty_close",
        FunctionDescriptor.of(C_INT, C_INT)
    );

    private PtyNative() {}

    static SpawnResult spawn(int cols, int rows) throws IOException {
        var home = System.getProperty("user.home");
        var shell = selectShell();
        var environment = new LinkedHashMap<String, String>(System.getenv());
        environment.putIfAbsent("TERM", "xterm-256color");
        environment.putIfAbsent("COLORTERM", "truecolor");
        environment.putIfAbsent("SHELL", shell);

        try (Arena arena = Arena.ofConfined()) {
            var cwd = arena.allocateFrom(home);
            var argv = pointerArray(arena, List.of(shell, "-l"));
            var entries = new ArrayList<String>(environment.size());
            environment.forEach((key, value) -> entries.add(key + "=" + value));
            var envp = pointerArray(arena, entries);
            var master = arena.allocate(C_INT);
            var pid = arena.allocate(C_INT);
            var error = (int)SPAWN.invokeExact(cwd, argv, envp, cols, rows, master, pid);
            if (error != 0) throw nativeError("spawn PTY", error);
            return new SpawnResult(master.get(C_INT, 0), pid.get(C_INT, 0), Path.of(shell).getFileName().toString());
        } catch (IOException error) {
            throw error;
        } catch (Throwable error) {
            throw new IOException("cannot invoke the PTY native shim", error);
        }
    }

    static int read(int fd, byte[] destination) throws IOException {
        try (Arena arena = Arena.ofConfined()) {
            var buffer = arena.allocate(destination.length);
            var result = (long)READ.invokeExact(fd, buffer, destination.length);
            if (result < 0) {
                var errno = (int)-result;
                if (errno == 5) return -1; // Linux returns EIO when the PTY slave closes.
                throw nativeError("read PTY", errno);
            }
            if (result == 0) return -1;
            MemorySegment.copy(buffer, 0, MemorySegment.ofArray(destination), 0, result);
            return (int)result;
        } catch (IOException error) {
            throw error;
        } catch (Throwable error) {
            throw new IOException("cannot read the PTY", error);
        }
    }

    static void write(int fd, byte[] source, int offset, int length) throws IOException {
        if (length == 0) return;
        try (Arena arena = Arena.ofConfined()) {
            var buffer = arena.allocate(length);
            MemorySegment.copy(MemorySegment.ofArray(source), offset, buffer, 0, length);
            var written = 0;
            while (written < length) {
                var result = (long)WRITE.invokeExact(fd, buffer.asSlice(written), length - written);
                if (result < 0) throw nativeError("write PTY", (int)-result);
                if (result == 0) throw new IOException("PTY write made no progress");
                written += (int)result;
            }
        } catch (IOException error) {
            throw error;
        } catch (Throwable error) {
            throw new IOException("cannot write to the PTY", error);
        }
    }

    static void resize(int fd, int cols, int rows) throws IOException {
        invokeInt("resize PTY", RESIZE, fd, cols, rows);
    }

    static void signal(int pid, int signal) throws IOException {
        invokeInt("signal PTY process", SIGNAL, pid, signal);
    }

    static int waitFor(int pid) throws IOException {
        try (Arena arena = Arena.ofConfined()) {
            var status = arena.allocate(C_INT);
            var error = (int)WAIT.invokeExact(pid, status);
            if (error != 0) throw nativeError("wait for PTY process", error);
            var raw = status.get(C_INT, 0);
            var signal = raw & 0x7F;
            return signal == 0 ? (raw >>> 8) & 0xFF : 128 + signal;
        } catch (IOException error) {
            throw error;
        } catch (Throwable error) {
            throw new IOException("cannot wait for the PTY process", error);
        }
    }

    static void close(int fd) {
        try {
            CLOSE.invokeExact(fd);
        } catch (Throwable ignored) {
            // Closing is best effort during teardown.
        }
    }

    private static void invokeInt(String operation, MethodHandle handle, int... arguments) throws IOException {
        try {
            var error = switch (arguments.length) {
                case 2 -> (int)handle.invokeExact(arguments[0], arguments[1]);
                case 3 -> (int)handle.invokeExact(arguments[0], arguments[1], arguments[2]);
                default -> throw new IllegalArgumentException("unsupported native invocation");
            };
            if (error != 0) throw nativeError(operation, error);
        } catch (IOException error) {
            throw error;
        } catch (Throwable error) {
            throw new IOException("cannot " + operation, error);
        }
    }

    private static SymbolLookup loadLookup() {
        var library = System.getProperty("lin.native.library");
        var path = library == null || library.isBlank() ? extractLibrary() : Path.of(library).toAbsolutePath();
        System.load(path.toString());
        return SymbolLookup.loaderLookup();
    }

    private static Path extractLibrary() {
        try {
            var directory = Files.createTempDirectory("lin-pty-");
            var library = directory.resolve("liblinpty.so");
            try (var source = PtyNative.class.getResourceAsStream("/native/linux-x86_64/liblinpty.so")) {
                if (source == null) throw new IOException("embedded Linux PTY library is missing");
                Files.copy(source, library, StandardCopyOption.REPLACE_EXISTING);
            }
            directory.toFile().deleteOnExit();
            library.toFile().deleteOnExit();
            return library;
        } catch (IOException error) {
            throw new ExceptionInInitializerError(error);
        }
    }

    private static MethodHandle downcall(String name, FunctionDescriptor descriptor) {
        var symbol = LOOKUP.find(name)
            .orElseThrow(() -> new UnsatisfiedLinkError("missing native PTY symbol: " + name));
        return LINKER.downcallHandle(symbol, descriptor);
    }

    private static MemorySegment pointerArray(Arena arena, List<String> values) {
        var array = arena.allocate(C_POINTER.byteSize() * (values.size() + 1), C_POINTER.byteAlignment());
        for (var index = 0; index < values.size(); index++) {
            array.setAtIndex(C_POINTER, index, arena.allocateFrom(values.get(index)));
        }
        array.setAtIndex(C_POINTER, values.size(), MemorySegment.NULL);
        return array;
    }

    private static String selectShell() {
        var configured = System.getenv("SHELL");
        if (configured != null && Files.isExecutable(Path.of(configured))) return configured;
        if (Files.isExecutable(Path.of("/bin/bash"))) return "/bin/bash";
        return "/bin/sh";
    }

    private static IOException nativeError(String operation, int errno) {
        return new IOException(operation + " failed (errno " + errno + ")");
    }

    record SpawnResult(int masterFd, int pid, String processName) {}
}
