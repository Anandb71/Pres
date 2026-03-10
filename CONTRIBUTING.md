# Contributing to PResolution

Thanks for your interest in contributing! Here's how to get started.

## Development Setup

```bash
git clone https://github.com/anand/PResolution.git
cd PResolution
npm install
cp .env.example .env
```

## Development Workflow

1. Create a feature branch from `main`
2. Make your changes in `src/`
3. Add tests in `test/`
4. Run `npm test` to verify
5. Run `npx tsc --noEmit` to type-check
6. Submit a PR

## Code Style

- **TypeScript strict mode** is enabled
- Use `async/await` over `.then()` chains
- Every module should have a clear, single responsibility
- Add JSDoc comments to public functions

## Testing

```bash
npm test          # Run all tests
npm run test:watch  # Watch mode
```

All PRs must pass the existing test suite. Add tests for new features.

## Architecture

| Module | Purpose |
|--------|---------|
| `commandParser` | Detects bot commands in comments |
| `contextFetcher` | Fetches PR data via GitHub API |
| `aiEngine` | LLM integration for code fixes |
| `commitEngine` | Git Database API commit flow |
| `replyHandler` | Posts status comments |

## Questions?

Open an issue or start a discussion. We're happy to help!
