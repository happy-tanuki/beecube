#!/bin/sh
# Builds collision.wasm (needs Rust with the wasm32-unknown-unknown target).
set -e
cd "$(dirname "$0")"
cargo build --release --target wasm32-unknown-unknown
cp target/wasm32-unknown-unknown/release/collision.wasm collision.wasm
