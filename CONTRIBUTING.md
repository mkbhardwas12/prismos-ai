# Contributing to PrismOS

> Patent Pending — PrismOS (US Provisional Patent, Feb 2026)

Thank you for your interest in contributing to PrismOS! This document provides guidelines for contributing to the project.

## 🏗️ Development Setup

### Prerequisites

| Tool | Version | Purpose |
|------|---------|---------|
| [Node.js](https://nodejs.org/) | ≥ 18 | Frontend build tooling |
| [Rust](https://rustup.rs/) | ≥ 1.75 | Tauri backend |
| [Ollama](https://ollama.com/) | Latest | Local LLM inference |

### Getting Started

```bash
# Clone the repository
git clone https://github.com/mkbhardwas12/prismos-ai.git
cd prismos-ai

# Install frontend dependencies
npm install

# Pull a local model
ollama pull mistral

# Start Ollama
ollama serve

# Run in development mode
npm run tauri dev
```

## 📋 How to Contribute

### Reporting Bugs

1. Search existing [Issues](https://github.com/mkbhardwas12/prismos-ai/issues) to avoid duplicates
2. Create a new issue with:
   - Clear title describing the bug
   - Steps to reproduce
   - Expected vs. actual behavior
   - OS, Rust version, Node version
   - Screenshots if applicable

### Suggesting Features

1. Open an issue with the `enhancement` label
2. Describe the feature and its use case
3. Reference the patent architecture if relevant

### Submitting Code

1. **Fork** the repository
2. Create a **feature branch**: `git checkout -b feature/amazing-feature`
3. Make your changes
4. Ensure the build passes:
   ```bash
   # Frontend
   npx tsc --noEmit
   npx vite build

   # Backend
   cd src-tauri && cargo check
   cargo test
   ```
5. **Commit** with conventional commits:
   ```
   feat: add amazing feature
   fix: resolve issue with graph rendering
   docs: update README with new instructions
   refactor: simplify refractive core pipeline
   ```
6. **Push** to your fork: `git push origin feature/amazing-feature`
7. Open a **Pull Request** against `main`

## 🧹 Code Style

### TypeScript / React
- Use functional components with hooks
- Type all props and state with TypeScript interfaces
- Keep components focused (< 300 lines)
- Use `useCallback` for functions passed as props

### Rust
- Follow standard `rustfmt` formatting
- Use `Result<T, E>` for error handling (no `unwrap()` in production code)
- Add patent notice header to all source files:
  ```rust
  // Patent Pending — PrismOS (US Provisional Patent, Feb 2026)
  ```
- Add `#[cfg(test)]` test modules where appropriate

### CSS
- Use CSS custom properties (variables) for colors and spacing
- Follow the BEM-like naming convention used throughout
- Add section comment headers for new feature areas

## 📁 Project Structure

```
src/                 → React frontend (TypeScript)
src-tauri/src/       → Rust backend (Tauri)
tests/               → Test documentation
docs/                → Architecture diagrams
```

## 🧪 Testing

```bash
# Frontend type-check
npx tsc --noEmit

# Frontend unit tests
npx vitest run

# Rust backend tests
cd src-tauri && cargo test

# Full production build verification
npm run tauri build
```

Please ensure all checks pass before submitting a PR.

## ⚖️ Patent Notice

**Patent Pending** — PrismOS is protected under a US Provisional Patent (filed February 2026).

The core architectures — Spectrum Graph, Refractive Core, and You-Port — are patent-pending inventions. By contributing, you agree that your contributions may be covered by this patent. All contributors retain their copyright but grant the project a license to use contributions under the project's MIT license.

## 📜 License

By contributing, you agree that your contributions will be licensed under the MIT License.

---

Thank you for helping make PrismOS better! 🔷
