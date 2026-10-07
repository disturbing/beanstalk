package shop.util;

import java.util.Locale;

public final class Strings {
    private Strings() {
    }

    public static String slugify(String text) {
        String s = text.toLowerCase(Locale.ROOT).replaceAll("[^a-z0-9]+", "-");
        return s.replaceAll("^-+|-+$", "");
    }

    public static String padRight(String text, int width) {
        String t = text.length() > width ? text.substring(0, width) : text;
        return t + " ".repeat(width - t.length());
    }

    public static String padLeft(String text, int width) {
        String t = text.length() > width ? text.substring(0, width) : text;
        return " ".repeat(width - t.length()) + t;
    }
}
