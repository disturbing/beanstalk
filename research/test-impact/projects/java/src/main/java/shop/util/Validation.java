package shop.util;

import java.util.regex.Pattern;

public final class Validation {
    public static final Pattern SKU_RE = Pattern.compile("^SKU-\\d{3}$");
    public static final Pattern EMAIL_RE = Pattern.compile("^[^@\\s]+@[^@\\s]+\\.[a-z]{2,}$");

    private Validation() {
    }

    public static boolean isSku(String value) {
        return SKU_RE.matcher(value).matches();
    }

    public static boolean isEmail(String value) {
        return EMAIL_RE.matcher(value).matches();
    }

    public static void require(boolean cond, String message) {
        if (!cond) {
            throw new IllegalArgumentException(message);
        }
    }
}
