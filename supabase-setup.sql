create table if not exists public.packages (
  id bigint generated always as identity primary key,
  title text not null,
  summary text not null default '公开 ZIP 资源。',
  filename text not null,
  file_path text not null unique,
  size bigint not null default 0,
  uploaded_at timestamptz not null default now()
);

alter table public.packages enable row level security;

drop policy if exists "public read packages" on public.packages;
create policy "public read packages"
on public.packages
for select
using (true);

drop policy if exists "public insert packages" on public.packages;
create policy "public insert packages"
on public.packages
for insert
with check (true);

insert into storage.buckets (id, name, public)
values ('zip-files', 'zip-files', true)
on conflict (id) do nothing;

drop policy if exists "public read zip files" on storage.objects;
create policy "public read zip files"
on storage.objects
for select
using (bucket_id = 'zip-files');

drop policy if exists "public upload zip files" on storage.objects;
create policy "public upload zip files"
on storage.objects
for insert
with check (bucket_id = 'zip-files');
