#!/bin/bash

# Helper for generating a Supabase ES256 signing key and starting Supabase.
# In production, use the Supabase CLI directly and store the signing key
# securely instead.

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SUPABASE_DIR="$SCRIPT_DIR/../supabase"
SIGNING_KEY_FILE="$SUPABASE_DIR/signing_key.json"

echo "Generating ES256 signing key..."
echo "[]" > "$SIGNING_KEY_FILE"
(cd "$SUPABASE_DIR" && supabase gen signing-key --algorithm ES256 --append)
echo "Signing key generated at: $SIGNING_KEY_FILE"

echo "Starting Supabase..."
cd "$SUPABASE_DIR"
supabase start
