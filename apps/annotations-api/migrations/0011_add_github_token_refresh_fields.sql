alter table users
  add column if not exists github_access_token_encrypted text,
  add column if not exists github_refresh_token_encrypted text,
  add column if not exists github_access_token_expires_at timestamptz,
  add column if not exists github_refresh_token_expires_at timestamptz,
  add column if not exists github_last_token_refresh_at timestamptz;
