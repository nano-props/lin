package nano.lin.server;

import java.io.IOException;
import java.io.InputStream;
import java.util.Locale;

final class StaticResourceHandler {
    void serve(HttpExchange exchange) throws IOException {
        if (!"GET".equals(exchange.request().method()) && !"HEAD".equals(exchange.request().method())) {
            HttpResponse.error(exchange.output(), 405, "Method not allowed");
            return;
        }
        var path = exchange.target().getPath();
        var resourcePath = switch (path) {
            case "", "/" -> "web/index.html";
            default -> path.startsWith("/") ? "web" + path : "web/" + path;
        };
        if (resourcePath.contains("..")) { HttpResponse.error(exchange.output(), 404, "Not found"); return; }
        byte[] body;
        try (var resource = StaticResourceHandler.class.getClassLoader().getResourceAsStream(resourcePath)) {
            if (resource == null) { HttpResponse.error(exchange.output(), 404, "Not found"); return; }
            body = resource.readAllBytes();
        }
        HttpResponse.write(exchange.output(), 200, "OK", contentType(resourcePath), body,
            "HEAD".equals(exchange.request().method()), null);
    }

    private static String contentType(String path) {
        var lower = path.toLowerCase(Locale.ROOT);
        if (lower.endsWith(".html")) return "text/html; charset=utf-8";
        if (lower.endsWith(".js")) return "text/javascript; charset=utf-8";
        if (lower.endsWith(".css")) return "text/css; charset=utf-8";
        if (lower.endsWith(".svg")) return "image/svg+xml";
        if (lower.endsWith(".woff2")) return "font/woff2";
        return "application/octet-stream";
    }
}
