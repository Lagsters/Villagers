#!/usr/bin/env bash
# Bramka jakosci przed commitem: lint, typy, testy jednostkowe.
set -euo pipefail
npx eslint .
npx tsc --noEmit
npx vitest run --reporter=dot
