package nano.lin.server;

import org.junit.jupiter.api.Test;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

final class HttpRequestTest {
    @Test
    void parsesAWebSocketUpgradeRequest() throws IOException {
        String source = "GET /ws?token=abc HTTP/1.1\r\n"
            + "Host: 127.0.0.1:7681\r\n"
            + "Upgrade: websocket\r\n"
            + "Connection: Upgrade\r\n\r\n";

        HttpRequest request = HttpRequest.read(new ByteArrayInputStream(source.getBytes(StandardCharsets.US_ASCII)));

        assertEquals("GET", request.method());
        assertEquals("/ws?token=abc", request.target());
        assertEquals("websocket", request.header("Upgrade"));
    }

    @Test
    void rejectsMalformedHeaders() {
        String source = "GET / HTTP/1.1\r\nnot-a-header\r\n\r\n";

        assertThrows(
            IOException.class,
            () -> HttpRequest.read(new ByteArrayInputStream(source.getBytes(StandardCharsets.US_ASCII)))
        );
    }

    @Test
    void boundsTheHeaderSection() {
        String source = "GET / HTTP/1.1\r\nX-Fill: " + "x".repeat(20_000) + "\r\n\r\n";

        assertThrows(
            IOException.class,
            () -> HttpRequest.read(new ByteArrayInputStream(source.getBytes(StandardCharsets.US_ASCII)))
        );
    }
}
