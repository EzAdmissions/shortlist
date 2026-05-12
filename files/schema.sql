-- ─────────────────────────────────────────────────────────────────────────────
-- Shortlist — Supabase Schema
-- Run this in your Supabase SQL editor (supabase.com → SQL Editor)
-- ─────────────────────────────────────────────────────────────────────────────


-- ── 1. Firm cache ─────────────────────────────────────────────────────────────
-- One row per firm. Stores the full PDL response for that firm.
-- Shared across ALL schools — the key to keeping PDL costs near zero.
--
-- firm_name is the primary key, so upserts are safe (no duplicates).
-- profiles is a JSONB array of raw PDL person objects.

create table if not exists firm_cache (
  firm_name     text        primary key,
  profiles      jsonb       not null default '[]',
  total_found   int         not null default 0,
  cached_at     timestamptz not null default now(),
  refresh_after timestamptz not null default (now() + interval '7 days')
);

-- Index for staleness checks (used in cache invalidation queries)
create index if not exists firm_cache_refresh_idx on firm_cache (refresh_after);

-- RLS: only the service key (backend) can read/write this table.
-- The anon key used in the browser has no access.
alter table firm_cache enable row level security;

create policy "Service key full access"
  on firm_cache
  using (auth.role() = 'service_role');


-- ── 2. Schools ────────────────────────────────────────────────────────────────
-- One row per school that signs up. Used for white-labeling and multi-tenancy
-- in Week 4. Not used by the cache layer — just future-proofing the schema now.

create table if not exists schools (
  id            uuid        primary key default gen_random_uuid(),
  name          text        not null unique,
  email_domain  text        not null unique,  -- e.g. "cornell.edu"
  display_name  text,                          -- e.g. "Cornell Alumni Finder"
  logo_url      text,
  primary_color text        default '#1a1a18',
  created_at    timestamptz not null default now(),
  active        boolean     not null default true
);

alter table schools enable row level security;

create policy "Service key full access"
  on schools
  using (auth.role() = 'service_role');


-- ── 3. Search log ─────────────────────────────────────────────────────────────
-- Optional but valuable: logs every search so you can build analytics later
-- (most searched firms, most active schools, usage over time).
-- Rows are cheap — this costs nothing extra.

create table if not exists search_log (
  id            bigint      generated always as identity primary key,
  user_id       uuid        references auth.users(id),
  school_name   text        not null,
  firm_name     text        not null,
  role_filter   text,
  result_count  int         not null default 0,
  from_cache    boolean     not null default false,
  searched_at   timestamptz not null default now()
);

-- Index for analytics queries (group by firm, school, date)
create index if not exists search_log_firm_idx   on search_log (firm_name);
create index if not exists search_log_school_idx on search_log (school_name);
create index if not exists search_log_date_idx   on search_log (searched_at);

alter table search_log enable row level security;

create policy "Service key full access"
  on search_log
  using (auth.role() = 'service_role');


-- ─────────────────────────────────────────────────────────────────────────────
-- ENVIRONMENT VARIABLES TO ADD
-- ─────────────────────────────────────────────────────────────────────────────
--
-- In your .env (local) and Render dashboard (production), add:
--
--   SUPABASE_URL=https://mjmgwwhzovqnvedisaow.supabase.co
--   SUPABASE_SERVICE_KEY=<your service_role key>
--                        ↑ Find this in Supabase → Settings → API
--                          It's the "service_role" key, NOT the anon key.
--                          Never expose this in frontend code.
--   PDL_KEY=<your PDL key>
--
-- The anon key stays in the frontend (index.html, app.html) for Supabase Auth.
-- The service key stays on the backend only.
--
-- ─────────────────────────────────────────────────────────────────────────────
