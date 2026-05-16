# Perception sidecar

A Python process that runs OmniParser v2 (Florence-2 captioner + YOLOv8 icon
detector) and exposes a JSON-RPC wire over stdio. The Tauri host
(`src-tauri/src/perception_commands.rs`) spawns this lazily on the first
`computer_find` call to feed candidate bounding boxes into the UI-TARS
grounder.

## Wire protocol

Newline-delimited JSON-RPC 2.0. One JSON document per line.

```jsonc
{ "jsonrpc":"2.0","id":1,"method":"perception.parse",
  "params":{ "image":"<base64 jpeg>" } }
```

```jsonc
{ "jsonrpc":"2.0","id":1,"result":{
    "elements":[{ "bbox":[x1,y1,x2,y2], "role":"button", "text":"Reset" }, …],
    "ready": true
}}
```

## Methods (CU-M4)

- `perception.ping` → `{ ok, pid }`. Liveness check.
- `perception.parse({ image })` → `{ elements, ready }`. When `ready=false`
  the sidecar runs in stub mode (OmniParser models not installed) and
  returns `elements: []`. The agent falls back to UI-TARS-only grounding.

## Running locally (dev)

```bash
# minimal — JSON-RPC stub only (returns no elements; UI-TARS grounds alone)
cd src-tauri/sidecar/perception
python3 -m venv .venv
source .venv/bin/activate
pip install -e .
python -m perception          # waits for JSON-RPC on stdin

# full OmniParser (slow first run while models download)
pip install -e ".[omniparser]"
python -m perception --enable-omniparser
```

Production packaging via PyInstaller is **deferred to CU-M5+**. Dev mode
shells out to `python -m perception` from the cwd (`src-tauri/`). The Rust
supervisor falls back gracefully when Python isn't on PATH — the agent
keeps working, just without perception-step candidates.

## Why a sidecar instead of in-process Rust

OmniParser is published as a PyTorch model with Microsoft-maintained
inference glue. Re-implementing it in Rust would mean writing ONNX export
+ image preprocessing + post-processing from scratch, with no upstream
maintainer. The sidecar is the cheaper integration.
