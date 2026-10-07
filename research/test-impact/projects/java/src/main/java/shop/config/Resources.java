package shop.config;

import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.UncheckedIOException;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Properties;

/** Classpath resource access: works from any working directory. */
public final class Resources {
    private Resources() {
    }

    public static InputStream open(String name) {
        InputStream in = Resources.class.getClassLoader().getResourceAsStream(name);
        if (in == null) {
            throw new UncheckedIOException(new IOException("missing resource " + name));
        }
        return in;
    }

    public static List<String> lines(String name) {
        try (InputStream in = open(name)) {
            return new String(in.readAllBytes(), StandardCharsets.UTF_8).lines()
                    .filter(l -> !l.isBlank())
                    .toList();
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
    }

    public static Properties properties(String name) {
        Properties p = new Properties();
        try (InputStream in = open(name)) {
            p.load(new InputStreamReader(in, StandardCharsets.UTF_8));
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
        return p;
    }
}
