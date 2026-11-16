# Changelog

## 0.3.0

First public release.

- Plugin `angular-ls`: connects the Angular language server (`ngserver`) to Claude Code for `.html` files.
- A launcher finds the server and tells it where to look for TypeScript and the Angular language service. The project's own versions are used when the project has them.
- Tests that run without Claude Code: a manifest check and an LSP smoke test against a small Angular project.
