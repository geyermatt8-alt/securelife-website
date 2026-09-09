#!/usr/bin/env bash
# Per-boot startup: bring PostgreSQL online for the SecureLife backend.
# Idempotent: tolerates an already-running server and a fresh data volume.
set -euo pipefail

echo "==> Starting PostgreSQL"
sudo service postgresql start
for _ in $(seq 1 30); do sudo -u postgres pg_isready -q && break; sleep 1; done

echo "==> Ensuring dev role and database exist"
sudo -u postgres psql -v ON_ERROR_STOP=1 <<'SQL'
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'securelife') THEN
    CREATE ROLE securelife LOGIN PASSWORD 'securelife';
  END IF;
END
$$;
SQL
sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='securelife'" | grep -q 1 \
  || sudo -u postgres createdb -O securelife securelife

echo "==> PostgreSQL ready"
