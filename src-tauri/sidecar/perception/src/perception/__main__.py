import json
import logging
import os
import sys
import traceback
from typing import Any

from .finder import handle_find

logging.basicConfig(
    level=logging.INFO,
    format="[perception] %(levelname)s %(message)s",
    stream=sys.stderr,
)
log = logging.getLogger(__name__)


def read_frame() -> dict[str, Any] | None:
    line = sys.stdin.readline()
    if not line:
        return None
    line = line.strip()
    if not line:
        return read_frame()
    return json.loads(line)


def send_response(id_val: int | None, result: Any = None, error: Any = None) -> None:
    frame: dict[str, Any] = {"jsonrpc": "2.0", "id": id_val}
    if error is not None:
        frame["error"] = {"code": -32000, "message": str(error)}
    else:
        frame["result"] = result
    sys.stdout.write(json.dumps(frame) + "\n")
    sys.stdout.flush()


def handle_ping(params: dict[str, Any]) -> dict[str, Any]:
    return {"pong": True, "pid": os.getpid()}


METHODS = {
    "find": handle_find,
    "ping": handle_ping,
}


def main() -> None:
    log.info("perception sidecar started (pid %d)", os.getpid())
    while True:
        frame = read_frame()
        if frame is None:
            log.info("stdin closed, shutting down")
            break
        req_id = frame.get("id")
        method = frame.get("method", "")
        params = frame.get("params", {})
        log.info("rpc call: %s id=%s", method, req_id)
        handler = METHODS.get(method)
        if handler is None:
            send_response(req_id, error=f"unknown method: {method}")
            continue
        try:
            result = handler(params)
            send_response(req_id, result=result)
        except Exception:
            log.exception("handler %s failed", method)
            send_response(req_id, error=traceback.format_exc())


if __name__ == "__main__":
    main()
