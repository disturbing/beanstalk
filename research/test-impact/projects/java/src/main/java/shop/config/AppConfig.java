package shop.config;

import java.util.Arrays;
import java.util.List;
import java.util.Properties;

public final class AppConfig {
    private static Properties props;

    private AppConfig() {
    }

    public static synchronized Properties load() {
        if (props == null) {
            props = Resources.properties("app.properties");
        }
        return props;
    }

    public static String get(String key, String fallback) {
        return load().getProperty(key, fallback);
    }

    public static String get(String key) {
        return get(key, null);
    }

    public static long getLong(String key, long fallback) {
        String v = get(key);
        return v == null ? fallback : Long.parseLong(v.trim());
    }

    public static List<String> getList(String key) {
        String v = get(key, "");
        return Arrays.stream(v.split(",")).map(String::trim).filter(s -> !s.isEmpty()).toList();
    }
}
