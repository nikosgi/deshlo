alter table users
  add column if not exists github_access_token text;

alter table users
  add column if not exists github_token_updated_at timestamptz;

alter table projects
  add column if not exists repo_owner text,
  add column if not exists repo_name text,
  add column if not exists repo_full_name text,
  add column if not exists repo_html_url text;

create unique index if not exists idx_projects_owner_repo_full_name_unique
  on projects(owner_user_id, lower(repo_full_name))
  where owner_user_id is not null and repo_full_name is not null;
