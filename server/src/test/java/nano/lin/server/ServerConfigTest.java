package nano.lin.server;

import org.junit.jupiter.api.Test;

import java.util.Map;

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

    @Test
    void readsEnvironmentConfiguration() {
        var config = ServerConfig.parse(new String[]{}, Map.of(
            "LIN_HOST", "127.0.0.1",
            "LIN_PORT", "9000",
            "LIN_TOKEN", "0123456789abcdef",
            "LIN_ALLOW_REMOTE", "yes"
        ));

        assertEquals(9000, config.port());
        assertEquals("0123456789abcdef", config.token());
    }

    @Test
    void commandLineArgumentsOverrideEnvironment() {
        var config = ServerConfig.parse(
            new String[]{"--port", "7000", "--token", "fedcba9876543210"},
            Map.of("LIN_PORT", "9000", "LIN_TOKEN", "0123456789abcdef")
        );

        assertEquals(7000, config.port());
        assertEquals("fedcba9876543210", config.token());
    }

    @Test
    void rejectsInvalidEnvironmentValues() {
        assertThrows(
            IllegalArgumentException.class,
            () -> ServerConfig.parse(new String[]{}, Map.of("LIN_PORT", "not-a-port"))
        );
        assertThrows(
            IllegalArgumentException.class,
            () -> ServerConfig.parse(new String[]{}, Map.of("LIN_ALLOW_REMOTE", "maybe"))
        );
    }

    @Test
    void commandLineValuesOverrideInvalidEnvironmentValues() {
        var config = ServerConfig.parse(
            new String[]{"--port", "7000", "--token", "fedcba9876543210", "--allow-remote"},
            Map.of("LIN_PORT", "not-a-port", "LIN_TOKEN", "bad", "LIN_ALLOW_REMOTE", "maybe")
        );

        assertEquals(7000, config.port());
        assertEquals("fedcba9876543210", config.token());
    }
}
