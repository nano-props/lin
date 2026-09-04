package nano.lin.server;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;

record HttpRequest(String method, String target, Map<String, String> headers) {
    private static final int MAX_HEADER_BYTES = 16 * 1024;

    static HttpRequest read(InputStream input) throws IOException {
        var consumed = new int[]{0};
        var requestLine = readLine(input, consumed);
        if (requestLine == null || requestLine.isBlank()) throw new IOException("empty HTTP request");
        var parts = requestLine.split(" ", 3);
        if (parts.length != 3 || !parts[2].startsWith("HTTP/1.")) throw new IOException("invalid HTTP request line");

        var headers = new LinkedHashMap<String, String>();
        while (true) {
            var line = readLine(input, consumed);
            if (line == null) throw new IOException("truncated HTTP headers");
            if (line.isEmpty()) break;
            var separator = line.indexOf(':');
            if (separator <= 0) throw new IOException("invalid HTTP header");
            var name = line.substring(0, separator).trim().toLowerCase(Locale.ROOT);
            var value = line.substring(separator + 1).trim();
            headers.merge(name, value, (left, right) -> left + ", " + right);
        }
        return new HttpRequest(parts[0], parts[1], Map.copyOf(headers));
    }

    String header(String name) {
        return headers.get(name.toLowerCase(Locale.ROOT));
    }

    byte[] readBody(InputStream input, int maxBytes) throws IOException {
        var length = header("content-length");
        if (length == null) throw new IOException("Content-Length is required");
        final int expected;
        try { expected = Integer.parseInt(length); }
        catch (NumberFormatException error) { throw new IOException("Invalid Content-Length", error); }
        if (expected < 0 || expected > maxBytes) throw new IOException("Request body is too large");
        var body = input.readNBytes(expected);
        if (body.length != expected) throw new IOException("Truncated request body");
        return body;
    }

    private static String readLine(InputStream input, int[] consumed) throws IOException {
        ByteArrayOutputStream line = new ByteArrayOutputStream();
        var carriageReturn = false;
        while (true) {
            var next = input.read();
            if (next < 0) return line.size() == 0 ? null : line.toString(StandardCharsets.US_ASCII);
            if (++consumed[0] > MAX_HEADER_BYTES) throw new IOException("HTTP headers are too large");
            if (carriageReturn) {
                if (next == '\n') return line.toString(StandardCharsets.US_ASCII);
                line.write('\r');
                carriageReturn = false;
            }
            if (next == '\r') carriageReturn = true;
            else line.write(next);
        }
    }
}
