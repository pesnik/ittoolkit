@AGENTS.md

## Claude-specific

- Read/write file operations prefer `Write`/`Read` tools over `echo`/`cat`
- Before editing, read the file first with the `Read` tool
- After commits, push to origin
- Verify with `npm run build` and `cd src-tauri && cargo check` after changes
