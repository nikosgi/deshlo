create table if not exists users (
  user_id text primary key,
  github_id text not null unique,
  email text,
  name text,
  avatar_url text,
  created_at timestamptz not null default now()
);

create index if not exists idx_users_github_id on users(github_id);
