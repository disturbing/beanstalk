package shop.core;

/**
 * Compile-time constants. javac inlines these into every class that reads them,
 * so a change here is invisible to class-level dependency tracing of the users.
 */
public final class Limits {
    /** Largest quantity accepted by a single Cart.add call. */
    public static final int MAX_QTY = 99;
    /** Zero-padded digit width of sequence ids (ORD00001). */
    public static final int ID_WIDTH = 5;
    /** Default number of rows returned by sales reports. */
    public static final int DEFAULT_PAGE = 3;

    private Limits() {
    }
}
