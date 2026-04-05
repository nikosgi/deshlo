alter table projects
  add column if not exists owner_user_id text references users(user_id) on delete set null;

create index if not exists idx_projects_owner_user_id on projects(owner_user_id);
