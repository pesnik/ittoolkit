"""JSON-RPC 2.0 dispatcher entry point.

Reads newline-delimited frames on stdin, writes responses on stdout,
logs to stderr. Same protocol shape as the browser-use sidecar so the
Tauri-side supervisor can be a near-clone.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import threading
from typing import Any

from . import log
from .handlers import parse as parse_handler


def _ping(_params: dict[str, Any]) -> dict[str, Any]:
    return {"ok": True, "pid": os.getpid()}


HANDLERS = {
    "perception.ping": _ping,
    "perception.parse": parse_handler.handle,
}


def _write(frame: dict[str, Any]) -> None:
    line = json.dumps(frame, separators=(",", ":"))
    sys.stdout.write(line + "\n")
    sys.stdout.flush()


def _respond_error(frame_id: Any, code: int, message: str, data: Any = None) -> None:
    err: dict[str, Any] = {"code": code, "message": message}
    if data is not None:
        err["data"] = data
    _write({"jsonrpc": "2.0", "id": frame_id, "error": err})


def _dispatch(frame: dict[str, Any]) -> None:
    frame_id = frame.get("id")
    method = frame.get("method")
    params = frame.get("params") or {}
    if not isinstance(method, str):
        _respond_error(frame_id, -32600, "Invalid Request: missing method")
        return
    handler = HANDLERS.get(method)
    if handler is None:
        _respond_error(frame_id, -32601, f"Method not found: {method}")
        return
    try:
        result = handler(params if isinstance(params, dict) else {})
    except Exception as e:  # noqa: BLE001
        log.error("handler threw", {"method": method, "err": str(e)})
        if frame_id is not None:
            _respond_error(frame_id, -32000, str(e))
        return
    if frame_id is not None:
        _write({"jsonrpc": "2.0", "id": frame_id, "result": result})


def main() -> int:
    p = argparse.ArgumentParser(description="ittoolkit perception sidecar")
    p.add_argument(
        "--enable-omniparser",
        action="store_true",
        help="Load OmniParser on first parse call. Without this flag the sidecar runs in stub mode and returns no candidates (UI-TARS does the grounding alone).",
    )
    args = p.parse_args()
    parse_handler.configure(enable_omniparser=args.enable_omniparser)

    log.info("sidecar ready", {"pid": os.getpid(), "python": sys.version.split()[0]})

    # Single-threaded dispatch keeps the wire deterministic. Long parses
    # block other calls; that's fine because the agent serializes them.
    for raw_line in sys.stdin:
        line = raw_line.strip()
        if not line:
            continue
        try:
            frame = json.loads(line)
        except Exception as e:  # noqa: BLE001
            _respond_error(None, -32700, "Parse error", data=str(e))
            continue
        if not isinstance(frame, dict) or frame.get("jsonrpc") != "2.0":
            _respond_error(frame.get("id") if isinstance(frame, dict) else None,
                           -32600, "Invalid Request")
            continue
        _dispatch(frame)

    log.info("stdin closed; exiting")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
