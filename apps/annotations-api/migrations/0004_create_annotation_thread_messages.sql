create table if not exists annotation_thread_messages (
  message_id text primary key,
  thread_id text not null references annotation_threads(thread_id) on delete cascade,
  body text not null,
  author text,
  created_at timestamptz not null default now()
);
