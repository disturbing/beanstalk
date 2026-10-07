package shop.core;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.function.Consumer;

public final class Bus {
    private final Map<String, List<Consumer<String>>> handlers = new HashMap<>();
    private final List<Map.Entry<String, String>> log = new ArrayList<>();

    public void on(String topic, Consumer<String> handler) {
        handlers.computeIfAbsent(topic, k -> new ArrayList<>()).add(handler);
    }

    public void emit(String topic, String payload) {
        log.add(Map.entry(topic, payload));
        for (Consumer<String> h : handlers.getOrDefault(topic, List.of())) {
            h.accept(payload);
        }
    }

    public List<Map.Entry<String, String>> log() {
        return log;
    }
}
