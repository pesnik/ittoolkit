// Authoritative computer-use risk classification (CU-M3).
//
// Mirror of `src/lib/ai/computer-classify.ts`. The frontend already gates
// write actions via the onConfirmExecution prompt before calling us; the
// Rust side re-classifies as defense-in-depth and logs the verdict to the
// audit trail.
//
// Conservative model: ONLY screenshot / screen_size / cursor_position /
// find are autonomous. Everything else (move / click / drag / type / key /
// scroll) is write — a single click can do anything on the user's desktop,
// so we err toward asking.

use serde_json::Value;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ComputerRisk {
    Read,
    Write,
}

impl ComputerRisk {
    pub fn as_str(&self) -> &'static str {
        match self {
            ComputerRisk::Read => "read",
            ComputerRisk::Write => "write",
        }
    }
}

pub fn classify(method: &str, _params: &Value) -> ComputerRisk {
    match method {
        // Read-only methods (CU-M2 set + CU-M4 find).
        "computer.screenshot"
        | "computer_screenshot"
        | "computer.screen_size"
        | "computer_screen_size"
        | "computer.cursor_position"
        | "computer_cursor_position"
        | "computer.find"
        | "computer_find" => ComputerRisk::Read,
        // Everything else — including any future unknown methods — is write.
        _ => ComputerRisk::Write,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn read_methods_are_read() {
        for m in [
            "computer_screenshot",
            "computer_screen_size",
            "computer_cursor_position",
            "computer_find",
        ] {
            assert_eq!(classify(m, &json!({})), ComputerRisk::Read, "{}", m);
        }
    }

    #[test]
    fn write_methods_are_write() {
        for m in [
            "computer_mouse_move",
            "computer_left_click",
            "computer_right_click",
            "computer_double_click",
            "computer_middle_click",
            "computer_left_click_drag",
            "computer_type",
            "computer_key",
            "computer_scroll",
        ] {
            assert_eq!(classify(m, &json!({})), ComputerRisk::Write, "{}", m);
        }
    }

    #[test]
    fn unknown_method_defaults_write() {
        assert_eq!(classify("computer_format_drive", &json!({})), ComputerRisk::Write);
    }
}
