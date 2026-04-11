create index if not exists idx_annotation_threads_project_page on annotation_threads(project_id, page_key);
create index if not exists idx_annotation_threads_commit on annotation_threads(project_id, commit_sha);
create index if not exists idx_annotation_threads_updated_at on annotation_threads(project_id, updated_at desc);
create index if not exists idx_annotation_messages_thread on annotation_thread_messages(thread_id, created_at);
