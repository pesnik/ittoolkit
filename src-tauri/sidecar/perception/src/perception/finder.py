import base64
import logging
import subprocess
import tempfile
from dataclasses import dataclass, asdict
from pathlib import Path
from typing import Any

log = logging.getLogger(__name__)


@dataclass
class FoundElement:
    x: int
    y: int
    width: int
    height: int
    label: str
    confidence: float = 1.0


def _run_osascript(source: str) -> str:
    proc = subprocess.run(
        ["osascript", "-e", source],
        capture_output=True,
        text=True,
        timeout=10,
    )
    stderr = proc.stderr.strip()
    if proc.returncode != 0:
        if "not allowed assistive access" in stderr.lower():
            log.info(
                "accessibility permission required — "
                "Open System Settings → Privacy & Security → Accessibility and enable Terminal"
            )
        elif "Expected class name" in stderr or "Expected" in stderr:
            log.debug("osascript cannot access UI (likely no Accessibility permission): %s", stderr)
        else:
            log.warning("osascript stderr: %s", stderr)
        return ""
    return proc.stdout.strip()


def _parse_pipe_output(text: str) -> list[FoundElement]:
    if not text or text == "{}":
        return []
    results: list[FoundElement] = []
    for raw in text.split(","):
        raw = raw.strip().strip("{}").strip()
        if not raw:
            continue
        parts = raw.split("|")
        if len(parts) >= 4:
            try:
                results.append(
                    FoundElement(
                        x=int(parts[0]),
                        y=int(parts[1]),
                        width=int(parts[2]),
                        height=int(parts[3]),
                        label=parts[4] if len(parts) > 4 else "",
                        confidence=0.9,
                    )
                )
            except (ValueError, IndexError):
                continue
    return results


def _ax_find(query: str) -> list[FoundElement]:
    escaped_query = query.replace('"', '\\"')
    script = (
        'tell application "System Events"\n'
        '   tell (first application process whose frontmost is true)\n'
        '       try\n'
        f'           set matches to my searchElements(window 1, "{escaped_query}")\n'
        "           return my encodeMatches(matches)\n"
        "       on error\n"
        '           return ""\n'
        "       end try\n"
        "   end tell\n"
        "end tell\n"
        "\n"
        "on searchElements(elem, query)\n"
        "   set results to {}\n"
        "   try\n"
        "       set d to description of elem\n"
        "       if d contains query then\n"
        "           set p to position of elem\n"
        "           set s to size of elem\n"
        "           set end of results to (item 1 of p) & \"|\" & (item 2 of p) & \"|\" & (item 1 of s) & \"|\" & (item 2 of s) & \"|\" & d\n"
        "       end if\n"
        "   end try\n"
        "   if results is {} then\n"
        "       try\n"
        "           set t to title of elem\n"
        "           if t contains query then\n"
        "               set p to position of elem\n"
        "               set s to size of elem\n"
        "               set end of results to (item 1 of p) & \"|\" & (item 2 of p) & \"|\" & (item 1 of s) & \"|\" & (item 2 of s) & \"|\" & t\n"
        "           end if\n"
        "       end try\n"
        "   end if\n"
        "   if results is {} then\n"
        "       try\n"
        "           set n to name of elem\n"
        "           if n contains query then\n"
        "               set p to position of elem\n"
        "               set s to size of elem\n"
        "               set end of results to (item 1 of p) & \"|\" & (item 2 of p) & \"|\" & (item 1 of s) & \"|\" & (item 2 of s) & \"|\" & n\n"
        "           end if\n"
        "       end try\n"
        "   end if\n"
        "   if results is {} then\n"
        "       try\n"
        "           set children to every element of elem\n"
        "           if (count of children) < 200 then\n"
        "               repeat with c in children\n"
        "                   set childResults to my searchElements(c, query)\n"
        "                   set results to results & childResults\n"
        "                   if (count of results) >= 10 then exit repeat\n"
        "               end repeat\n"
        "           end if\n"
        "       end try\n"
        "   end if\n"
        "   return results\n"
        "end searchElements\n"
        "\n"
        "on encodeMatches(matches)\n"
        "   set encoded to \"\"\n"
        "   repeat with m in matches\n"
        "       if encoded is not \"\" then\n"
        "           set encoded to encoded & \",\"\n"
        "       end if\n"
        "       set encoded to encoded & \"{\" & m & \"}\"\n"
        "   end repeat\n"
        "   return encoded\n"
        "end encodeMatches"
    )
    raw = _run_osascript(script)
    return _parse_pipe_output(raw)


ROLE_SCRIPTS = {
    "button": (
        "tell application \"System Events\"\n"
        "   tell (first application process whose frontmost is true)\n"
        "       try\n"
        "           set matches to {}\n"
        "           set allElems to every element of window 1\n"
        "           repeat with elem in allElems\n"
        "               if role of elem is \"AXButton\" then\n"
        "                   set p to position of elem\n"
        "                   set s to size of elem\n"
        "                   set end of matches to (item 1 of p) & \"|\" & (item 2 of p) & \"|\" & (item 1 of s) & \"|\" & (item 2 of s)\n"
        "               end if\n"
        "           end repeat\n"
        "           return matches\n"
        "       on error\n"
        "           return {}\n"
        "       end try\n"
        "   end tell\n"
        "end tell"
    ),
    "text": (
        "tell application \"System Events\"\n"
        "   tell (first application process whose frontmost is true)\n"
        "       try\n"
        "           set matches to {}\n"
        "           set allElems to every element of window 1\n"
        "           repeat with elem in allElems\n"
        "               if role of elem is \"AXTextField\" then\n"
        "                   set p to position of elem\n"
        "                   set s to size of elem\n"
        "                   set end of matches to (item 1 of p) & \"|\" & (item 2 of p) & \"|\" & (item 1 of s) & \"|\" & (item 2 of s)\n"
        "               end if\n"
        "           end repeat\n"
        "           return matches\n"
        "       on error\n"
        "           return {}\n"
        "       end try\n"
        "   end tell\n"
        "end tell"
    ),
    "search": (
        "tell application \"System Events\"\n"
        "   tell (first application process whose frontmost is true)\n"
        "       try\n"
        "           set matches to {}\n"
        "           set allElems to every element of window 1\n"
        "           repeat with elem in allElems\n"
        "               if role of elem is \"AXSearchField\" then\n"
        "                   set p to position of elem\n"
        "                   set s to size of elem\n"
        "                   set end of matches to (item 1 of p) & \"|\" & (item 2 of p) & \"|\" & (item 1 of s) & \"|\" & (item 2 of s)\n"
        "               end if\n"
        "           end repeat\n"
        "           return matches\n"
        "       on error\n"
        "           return {}\n"
        "       end try\n"
        "   end tell\n"
        "end tell"
    ),
    "checkbox": (
        "tell application \"System Events\"\n"
        "   tell (first application process whose frontmost is true)\n"
        "       try\n"
        "           set matches to {}\n"
        "           set allElems to every element of window 1\n"
        "           repeat with elem in allElems\n"
        "               if role of elem is \"AXCheckBox\" then\n"
        "                   set p to position of elem\n"
        "                   set s to size of elem\n"
        "                   set end of matches to (item 1 of p) & \"|\" & (item 2 of p) & \"|\" & (item 1 of s) & \"|\" & (item 2 of s)\n"
        "               end if\n"
        "           end repeat\n"
        "           return matches\n"
        "       on error\n"
        "           return {}\n"
        "       end try\n"
        "   end tell\n"
        "end tell"
    ),
}


def _ax_find_by_role(query: str) -> list[FoundElement]:
    query_lower = query.lower()
    for keyword in ("checkbox", "button", "search", "text"):
        if keyword in query_lower:
            script = ROLE_SCRIPTS[keyword]
            raw = _run_osascript(script)
            return _parse_pipe_output(raw)
    return []


def _ocr_find(query: str, screenshot_b64: str) -> list[FoundElement]:
    try:
        import pytesseract
        from PIL import Image
    except ImportError:
        return []

    try:
        raw = base64.b64decode(screenshot_b64)
        with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as f:
            f.write(raw)
            f.flush()
            fname = f.name

        img = Image.open(fname)
        data = pytesseract.image_to_data(img, output_type=pytesseract.Output.DICT)

        results: list[FoundElement] = []
        query_lower = query.lower()
        n = len(data["text"])
        for i in range(n):
            text = (data["text"][i] or "").strip()
            if not text:
                continue
            if query_lower in text.lower():
                x = data["left"][i]
                y = data["top"][i]
                w = data["width"][i]
                h = data["height"][i]
                conf = data["conf"][i]
                if conf < 0:
                    conf = 0
                results.append(
                    FoundElement(
                        x=x,
                        y=y,
                        width=w,
                        height=h,
                        label=text,
                        confidence=conf / 100.0,
                    )
                )
        return results
    except Exception as e:
        log.warning("ocr find error: %s", e)
        return []
    finally:
        try:
            Path(fname).unlink(missing_ok=True)
        except Exception:
            pass


def handle_find(params: dict[str, Any]) -> list[dict[str, Any]]:
    query: str = params.get("query", "")
    screenshot_b64: str = params.get("screenshot", "")
    if not query:
        return []

    results: list[FoundElement] = []
    seen: set[tuple[int, int, int, int]] = set()

    def add_unique(entries: list[FoundElement]) -> None:
        nonlocal results
        for e in entries:
            key = (e.x, e.y, e.width, e.height)
            if key not in seen:
                seen.add(key)
                results.append(e)

    tier_results = _ax_find(query)
    if tier_results:
        log.info("AX find: %d results for %r", len(tier_results), query)
        add_unique(tier_results)

    if not results:
        tier_results = _ax_find_by_role(query)
        if tier_results:
            log.info("AX role find: %d results for %r", len(tier_results), query)
            add_unique(tier_results)

    if not results and screenshot_b64:
        tier_results = _ocr_find(query, screenshot_b64)
        if tier_results:
            log.info("OCR find: %d results for %r", len(tier_results), query)
            add_unique(tier_results)

    if not results:
        log.info("no elements found for %r", query)

    return [asdict(r) for r in results]
