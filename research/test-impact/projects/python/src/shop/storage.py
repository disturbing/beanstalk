from typing import Generic, TypeVar

T = TypeVar("T")


class Repo(Generic[T]):
    def __init__(self):
        self.rows: dict[str, T] = {}

    def put(self, key: str, value: T) -> None:
        self.rows[key] = value

    def get(self, key: str) -> T:
        return self.rows[key]

    def all(self) -> list[T]:
        return [self.rows[k] for k in sorted(self.rows)]
