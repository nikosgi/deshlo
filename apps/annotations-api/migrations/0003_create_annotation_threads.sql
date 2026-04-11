create table if not exists annotation_threads (
  thread_id text primary key,
  project_id text not null references projects(project_id) on delete cascade,
  environment text,
  page_key text not null,
  commit_sha text not null,
  status text not null check (status in ('open','resolved')),
  anchor jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
