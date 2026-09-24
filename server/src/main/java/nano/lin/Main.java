package nano.lin;

import nano.lin.server.LinServer;
import nano.lin.server.ServerConfig;

public final class Main {
    private Main() {}

    public static void main(String[] args) throws Exception {
        ServerConfig config;
        try {
            config = ServerConfig.parse(args);
        } catch (IllegalArgumentException error) {
            System.err.println("lin: " + error.getMessage());
            System.err.println("usage: lin [--host ADDRESS] [--port PORT] [--token TOKEN] [--allow-remote]");
            System.err.println("       env: LIN_HOST LIN_PORT LIN_TOKEN LIN_ALLOW_REMOTE");
            System.exit(2);
            return;
        }

        var server = new LinServer(config);
        Runtime.getRuntime().addShutdownHook(Thread.ofPlatform().unstarted(server::close));
        server.start();

        System.out.println("lin is ready");
        System.out.println("  " + server.accessUrl());
        System.out.println("Press Ctrl+C to stop.");
        server.await();
    }
}
