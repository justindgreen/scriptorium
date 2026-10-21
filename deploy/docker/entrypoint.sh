#!/bin/sh
# `scriptorium <command>` inside the container runs the server CLI
# (backup, verify-backup, restore, prune, migrate, seed, import-content, sources).
exec node /app/dist/cli.js "$@"
