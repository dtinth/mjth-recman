# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Code Style Guidelines

- Imports: Use named imports for most packages, `*` imports for RxJS
- Types: Use TypeScript interfaces for object types, zod for runtime validation
- Error handling: Use try/catch blocks with specific error logging
- Naming: camelCase for variables/functions, PascalCase for interfaces
- Formatting: 2-space indentation, trailing commas for multiline
- RxJS patterns: Use pipe() for transformations, proper error handling in streams
- Environment variables: Use @(-.-)/env with zod for validation
- Async: Prefer async/await over raw promises where possible
