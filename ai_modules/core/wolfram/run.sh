#!/bin/bash

SCRIPT_DIR="$(dirname "${BASH_SOURCE[0]}")"

uv run                                            \
    --directory "$SCRIPT_DIR"                     \
    --exact --no-env-file                         \
    --no-config                                   \
    --python 3.13.3                               \
    --python-preference only-managed              \
    --with black --with pyarrow --with pandas --with zmq --with oauthlib --with Pillow \
    --module wolframclient "$@"