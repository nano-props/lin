package nano.lin.server;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertArrayEquals;

class WebSocketConnectionTest {
    @Test
    void prefixesTerminalOutputSoItCannotCollideWithExitMessages() {
        assertArrayEquals(
            new byte[]{0, 2, 0, 0, 0, 7},
            WebSocketConnection.terminalOutputPayload(new byte[]{2, 0, 0, 0, 7})
        );
    }

    @Test
    void encodesProcessNameMetadata() {
        assertArrayEquals(new byte[]{3, 'b', 'a', 's', 'h'}, WebSocketConnection.metadataPayload("bash"));
    }
}
