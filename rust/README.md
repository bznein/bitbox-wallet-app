# Rust Migration Workspace

This workspace is the starting point for the Go -> Rust backend and bridge rewrite.

## Current scope

- `bitbox-contracts`: shared contract constants and wire enums.
- `bitbox-core`: core events/auth primitives.
- `bitbox-device`: device API abstraction with optional `bitbox-api-rs` integration.
- `bitbox-api`: HTTP/API server scaffold.
- `bitbox-bridge`: in-process bridge scaffold.
- `bitbox-ffi-qt`: C ABI scaffold with parity export names for Qt.
- `bitbox-mobile`: mobile bridge scaffold.
- `servewallet-rs`: development entrypoint scaffold.

## Implemented Vertical (initial)

- Bridge query handling for:
  - `GET /api/version`
  - `GET /api/devices/registered`
  - `GET /api/online`
  - `GET /api/config`, `GET /api/config/default`, `POST /api/config` (in-memory app config)
  - `GET /api/native-locale`, `GET /api/detect-dark-theme`, `GET /api/supported-coins`
- Shared event stream and websocket-session compatible `/api/events` semantics:
  - auth gate with `Authorization: Basic <token>`
  - pre-auth event buffering
  - post-auth event drain in-order
- Optional network server (`bitbox-api` feature `server`) with routes:
  - `GET/POST /api/*endpoint`
  - `GET /api/events` (websocket)
  - API token validation for REST calls when `API_TOKEN` is set
  - Dev-mode CORS parity for Vite origins (`localhost`/`127.0.0.1` + `VITE_PORT`)
  - Raw URL query-string forwarding into bridge requests
- Qt FFI emits push notifications for:
  - `online` (`reload`)
  - `devices/registered` (`reload`, polled)

## Contract freeze artifacts

Run from repo root:

```bash
make rust-contract-freeze
```

This generates JSON snapshots in `docs/rust-migration/contracts` from current Go/TS/C interfaces.
Use `make rust-contract-check` in CI to detect contract drift.

## Reusing The Sibling `bitbox-api-rs` Repo

The device protocol should come from the existing Rust repo in the parent directory
(`../bitbox-api-rs`), not from a reimplementation in this workspace.

`bitbox-device` is configured to use that sibling repo via a path dependency.

Then enable the feature where needed:

```bash
cargo check -p bitbox-device --features with-bitbox-api-rs
cargo check -p bitbox-device --features with-bitbox-api-rs-usb
```

On Linux, the USB feature needs `libudev` development headers installed.
