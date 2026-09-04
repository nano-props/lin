package nano.lin.server;

import java.io.IOException;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;

final class HttpResponse {
    private HttpResponse() {}

    static void error(OutputStream output, int status, String message) throws IOException {
        write(output, status, message, "text/plain; charset=utf-8", (message + "\n").getBytes(StandardCharsets.UTF_8), false, null);
    }

    static void write(OutputStream output, int status, String reason, String contentType,
                      byte[] body, boolean headOnly, String setCookie) throws IOException {
        String headers = "HTTP/1.1 " + status + " " + reason + "\r\n"
            + "Content-Type: " + contentType + "\r\n"
            + "Content-Length: " + body.length + "\r\n"
            + "Cache-Control: no-store\r\n"
            + "Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; "
            + "font-src 'self'; connect-src 'self' ws: wss:; img-src 'self' data:\r\n"
            + "Referrer-Policy: no-referrer\r\n"
            + "X-Content-Type-Options: nosniff\r\n"
            + "X-Frame-Options: DENY\r\n"
            + "Cross-Origin-Resource-Policy: same-origin\r\n"
            + (setCookie == null ? "" : "Set-Cookie: " + setCookie + "\r\n")
            + "Connection: close\r\n\r\n";
        output.write(headers.getBytes(StandardCharsets.US_ASCII));
        if (!headOnly) output.write(body);
        output.flush();
    }
}
