# Repository Guidelines

This document outlines contribution guidelines for the Codex CN Bridge project.

## Project Structure & Module Organization

```
codex-cn-bridge/
├── src/
│   ├── config.ts           # Configuration loading
│   ├── server.ts           # Express server setup
│   ├── index.ts            # Entry point
│   ├── handlers/
│   │   └── responses.ts    # Responses API endpoint handler
│   ├── translators/
│   │   ├── request.ts      # Responses → Chat Completions translation
│   │   └── response.ts     # Chat Completions → Responses SSE translation
│   └── types.ts            # TypeScript type definitions
├── dist/                   # Compiled output
├── config.yaml             # Example configuration
└── package.json
```

## Build, Test, and Development Commands

| Command         | Description                                                                 |
|-----------------|-----------------------------------------------------------------------------|
| `npm install`   | Install dependencies                                                        |
| `npm run dev`   | Start development server with auto-rebuild                                  |
| `npm run build` | Compile TypeScript to `dist/index.js`                                       |
| `npm start`     | Start production server from compiled output                                |

## Coding Style & Naming Conventions

- **Language**: TypeScript with strict type checking
- **Indentation**: 2 spaces
- **Naming**: Use `camelCase` for variables/functions, `PascalCase` for types/interfaces
- **Formatting**: Prettier is configured (run with `npx prettier --write "src/**/*.ts"`)
- Maintain existing code style when modifying files

## Testing Guidelines

Currently, this project does not have automated tests. When adding new features or fixing bugs, manually verify:
1. The translation protocol works end-to-end with Codex CLI
2. Streaming responses work correctly
3. Function calling (tool use) is properly handled

## Commit & Pull Request Guidelines

- **Commit messages**: Use clear, descriptive messages in English (e.g., "Add support for Qwen model mapping", "Fix function call arguments delta")
- **Pull requests**: Keep changes focused on a single feature or bug fix. Include a clear description of what changed and why.
- Test your changes locally before submitting a PR.

## Architecture Overview

The bridge sits between Codex CLI (using Responses API) and Chinese LLMs (using Chat Completions API):
- Translates requests from Responses API format to Chat Completions
- Translates SSE events from Chat Completions format back to Responses API
- Supports all core features including streaming and function calling

