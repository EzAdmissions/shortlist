-- Run in Supabase SQL Editor.
-- Required for database-level dedupe of raw profile discoveries.

create unique index if not exists raw_profiles_source_url_unique_idx
  on raw_profiles (source_url);
