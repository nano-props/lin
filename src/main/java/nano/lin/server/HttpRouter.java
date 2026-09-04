package nano.lin.server;

import java.io.IOException;
import java.util.LinkedHashMap;
import java.util.Map;

final class HttpRouter {
    private final Map<String, HttpExchange.Handler> routes = new LinkedHashMap<>();
    private HttpExchange.Handler fallback = exchange -> HttpResponse.error(exchange.output(), 404, "Not found");

    HttpRouter route(String path, HttpExchange.Handler handler) {
        routes.put(path, handler);
        return this;
    }

    HttpRouter fallback(HttpExchange.Handler handler) {
        fallback = handler;
        return this;
    }

    void dispatch(HttpExchange exchange) throws IOException {
        HttpExchange.Handler handler = routes.get(exchange.target().getPath());
        (handler == null ? fallback : handler).handle(exchange);
    }
}
