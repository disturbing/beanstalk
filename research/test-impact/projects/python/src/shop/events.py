from collections import defaultdict
from typing import Callable


class Bus:
    def __init__(self):
        self.handlers: dict[str, list[Callable[[str], None]]] = defaultdict(list)
        self.log: list[tuple[str, str]] = []

    def on(self, topic: str, handler: Callable[[str], None]) -> None:
        self.handlers[topic].append(handler)

    def emit(self, topic: str, payload: str) -> None:
        self.log.append((topic, payload))
        for h in self.handlers[topic]:
            h(payload)
