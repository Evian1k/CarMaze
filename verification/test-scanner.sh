#!/bin/bash
# CARMAZE scanner-verdict test harness (TEST ONLY — never shipped as a real scanner).
# Contract under test: exit 0 = clean, exit 1 = infected, exit >= 2 = scanner error.
# Behaviour: exit 1 only when the file contains the EICAR-like test marker;
# exit code configurable via HARNESS_EXIT for the error-path tests.
MARKER="EICAR-TEST-HARNESS-SIGNATURE"
if [ -n "$HARNESS_EXIT" ] && [ "$HARNESS_EXIT" != "0" ]; then
  # Still scan first so infected tests remain deterministic, then force the error code.
  if grep -q "$MARKER" "$1" 2>/dev/null; then echo "test-harness: $1 FOUND"; exit 1; fi
  echo "test-harness: forced scanner error (exit $HARNESS_EXIT)" >&2
  exit "$HARNESS_EXIT"
fi
if grep -q "$MARKER" "$1" 2>/dev/null; then echo "test-harness: $1 FOUND"; exit 1; fi
echo "test-harness: $1 OK"
exit 0
