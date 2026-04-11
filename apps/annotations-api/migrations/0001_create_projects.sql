create table if not exists projects (
  project_id text primary key,
  name text not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
