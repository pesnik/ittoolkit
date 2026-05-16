# LLM provider configuration (computer-use harness)

The computer-use harness uses **two** providers in parallel:

| Role        | What it does                                                    | Typical model                                          |
|-------------|-----------------------------------------------------------------|--------------------------------------------------------|
| Planner     | High-level reasoning, tool selection, the chat you talk to      | Claude Sonnet 4.6 / Opus 4.7 via OpenAI-compat        |
| Grounder    | Given a screenshot + target description → returns (x, y) coords | UI-TARS-7B-DPO-Q4_K_M.gguf via llama.cpp (local)       |

Both run through saved providers in Settings → AI → Saved Providers. The
planner is your active chat preset (whatever you usually talk to); the
grounder is a separate preset with the **Use as UI grounder** checkbox.

## Planner setup

Add a saved preset:

| Field          | Value                                              |
|----------------|----------------------------------------------------|
| Name           | Claude (Anthropic)                                 |
| Endpoint       | `https://api.anthropic.com/v1`                     |
| API key        | Your Anthropic API key (`sk-ant-…`)                |
| Model name     | `claude-sonnet-4-6` or `claude-opus-4-7`           |
| Supports vision| **Yes** (required for the agent to see screenshots)|
| Context window | `200000`                                           |

This is the same OpenAI-compat path the rest of the app uses — no
native Anthropic client is shipped. The compat shim handles vision
(`content[].image_url`) and tool calls.

## Grounder setup (UI-TARS local)

Download a UI-TARS GGUF:

```bash
# Via Hugging Face CLI
huggingface-cli download bartowski/UI-TARS-7B-DPO-GGUF \
  UI-TARS-7B-DPO-Q4_K_M.gguf --local-dir ~/llama-models
```

Add a saved preset:

| Field          | Value                                            |
|----------------|--------------------------------------------------|
| Name           | UI-TARS grounder                                 |
| Endpoint       | `http://127.0.0.1:8081/v1`                       |
| API key        | (any non-empty string)                           |
| Model name     | `UI-TARS-7B-DPO-Q4_K_M.gguf`                     |
| Supports vision| **Yes**                                          |
| Use as UI grounder | **Yes**                                      |
| Context window | `8192`                                           |

The bundled llama.cpp provider starts the model on demand. Quantized
variants down to Q3_K_S work; expect ~2 GB RAM and ~1–3 s per
`computer_find` call on Apple Silicon.

The chat preset stays remote (Claude/GPT-4o), the grounder stays local —
the two roles never need to be the same model.

## Perception sidecar (OmniParser, optional)

The perception sidecar pre-filters candidate bounding boxes before
UI-TARS picks coordinates. It's **optional**: when the sidecar is
unavailable, UI-TARS grounds directly from the raw screenshot.

```bash
cd src-tauri/sidecar/perception
python3 -m venv .venv && source .venv/bin/activate
pip install -e ".[omniparser]"
# Then launch the app — the supervisor spawns python -m perception on
# the first computer_find call. First run downloads Florence-2 weights.
```

Skip the install if you only want UI-TARS-only grounding; the harness
still works, with somewhat lower accuracy on dense UIs.

## Vision-capable model gating

Computer-use tools (`computer_screenshot`, `computer_left_click`,
`computer_find`, etc.) only register when:

1. `featureFlags.computerUseAgent` is on (Settings → AI → Computer Use & MCP), AND
2. The active model preset has **Supports vision** checked.

`computer_find` additionally requires a grounder preset (any preset with
**Use as UI grounder** checked). Without one it returns a clear error
the agent will surface back to the user.

## macOS permissions

First-time use of the harness will prompt for two permissions:

- **Screen Recording** — required by xcap for `computer_screenshot`.
- **Accessibility** — required by enigo for clicks / typing / key presses.

Grant both in System Settings → Privacy & Security. The app fails
gracefully (with a readable error) until they're granted.
