create table if not exists user_sessions (
  session_id text primary key,
  user_id text not null references users(user_id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz,
  revoked_at timestamptz
);

create index if not exists idx_user_sessions_user_id on user_sessions(user_id);
