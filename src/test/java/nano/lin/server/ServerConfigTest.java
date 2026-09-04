package nano.lin.server;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

final class ServerConfigTest {
    @Test
    void defaultsToLoopbackWithRandomToken() {
        var config = ServerConfig.parse(new String[]{});

        assertTrue(config.address().isLoopbackAddress());
        assertEquals(7681, config.port());
        assertTrue(config.token().length() >= 32);
    }

    @Test
    void acceptsExplicitDevelopmentConfiguration() {
        var config = ServerConfig.parse(new String[]{
            "--port", "0",
            "--token", "0123456789abcdef",
        });

        assertEquals(0, config.port());
        assertEquals("0123456789abcdef", config.token());
    }

    @Test
    void remoteBindingRequiresAnExplicitOptIn() {
        assertThrows(
            IllegalArgumentException.class,
            () -> ServerConfig.parse(new String[]{"--host", "0.0.0.0"})
        );
    }

    @Test
    void rejectsShortTokens() {
        assertThrows(
            IllegalArgumentException.class,
            () -> ServerConfig.parse(new String[]{"--token", "short"})
        );
    }
}
