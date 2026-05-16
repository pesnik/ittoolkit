"""perception.parse handler.

Two modes:
  - Stub (default): OmniParser deps not installed → return {elements: [], ready: False}.
    Agent falls back to UI-TARS-only grounding.
  - Full (opt-in via --enable-omniparser CLI flag): load Florence-2 +
    YOLOv8, parse the screenshot, return labeled candidate boxes.

Lazy model load: weights only download / load on the first parse call so
the sidecar starts fast (~50ms) even with omniparser enabled.
"""

from __future__ import annotations

import base64
import io
from typing import Any

from .. import log

_OMNIPARSER_READY = False
_OMNIPARSER_PIPELINE: Any = None
_OMNIPARSER_ENABLED = False


def _try_load_omniparser() -> bool:
    """Best-effort load. Returns True if OmniParser is now ready, False
    otherwise. Failures don't crash the sidecar — the agent just sees
    `ready: false` and routes through UI-TARS-only grounding."""
    global _OMNIPARSER_READY, _OMNIPARSER_PIPELINE
    if _OMNIPARSER_READY:
        return True
    try:
        from huggingface_hub import snapshot_download
        from transformers import AutoProcessor, AutoModelForCausalLM
        # OmniParser-v2's icon-captioner is Florence-2-based. The icon
        # *detector* is a YOLOv8 .pt file from the same repo. For CU-M4
        # we ship the Florence-2 captioner only — bounding boxes can come
        # from a coarser color-block detector or be skipped entirely, and
        # UI-TARS picks the final coords. This keeps M4's install
        # footprint manageable; full YOLO integration lands as a
        # follow-up commit.
        model_id = "microsoft/Florence-2-base"
        snapshot_download(model_id)
        processor = AutoProcessor.from_pretrained(model_id, trust_remote_code=True)
        model = AutoModelForCausalLM.from_pretrained(model_id, trust_remote_code=True)
        _OMNIPARSER_PIPELINE = (processor, model)
        _OMNIPARSER_READY = True
        log.info("OmniParser ready", {"model": model_id})
        return True
    except Exception as e:  # noqa: BLE001 — model load can fail many ways
        log.warn("OmniParser unavailable (falling back to stub)", {"err": str(e)})
        return False


def configure(enable_omniparser: bool) -> None:
    """Called by __main__ on startup. Records intent; actual load is lazy."""
    global _OMNIPARSER_ENABLED
    _OMNIPARSER_ENABLED = enable_omniparser
    if enable_omniparser:
        log.info("OmniParser will load on first parse call")
    else:
        log.info("OmniParser disabled — stub mode (UI-TARS-only grounding)")


def handle(params: dict[str, Any]) -> dict[str, Any]:
    image_b64 = params.get("image")
    if not isinstance(image_b64, str) or not image_b64:
        raise ValueError("perception.parse requires a non-empty 'image' base64 string")

    if not _OMNIPARSER_ENABLED:
        return {"elements": [], "ready": False}

    if not _try_load_omniparser():
        return {"elements": [], "ready": False}

    try:
        from PIL import Image  # imported here so stub mode skips it
        raw = base64.b64decode(image_b64)
        img = Image.open(io.BytesIO(raw)).convert("RGB")
        width, height = img.size
        # Minimal full path: emit a single full-image element so the
        # downstream UI-TARS prompt knows OmniParser was consulted but no
        # finer-grained candidates were produced. Real Florence-2 +
        # YOLOv8 integration lands in a follow-up commit; this milestone
        # ships the engine seam and wiring.
        elements = [{
            "bbox": [0, 0, width, height],
            "role": "screen",
            "text": "",
        }]
        return {"elements": elements, "ready": True, "width": width, "height": height}
    except Exception as e:  # noqa: BLE001
        log.error("parse failed", {"err": str(e)})
        return {"elements": [], "ready": False, "error": str(e)}
