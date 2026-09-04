package nano.lin.server;

import java.net.InetAddress;
import java.net.UnknownHostException;
import java.security.SecureRandom;
import java.util.Base64;
import java.util.Locale;
import java.util.Map;

public record ServerConfig(InetAddress address, int port, String token) {
    public static ServerConfig parse(String[] args) {
        return parse(args, System.getenv());
    }

    static ServerConfig parse(String[] args, Map<String, String> environment) {
        var host = environment.getOrDefault("LIN_HOST", "127.0.0.1");
        var portValue = environment.getOrDefault("LIN_PORT", "7681");
        String token = environment.get("LIN_TOKEN");
        var allowRemoteValue = environment.getOrDefault("LIN_ALLOW_REMOTE", "false");

        for (var index = 0; index < args.length; index++) {
            switch (args[index]) {
                case "--host" -> host = requireValue(args, ++index, "--host");
                case "--port" -> portValue = requireValue(args, ++index, "--port");
                case "--token" -> token = requireValue(args, ++index, "--token");
                case "--allow-remote" -> allowRemoteValue = "true";
                default -> throw new IllegalArgumentException("unknown option: " + args[index]);
            }
        }

        var port = parsePort(portValue);
        var allowRemote = parseBoolean(allowRemoteValue, "LIN_ALLOW_REMOTE");
        InetAddress address;
        try {
            address = InetAddress.getByName(host);
        } catch (UnknownHostException error) {
            throw new IllegalArgumentException("cannot resolve host: " + host, error);
        }
        if (!address.isLoopbackAddress() && !allowRemote) {
            throw new IllegalArgumentException("refusing a non-loopback address without --allow-remote");
        }
        if (token == null) token = randomToken();
        if (token.length() < 16) throw new IllegalArgumentException("token must contain at least 16 characters");
        return new ServerConfig(address, port, token);
    }

    private static String requireValue(String[] args, int index, String option) {
        if (index >= args.length || args[index].isBlank()) {
            throw new IllegalArgumentException("missing value for " + option);
        }
        return args[index];
    }

    private static int parsePort(String value) {
        try {
            var port = Integer.parseInt(value);
            if (port < 0 || port > 65_535) throw new NumberFormatException();
            return port;
        } catch (NumberFormatException error) {
            throw new IllegalArgumentException("invalid port: " + value);
        }
    }

    private static boolean parseBoolean(String value, String name) {
        return switch (value.trim().toLowerCase(Locale.ROOT)) {
            case "true", "1", "yes", "on" -> true;
            case "false", "0", "no", "off", "" -> false;
            default -> throw new IllegalArgumentException("invalid boolean for " + name + ": " + value);
        };
    }

    private static String randomToken() {
        var bytes = new byte[32];
        new SecureRandom().nextBytes(bytes);
        return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
    }
}
