create table if not exists api_keys (
  key_id text primary key,
  project_id text not null references projects(project_id) on delete cascade,
  api_key text not null unique,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  last_used_at timestamptz
);
