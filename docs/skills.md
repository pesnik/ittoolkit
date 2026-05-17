# Skills (Agent Skills format)

`ittoolkit` ships its own SKILL.md system and is **drop-in compatible
with the Anthropic Agent Skills open standard** ([platform.claude.com /
agentskills.io / github.com/anthropics/skills](https://github.com/anthropics/skills)).
Skills published for Claude Desktop, Claude Code, or any other
Agent-Skills-aware agent will load in this app as-is.

Skills sit *above* tools/MCP in the agent stack:

| Layer | What it does | Where it lives |
|-------|--------------|----------------|
| **Skills** | Teach the agent HOW to do a specific task ("password reset", "M365 admin runbook", "PDF table extraction") | `~/.ittoolkit/skills/<slug>/SKILL.md` |
| **MCP servers** | Give the agent ACCESS to external systems (Postgres, Slack, GitHub) | `~/.ittoolkit/mcp-clients.json` |
| **Tools** | The primitive actions skills compose: `execute_command`, `computer_*`, `<server>__<tool>` | Built into ittoolkit + external MCP |

---

## SKILL.md format

Minimum spec (Anthropic-compatible):

```markdown
---
name: my-skill
description: A clear, complete sentence describing what this skill does and when to use it.
---

# Skill body

Instructions the model follows when the skill activates.

## Examples
- …

## Guidelines
- …
```

Only `name` and `description` are required. Everything below is an
`ittoolkit` extension — omitting any of them is fine, defaults are
sensible:

| Field | Type | Default | Use |
|-------|------|---------|-----|
| `when_to_use` | string | empty | Free-text trigger hint shown in the catalog |
| `allowed-tools` | string\|list | empty (all tools) | Restrict which tools the skill may call |
| `disable-model-invocation` | bool | `false` | Skill is user-invokable only (`/skill-name`) — model can't pick it |
| `user-invocable` | bool | `true` | Show in the slash-command menu |
| `arguments` | string\|list | empty | Named arguments parsed from `/skill <args>` |
| `argument-hint` | string | empty | Placeholder displayed in the slash-command menu |

A published Anthropic skill that uses only the two required fields will
load with no warnings; ittoolkit's extras default to sensible values
and the body executes as written.

---

## Progressive disclosure

Same model as Anthropic's:

- **At planner load time**: each skill contributes its `name` +
  `description` to the catalog (~50 tokens per skill in the current
  format).
- **When the planner activates a skill**: ittoolkit reads the full
  SKILL.md from disk and injects it as a system message ahead of the
  user turn.
- **Bundled resources** (scripts, reference markdown, templates): live
  alongside SKILL.md in the same directory. Reference them by relative
  path; the skill's body tells the agent to read them via
  `execute_command cat <path>` when needed. Tokens only enter context
  on demand.

This keeps the per-skill cost paid up-front bounded (you can install
dozens) and the per-activation cost capped by the SKILL.md size itself.

---

## Compatibility test fixture

`src-tauri/src/skills.rs::compat_tests` pins our parser against the
Anthropic spec floor:

- `minimum_anthropic_spec_two_fields` — bare `name` + `description`.
- `pdf_skill_shape` — frontmatter shape used by `github.com/anthropics/skills/pdf`.
- `pptx_skill_shape` — frontmatter shape used by `github.com/anthropics/skills/pptx`.
- `description_is_required_for_meaningful_pickup` — fallback when
  description is omitted (first body line).
- `extension_fields_dont_break_compat` — extension-only frontmatter
  still parses.
- `frontmatter_with_blank_lines_inside_yaml` — multi-line block scalars.

Run with `cargo test --manifest-path src-tauri/Cargo.toml --lib compat_tests`.

If a published Anthropic skill ever fails to load, add it as a new
fixture so the regression is visible from then on.

---

## Installing a skill

Drop a directory under `~/.ittoolkit/skills/`:

```
~/.ittoolkit/skills/
  pdf/
    SKILL.md
    scripts/
      extract_tables.py
  okta-unlock/
    SKILL.md
```

The app auto-discovers it on next launch. Restart the chat to reload
the catalog into the planner.

---

## Why our own SKILL.md system exists

`ittoolkit`'s SKILL.md system pre-dates the formalization of Anthropic
Agent Skills as an open standard. Both ended up at the same primitive
(Markdown body + YAML frontmatter dropped into a versioned directory).
We stayed compatible deliberately so users can move skills between
agents without converting formats. If Anthropic's spec adds a required
field upstream, we'll mirror it; if our extensions become widely useful,
we'll propose them.
