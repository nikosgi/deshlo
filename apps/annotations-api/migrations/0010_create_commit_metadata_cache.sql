create table if not exists commit_metadata_cache (
  project_id text not null references projects(project_id) on delete cascade,
  commit_sha text not null,
  message_headline text,
  committed_at timestamptz,
  html_url text,
  branches jsonb not null default '[]'::jsonb,
  parents jsonb not null default '[]'::jsonb,
  fetched_at timestamptz not null default now(),
  primary key (project_id, commit_sha)
);

create index if not exists idx_commit_metadata_cache_project_fetched_at
  on commit_metadata_cache(project_id, fetched_at desc);
