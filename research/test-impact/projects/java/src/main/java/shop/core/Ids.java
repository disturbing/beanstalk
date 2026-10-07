package shop.core;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;
import java.util.StringJoiner;

public final class Ids {
    private Ids() {
    }

    public static String shortId(String prefix, Object... parts) {
        StringJoiner joined = new StringJoiner("|");
        for (Object p : parts) {
            joined.add(String.valueOf(p));
        }
        try {
            byte[] digest = MessageDigest.getInstance("SHA-1")
                    .digest(joined.toString().getBytes(StandardCharsets.UTF_8));
            return prefix + "-" + HexFormat.of().formatHex(digest).substring(0, 8);
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }
}
