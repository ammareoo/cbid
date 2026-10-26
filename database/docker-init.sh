#!/usr/bin/env bash
# Runs once when the Postgres container initialises an empty data directory.
set -euo pipefail
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" <<SQL
CREATE ROLE cbid_owner LOGIN CREATEROLE PASSWORD '${CBID_OWNER_PASSWORD}';
CREATE ROLE cbid_app LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE PASSWORD '${CBID_APP_PASSWORD}';
CREATE DATABASE cbid_lms OWNER cbid_owner;
\connect cbid_lms
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
ALTER SCHEMA public OWNER TO cbid_owner;
REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO cbid_app;
SQL
