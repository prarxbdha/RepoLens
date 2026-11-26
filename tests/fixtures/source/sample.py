"""Module documentation."""
import os
import json as js
from typing import Dict, List
from .helpers import read_file as load

__all__ = ["compute", "AsyncWorker", "CONSTANT"]

CONSTANT = 3
private_value = 4


class Base:
    def describe(self) -> str:
        return "base"


class AsyncWorker(Base):
    """Runs async work."""

    class Nested:
        def inner(self):
            return 1

    async def compute(self, values: List[int], limit: int = 10) -> Dict[str, int]:
        if limit > 0:
            return {"total": sum(values[:limit])}
        return {}

    @staticmethod
    def helper(value):
        return value * 2


def _private():
    return None
