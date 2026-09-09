#!/usr/bin/env bash
# Idempotent setup for the SecureLife dev environment.
# Installs Node dependencies and a local PostgreSQL, then provisions the dev
# role/database the Express backend connects to. Safe to run repeatedly.
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_DIR"

echo "==> Installing Node dependencies"
npm install

echo "==> Ensuring PostgreSQL is installed"
if ! command -v pg_ctlcluster >/dev/null 2>&1; then
  sudo apt-get update -qq
  sudo DEBIAN_FRONTEND=noninteractive apt-get install -y postgresql postgresql-contrib
fi

PG_VER="$(pg_lsclusters -h | awk 'NR==1{print $1}')"
echo "==> PostgreSQL version: ${PG_VER}"

echo "==> Starting PostgreSQL cluster to provision the dev role/database"
sudo pg_ctlcluster "${PG_VER}" main start 2>/dev/null || true
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
if ! sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='securelife'" | grep -q 1; then
  sudo -u postgres createdb -O securelife securelife
fi

echo "==> Install complete"
