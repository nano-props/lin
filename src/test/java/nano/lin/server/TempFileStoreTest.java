package nano.lin.server;

import static org.junit.jupiter.api.Assertions.*;

import java.nio.file.Files;
import org.junit.jupiter.api.Test;

class TempFileStoreTest {
    @Test
    void storesPrivateRandomFileAndPreservesOnlyExtension() throws Exception {
        TempFileStore store = new TempFileStore();
        try {
            var path = store.store("../hello world.txt", "payload".getBytes());
            assertTrue(path.getFileName().toString().endsWith(".txt"));
            assertNotEquals("hello world.txt", path.getFileName().toString());
            assertArrayEquals("payload".getBytes(), Files.readAllBytes(path));
        } finally { store.close(); }
        assertFalse(Files.exists(storeRoot(store))); // close removes the private directory
    }

    private static java.nio.file.Path storeRoot(TempFileStore store) throws Exception {
        var field = TempFileStore.class.getDeclaredField("root");
        field.setAccessible(true);
        return (java.nio.file.Path) field.get(store);
    }
}
