# Toolkit

A modern team utilities application with a toolshed of features built with:
- **Tauri** (Rust) for the backend
- **Next.js** (React) for the frontend
- **Fluent UI 2** for the design system

## Features
- Storage analyzer and junk file cleaner
- Extensible toolshed architecture for adding team utilities

## Prerequisites
- Node.js (v22 recommended)
- Rust (latest stable)

## How to Run

### Development Mode
To start the application in development mode with hot-reloading:

```bash
npm run tauri dev
```

### Build for Production
To create an optimized executable for your operating system:

```bash
npm run tauri build
```

The executable will be located in `src-tauri/target/release/bundle/`.
