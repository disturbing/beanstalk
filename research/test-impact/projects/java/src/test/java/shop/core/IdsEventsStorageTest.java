package shop.core;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.List;
import org.junit.jupiter.api.Test;

class IdsEventsStorageTest {
    @Test
    void sequence() {
        Sequence s = new Sequence("X", 9);
        assertEquals(List.of("X00009", "X00010"), List.of(s.take(), s.take()));
    }

    @Test
    void shortIdStable() {
        assertEquals(Ids.shortId("c", "a", 1), Ids.shortId("c", "a", 1));
        assertTrue(Ids.shortId("c", "a", 1).startsWith("c-"));
    }

    @Test
    void busAndRepo() {
        Bus bus = new Bus();
        Repo<String> repo = new Repo<>();
        bus.on("t", p -> repo.put(p, p.toUpperCase()));
        bus.emit("t", "b");
        bus.emit("t", "a");
        assertEquals(List.of("A", "B"), repo.all());
    }
}
