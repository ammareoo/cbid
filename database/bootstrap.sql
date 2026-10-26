-- CBID Institute LMS — one-time bootstrap, run as a PostgreSQL superuser.
--
--   psql -U postgres -v owner_pw="'...'" -v app_pw="'...'" -v db=cbid_lms -f database/bootstrap.sql
--
-- Creates two roles:
--   cbid_owner  owns the schema, runs migrations, seed and the background worker.
--               As table owner it bypasses Row-Level Security (see docs/SECURITY.md).
--   cbid_app    used by the API server. Not an owner, NOBYPASSRLS, so every query it
--               runs is subject to the RLS policies in database/migrations/0002_security.sql.
-- Replace the passwords. Never reuse development passwords in production.

\set ON_ERROR_STOP on

SELECT 'CREATE ROLE cbid_owner LOGIN CREATEROLE PASSWORD ' || quote_literal(:owner_pw)
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'cbid_owner') \gexec
SELECT 'CREATE ROLE cbid_app LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE PASSWORD ' || quote_literal(:app_pw)
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'cbid_app') \gexec

SELECT format('CREATE DATABASE %I OWNER cbid_owner', :'db')
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = :'db') \gexec

\connect :db
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
ALTER SCHEMA public OWNER TO cbid_owner;
REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO cbid_app;
