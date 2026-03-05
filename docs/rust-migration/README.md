# Rust Migration Assets

This directory contains machine-readable migration assets used to keep Rust work aligned with the existing Go/Qt/mobile behavior.

## Contracts

`contracts/` contains generated snapshots from the current codebase:

- HTTP API endpoints (`backend/handlers/handlers.go`)
- event subjects emitted by backend observable events
- Qt C bridge export signatures
- mobile bridge exported functions and interfaces
- web API usage (`frontends/web/src/api/*.ts`)

Regenerate:

```bash
make rust-contract-freeze
```

Verify (CI-safe):

```bash
make rust-contract-check
```

## Device API Reuse

The device communication layer should reuse the sibling Rust repo at `../bitbox-api-rs`.
The scaffolded `rust/crates/bitbox-device` crate provides the integration point and an optional
feature (`with-bitbox-api-rs`) for wiring in that implementation.
