#!/usr/bin/env python3
"""Generate deterministic contract snapshots for Rust migration planning.

The extractor intentionally favors explicit, machine-readable artifacts over prose.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, Iterable, List, Tuple


REPO_ROOT = Path(__file__).resolve().parents[2]
OUTPUT_DIR = REPO_ROOT / "docs" / "rust-migration" / "contracts"


def _line_for_offset(text: str, offset: int) -> int:
    return text.count("\n", 0, offset) + 1


@dataclass(frozen=True)
class SnapshotFile:
    name: str
    value: object


def parse_backend_api_contract() -> List[Dict[str, object]]:
    path = REPO_ROOT / "backend" / "handlers" / "handlers.go"
    text = path.read_text(encoding="utf-8")

    pattern = re.compile(
        r"(getAPIRouterNoError|getAPIRouter)\([^)]*\)\("  # wrapper
        r'"([^"]+)"\s*,\s*'  # endpoint path
        r"([^)]+?)\)\.Methods\("  # handler expression
        r'"([A-Z]+)"\)',
        re.MULTILINE,
    )
    entries: List[Dict[str, object]] = []
    for m in pattern.finditer(text):
        wrapper, endpoint, handler_expr, method = m.groups()
        entries.append(
            {
                "method": method,
                "path": endpoint,
                "handler": " ".join(handler_expr.split()),
                "error_wrapped": wrapper == "getAPIRouter",
                "source": "backend/handlers/handlers.go",
                "line": _line_for_offset(text, m.start()),
            }
        )

    # Websocket/events endpoint is registered with HandleFunc instead of Methods(...).
    ws_pattern = re.compile(r'apiRouter\.HandleFunc\("([^"]+)",\s*([^)]+)\)')
    for m in ws_pattern.finditer(text):
        endpoint, handler_expr = m.groups()
        entries.append(
            {
                "method": "GET",
                "path": endpoint,
                "handler": " ".join(handler_expr.split()),
                "error_wrapped": False,
                "transport": "websocket",
                "source": "backend/handlers/handlers.go",
                "line": _line_for_offset(text, m.start()),
            }
        )

    dedup: Dict[Tuple[str, str], Dict[str, object]] = {}
    for entry in entries:
        key = (str(entry["method"]), str(entry["path"]))
        dedup[key] = entry
    return [dedup[k] for k in sorted(dedup)]


def _iter_backend_go_files() -> Iterable[Path]:
    for path in sorted((REPO_ROOT / "backend").rglob("*.go")):
        yield path


def parse_event_subjects() -> List[Dict[str, object]]:
    literal_pattern = re.compile(r'Subject:\s*"([^"]+)"')
    format_pattern = re.compile(r'Subject:\s*fmt\.Sprintf\("([^"]+)"')

    out: List[Dict[str, object]] = []
    for path in _iter_backend_go_files():
        rel = path.relative_to(REPO_ROOT).as_posix()
        text = path.read_text(encoding="utf-8")

        for m in literal_pattern.finditer(text):
            out.append(
                {
                    "subject": m.group(1),
                    "kind": "literal",
                    "source": rel,
                    "line": _line_for_offset(text, m.start()),
                }
            )

        for m in format_pattern.finditer(text):
            out.append(
                {
                    "subject": m.group(1),
                    "kind": "format",
                    "source": rel,
                    "line": _line_for_offset(text, m.start()),
                }
            )

    dedup: Dict[Tuple[str, str], Dict[str, object]] = {}
    for entry in out:
        key = (str(entry["kind"]), str(entry["subject"]))
        # Keep earliest source occurrence for reproducibility.
        existing = dedup.get(key)
        if existing is None or (entry["source"], entry["line"]) < (
            existing["source"],
            existing["line"],
        ):
            dedup[key] = entry
    return [dedup[k] for k in sorted(dedup)]


def parse_qt_ffi_exports() -> List[Dict[str, str]]:
    path = REPO_ROOT / "frontends" / "qt" / "libserver.h"
    text = path.read_text(encoding="utf-8")
    pattern = re.compile(r"extern\s+void\s+([A-Za-z0-9_]+)\(([^)]*)\);")

    out: List[Dict[str, str]] = []
    for m in pattern.finditer(text):
        name, signature = m.groups()
        out.append({"name": name, "signature": signature.strip()})
    return out


def parse_mobile_bridge_contract() -> Dict[str, object]:
    path = REPO_ROOT / "backend" / "mobileserver" / "mobileserver.go"
    text = path.read_text(encoding="utf-8")

    exported_functions = sorted(
        {
            m.group(1)
            for m in re.finditer(r"(?m)^func\s+([A-Z][A-Za-z0-9_]*)\(", text)
        }
    )

    exported_consts = sorted(
        {
            m.group(1)
            for m in re.finditer(
                r"(?m)^\s*([A-Z][A-Za-z0-9_]*)\s+string\s*=", text
            )
        }
    )

    interface_pattern = re.compile(
        r"type\s+([A-Za-z0-9_]+)\s+interface\s*\{([^}]*)\}", re.MULTILINE | re.DOTALL
    )
    interfaces: Dict[str, List[str]] = {}
    for m in interface_pattern.finditer(text):
        iface_name = m.group(1)
        body = m.group(2)
        methods: List[str] = []
        for line in body.splitlines():
            line = line.strip()
            if not line:
                continue
            methods.append(" ".join(line.split()))
        interfaces[iface_name] = methods

    return {
        "source": "backend/mobileserver/mobileserver.go",
        "exported_functions": exported_functions,
        "exported_constants": exported_consts,
        "interfaces": interfaces,
    }


def parse_web_api_usage() -> Dict[str, object]:
    api_dir = REPO_ROOT / "frontends" / "web" / "src" / "api"
    calls: List[Dict[str, object]] = []
    subscriptions: List[Dict[str, object]] = []

    call_pattern = re.compile(r"\b(apiGet|apiPost)\(\s*([`'\"])(.+?)\2", re.DOTALL)
    sub_pattern = re.compile(r"\bsubscribeEndpoint\(\s*([`'\"])(.+?)\1", re.DOTALL)

    for path in sorted(api_dir.glob("*.ts")):
        rel = path.relative_to(REPO_ROOT).as_posix()
        text = path.read_text(encoding="utf-8")

        for m in call_pattern.finditer(text):
            fn_name, _, endpoint = m.groups()
            calls.append(
                {
                    "function": fn_name,
                    "endpoint": endpoint,
                    "dynamic": "${" in endpoint,
                    "source": rel,
                    "line": _line_for_offset(text, m.start()),
                }
            )

        for m in sub_pattern.finditer(text):
            _, subject = m.groups()
            subscriptions.append(
                {
                    "subject": subject,
                    "dynamic": "${" in subject,
                    "source": rel,
                    "line": _line_for_offset(text, m.start()),
                }
            )

    def dedup(rows: List[Dict[str, object]], key_fields: Tuple[str, ...]) -> List[Dict[str, object]]:
        cache: Dict[Tuple[object, ...], Dict[str, object]] = {}
        for row in rows:
            key = tuple(row[field] for field in key_fields)
            existing = cache.get(key)
            if existing is None or (row["source"], row["line"]) < (
                existing["source"],
                existing["line"],
            ):
                cache[key] = row
        return [cache[k] for k in sorted(cache)]

    return {
        "calls": dedup(calls, ("function", "endpoint")),
        "subscriptions": dedup(subscriptions, ("subject",)),
    }


def build_snapshots() -> List[SnapshotFile]:
    backend_api = parse_backend_api_contract()
    event_subjects = parse_event_subjects()
    qt_ffi = parse_qt_ffi_exports()
    mobile_bridge = parse_mobile_bridge_contract()
    web_api_usage = parse_web_api_usage()

    summary = {
        "backend_api_endpoint_count": len(backend_api),
        "event_subject_count": len(event_subjects),
        "qt_ffi_export_count": len(qt_ffi),
        "mobile_exported_function_count": len(mobile_bridge["exported_functions"]),
        "web_api_call_count": len(web_api_usage["calls"]),
        "web_subscription_count": len(web_api_usage["subscriptions"]),
    }

    return [
        SnapshotFile("api-endpoints.json", backend_api),
        SnapshotFile("event-subjects.json", event_subjects),
        SnapshotFile("qt-ffi.json", qt_ffi),
        SnapshotFile("mobile-bridge.json", mobile_bridge),
        SnapshotFile("web-api-usage.json", web_api_usage),
        SnapshotFile("summary.json", summary),
    ]


def json_bytes(value: object) -> bytes:
    return (json.dumps(value, indent=2, sort_keys=True) + "\n").encode("utf-8")


def write_snapshots(snapshots: List[SnapshotFile], output_dir: Path) -> None:
    output_dir.mkdir(parents=True, exist_ok=True)
    for snap in snapshots:
        (output_dir / snap.name).write_bytes(json_bytes(snap.value))


def check_snapshots(snapshots: List[SnapshotFile], output_dir: Path) -> int:
    missing_or_changed: List[str] = []

    for snap in snapshots:
        expected = json_bytes(snap.value)
        target = output_dir / snap.name
        if not target.exists():
            missing_or_changed.append(f"missing: {snap.name}")
            continue
        actual = target.read_bytes()
        if actual != expected:
            missing_or_changed.append(f"changed: {snap.name}")

    if missing_or_changed:
        print("Contract snapshots are stale:")
        for item in missing_or_changed:
            print(f"- {item}")
        print("Run: make rust-contract-freeze")
        return 1

    print("Contract snapshots are up to date.")
    return 0


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=OUTPUT_DIR,
        help="Output directory for generated JSON snapshots.",
    )
    parser.add_argument(
        "--check",
        action="store_true",
        help="Validate existing snapshots without writing files.",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    snapshots = build_snapshots()
    if args.check:
        return check_snapshots(snapshots, args.output_dir)

    write_snapshots(snapshots, args.output_dir)
    print(f"Wrote {len(snapshots)} contract snapshots to {args.output_dir}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
