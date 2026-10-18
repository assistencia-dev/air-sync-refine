#!/usr/bin/env bash
# scripts/run-ci-checks.sh
# Run this in CI or locally to execute the required checks for the fix/dbs-control-safe-save branch.
set -euo pipefail

echo "Installing dependencies..."
npm ci

echo "Typecheck..."
npx tsc --noEmit

echo "Running DBS CONTROL smoke checks..."
npm run test:dbs-control

echo "Done. If the commands above succeeded, the branch satisfies typecheck and smoke checks."
