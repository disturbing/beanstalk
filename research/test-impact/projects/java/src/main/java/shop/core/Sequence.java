package shop.core;

public final class Sequence {
    private final String prefix;
    private int next;

    public Sequence(String prefix) {
        this(prefix, 1);
    }

    public Sequence(String prefix, int start) {
        this.prefix = prefix;
        this.next = start;
    }

    public String take() {
        String value = prefix + String.format("%0" + Limits.ID_WIDTH + "d", next);
        next++;
        return value;
    }
}
