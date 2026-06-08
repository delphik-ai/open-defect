create table if not exists public.open_defect_sync_runs (
  id uuid primary key default gen_random_uuid(),
  source_commit text,
  artifact_count integer not null default 0,
  status text not null default 'completed' check (status in ('running', 'completed', 'failed')),
  summary jsonb not null default '{}'::jsonb,
  started_at timestamptz not null default now(),
  completed_at timestamptz
);

create table if not exists public.open_defect_artifacts (
  id text primary key,
  benchmark_name text not null,
  scope text not null check (scope in ('task_specific', 'benchmark_level')),
  task_names text[] not null default '{}',
  resolution text not null check (resolution in ('found', 'fixing', 'fixed')),
  title text not null,
  summary text not null,
  defect_type_main text,
  defect_type_sub text,
  canonical_source_url text not null,
  evidence_urls text[] not null default '{}',
  audit_level text not null check (audit_level in ('L1', 'L2', 'L3')),
  first_reported_at timestamptz not null,
  last_reviewed_at timestamptz not null,
  decision_note text not null,
  artifact_path text not null,
  artifact jsonb not null,
  sync_run_id uuid references public.open_defect_sync_runs(id) on delete set null,
  synced_at timestamptz not null default now()
);

create table if not exists public.open_defect_artifact_tasks (
  artifact_id text not null references public.open_defect_artifacts(id) on delete cascade,
  benchmark_name text not null,
  task_name text not null,
  resolution text not null check (resolution in ('found', 'fixing', 'fixed')),
  artifact_path text not null,
  sync_run_id uuid references public.open_defect_sync_runs(id) on delete set null,
  synced_at timestamptz not null default now(),
  primary key (artifact_id, task_name)
);

create index if not exists open_defect_artifacts_benchmark_idx
  on public.open_defect_artifacts(benchmark_name);

create index if not exists open_defect_artifacts_resolution_idx
  on public.open_defect_artifacts(resolution);

create index if not exists open_defect_artifact_tasks_benchmark_task_idx
  on public.open_defect_artifact_tasks(benchmark_name, task_name);

drop view if exists public.open_benchmark_health;
drop view if exists public.open_defect_health_rows;

create view public.open_defect_health_rows as
select
  id as artifact_id,
  benchmark_name,
  resolution,
  scope,
  null::text as task_name,
  id as health_key
from public.open_defect_artifacts
where scope = 'benchmark_level'
union all
select
  artifact_id,
  benchmark_name,
  resolution,
  'task_specific'::text as scope,
  task_name,
  benchmark_name || ':' || resolution || ':' || task_name as health_key
from public.open_defect_artifact_tasks;

create view public.open_benchmark_health as
select
  benchmark_name,
  count(distinct health_key) filter (where resolution = 'found')::integer as found,
  count(distinct health_key) filter (where resolution = 'fixing')::integer as fixing,
  count(distinct health_key) filter (where resolution = 'fixed')::integer as fixed,
  count(distinct health_key)::integer as total
from public.open_defect_health_rows
group by benchmark_name;

alter table public.open_defect_sync_runs enable row level security;
alter table public.open_defect_artifacts enable row level security;
alter table public.open_defect_artifact_tasks enable row level security;

drop policy if exists "open_defect_sync_runs_public_read" on public.open_defect_sync_runs;
drop policy if exists "open_defect_artifacts_public_read" on public.open_defect_artifacts;
drop policy if exists "open_defect_artifact_tasks_public_read" on public.open_defect_artifact_tasks;

create policy "open_defect_sync_runs_public_read"
  on public.open_defect_sync_runs for select
  using (true);

create policy "open_defect_artifacts_public_read"
  on public.open_defect_artifacts for select
  using (true);

create policy "open_defect_artifact_tasks_public_read"
  on public.open_defect_artifact_tasks for select
  using (true);

grant select on public.open_defect_sync_runs to anon, authenticated;
grant select on public.open_defect_artifacts to anon, authenticated;
grant select on public.open_defect_artifact_tasks to anon, authenticated;
grant select on public.open_defect_health_rows to anon, authenticated;
grant select on public.open_benchmark_health to anon, authenticated;
