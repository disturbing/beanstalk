package shop.core;

import java.util.ArrayList;
import java.util.List;
import java.util.NoSuchElementException;
import java.util.TreeMap;

public final class Repo<T> {
    private final TreeMap<String, T> rows = new TreeMap<>();

    public void put(String key, T value) {
        rows.put(key, value);
    }

    public T get(String key) {
        if (!rows.containsKey(key)) {
            throw new NoSuchElementException(key);
        }
        return rows.get(key);
    }

    public List<T> all() {
        return new ArrayList<>(rows.values());
    }
}
