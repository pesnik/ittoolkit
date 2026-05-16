"""Sidecar logging — writes to stderr so stdout stays clean for JSON-RPC."""

import json
import sys
from typing import Any


def _emit(level: str, msg: str, extra: Any = None) -> None:
    if extra is None:
        line = f"[perception {level}] {msg}"
    else:
        try:
            ex = json.dumps(extra, default=str)
        except Exception:
            ex = str(extra)
        line = f"[perception {level}] {msg} {ex}"
    print(line, file=sys.stderr, flush=True)


def info(msg: str, extra: Any = None) -> None:
    _emit("info", msg, extra)


def warn(msg: str, extra: Any = None) -> None:
    _emit("warn", msg, extra)


def error(msg: str, extra: Any = None) -> None:
    _emit("error", msg, extra)
