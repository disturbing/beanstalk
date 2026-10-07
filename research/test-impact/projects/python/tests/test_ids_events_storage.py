from shop.core.ids import Sequence, short_id
from shop.events import Bus
from shop.storage import Repo


def test_sequence():
    s = Sequence("X", 9)
    assert [s.take(), s.take()] == ["X00009", "X00010"]


def test_short_id_stable():
    assert short_id("c", "a", 1) == short_id("c", "a", 1)
    assert short_id("c", "a", 1).startswith("c-")


def test_bus_and_repo():
    bus, repo = Bus(), Repo()
    bus.on("t", lambda p: repo.put(p, p.upper()))
    bus.emit("t", "b")
    bus.emit("t", "a")
    assert repo.all() == ["A", "B"]
