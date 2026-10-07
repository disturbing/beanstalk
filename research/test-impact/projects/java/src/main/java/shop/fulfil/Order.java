package shop.fulfil;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Set;
import shop.sales.Cart;
import shop.sales.Quote;

public final class Order {
    static final Map<String, Set<String>> TRANSITIONS = Map.of(
            "new", Set.of("paid", "cancelled"),
            "paid", Set.of("shipped", "refunded"),
            "shipped", Set.of("delivered"));

    private final String id;
    private final Cart cart;
    private final Quote quote;
    private String state = "new";
    private final List<String> history = new ArrayList<>();

    public Order(String id, Cart cart, Quote quote) {
        this.id = id;
        this.cart = cart;
        this.quote = quote;
    }

    public String id() {
        return id;
    }

    public Cart cart() {
        return cart;
    }

    public Quote quote() {
        return quote;
    }

    public String state() {
        return state;
    }

    public List<String> history() {
        return history;
    }

    public void move(String to) {
        if (!TRANSITIONS.getOrDefault(state, Set.of()).contains(to)) {
            throw new IllegalArgumentException("cannot go " + state + " -> " + to);
        }
        history.add(state);
        state = to;
    }
}
