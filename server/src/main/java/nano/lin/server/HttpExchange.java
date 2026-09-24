package nano.lin.server;

import java.io.BufferedInputStream;
import java.io.IOException;
import java.io.OutputStream;
import java.net.Socket;
import java.net.URI;

record HttpExchange(
    Socket socket,
    BufferedInputStream input,
    OutputStream output,
    HttpRequest request,
    URI target
) {
    @FunctionalInterface
    interface Handler { void handle(HttpExchange exchange) throws IOException; }
}
