-- Initial MVP data model. Catalog rows with a null owner_id are approved seed data.
-- User-owned rows carry user_id so row access does not depend on a client filter.

create table public.user_settings (
  user_id uuid primary key references auth.users (id) on delete cascade,
  weekly_goal integer not null default 4 check (weekly_goal > 0),
  updated_at timestamptz not null default now()
);

create table public.muscle_groups (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references auth.users (id) on delete cascade,
  name text not null check (length(btrim(name)) > 0),
  created_at timestamptz not null default now()
);

create unique index muscle_groups_seed_name_key on public.muscle_groups (lower(name)) where owner_id is null;
create unique index muscle_groups_owner_name_key on public.muscle_groups (owner_id, lower(name)) where owner_id is not null;

create table public.muscle_subdivisions (
  id uuid primary key default gen_random_uuid(),
  muscle_group_id uuid not null references public.muscle_groups (id),
  owner_id uuid references auth.users (id) on delete cascade,
  name text not null check (length(btrim(name)) > 0),
  created_at timestamptz not null default now(),
  unique (id, muscle_group_id)
);

create unique index muscle_subdivisions_group_name_key on public.muscle_subdivisions (muscle_group_id, lower(name));

create table public.exercises (
  id uuid primary key default gen_random_uuid(),
  muscle_group_id uuid not null references public.muscle_groups (id),
  muscle_subdivision_id uuid,
  owner_id uuid references auth.users (id) on delete cascade,
  name text not null check (length(btrim(name)) > 0),
  created_at timestamptz not null default now(),
  foreign key (muscle_subdivision_id, muscle_group_id)
    references public.muscle_subdivisions (id, muscle_group_id)
);

create unique index exercises_seed_group_name_key on public.exercises (muscle_group_id, lower(name)) where owner_id is null;
create unique index exercises_owner_group_name_key on public.exercises (owner_id, muscle_group_id, lower(name)) where owner_id is not null;

create table public.workout_templates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null check (length(btrim(name)) > 0),
  goal_label text,
  revision integer not null default 1 check (revision > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id)
);

create table public.template_weekdays (
  template_id uuid not null,
  user_id uuid not null,
  weekday integer not null check (weekday between 1 and 7), -- ISO: Monday = 1.
  primary key (template_id, weekday),
  foreign key (template_id, user_id) references public.workout_templates (id, user_id)
);

create table public.template_exercises (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  template_id uuid not null,
  exercise_id uuid not null references public.exercises (id),
  unique (id, user_id),
  unique (template_id, exercise_id),
  foreign key (template_id, user_id) references public.workout_templates (id, user_id)
);

create table public.template_set_targets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  template_exercise_id uuid not null,
  set_number integer not null check (set_number > 0),
  set_type text not null check (set_type in ('warm_up', 'working')),
  target_reps integer not null check (target_reps >= 0),
  target_weight_kg numeric(8, 2) not null check (target_weight_kg >= 0),
  unique (template_exercise_id, set_number),
  foreign key (template_exercise_id, user_id) references public.template_exercises (id, user_id)
);

create table public.planned_workouts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  template_id uuid not null,
  planned_date date not null,
  name_snapshot text not null check (length(btrim(name_snapshot)) > 0),
  goal_snapshot text,
  source_template_revision integer not null check (source_template_revision > 0),
  is_overridden boolean not null default false,
  status text not null default 'planned'
    check (status in ('planned', 'in_progress', 'completed', 'partial', 'skipped')),
  revision integer not null default 1 check (revision > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id),
  foreign key (template_id, user_id) references public.workout_templates (id, user_id)
);

create index planned_workouts_owner_date_idx on public.planned_workouts (user_id, planned_date);

create table public.planned_exercises (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  planned_workout_id uuid not null,
  exercise_id uuid not null references public.exercises (id),
  name_snapshot text not null check (length(btrim(name_snapshot)) > 0),
  unique (id, user_id),
  unique (planned_workout_id, exercise_id),
  foreign key (planned_workout_id, user_id) references public.planned_workouts (id, user_id)
);

create table public.planned_set_targets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  planned_exercise_id uuid not null,
  set_number integer not null check (set_number > 0),
  set_type text not null check (set_type in ('warm_up', 'working')),
  target_reps integer not null check (target_reps >= 0),
  target_weight_kg numeric(8, 2) not null check (target_weight_kg >= 0),
  unique (planned_exercise_id, set_number),
  foreign key (planned_exercise_id, user_id) references public.planned_exercises (id, user_id)
);

create table public.workout_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  planned_workout_id uuid not null unique,
  status text not null default 'in_progress'
    check (status in ('in_progress', 'completed', 'partial')),
  started_at timestamptz not null,
  finished_at timestamptz,
  comments text,
  revision integer not null default 1 check (revision > 0),
  updated_at timestamptz not null default now(),
  unique (id, user_id),
  foreign key (planned_workout_id, user_id) references public.planned_workouts (id, user_id),
  check (finished_at is null or finished_at >= started_at),
  check ((status = 'in_progress' and finished_at is null) or
         (status in ('completed', 'partial') and finished_at is not null))
);

create table public.session_intervals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  session_id uuid not null,
  started_at timestamptz not null,
  ended_at timestamptz,
  foreign key (session_id, user_id) references public.workout_sessions (id, user_id),
  check (ended_at is null or ended_at >= started_at)
);

create unique index session_one_active_interval_key on public.session_intervals (session_id) where ended_at is null;

create table public.session_exercises (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  session_id uuid not null,
  exercise_id uuid not null references public.exercises (id),
  name_snapshot text not null check (length(btrim(name_snapshot)) > 0),
  unique (id, user_id),
  unique (session_id, exercise_id),
  foreign key (session_id, user_id) references public.workout_sessions (id, user_id)
);

create table public.logged_sets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  session_exercise_id uuid not null,
  set_number integer not null check (set_number > 0),
  set_type text not null check (set_type in ('warm_up', 'working')),
  target_reps integer check (target_reps >= 0),
  target_weight_kg numeric(8, 2) check (target_weight_kg >= 0),
  actual_reps integer check (actual_reps >= 0),
  actual_weight_kg numeric(8, 2) check (actual_weight_kg >= 0),
  notes text,
  unique (session_exercise_id, set_number),
  foreign key (session_exercise_id, user_id) references public.session_exercises (id, user_id),
  check ((actual_reps is null) = (actual_weight_kg is null))
);

create table public.muscle_group_notes (
  user_id uuid not null references auth.users (id) on delete cascade,
  muscle_group_id uuid not null references public.muscle_groups (id),
  notes text not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, muscle_group_id)
);

create table public.exercise_notes (
  user_id uuid not null references auth.users (id) on delete cascade,
  exercise_id uuid not null references public.exercises (id),
  notes text not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, exercise_id)
);

create table public.session_revisions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  session_id uuid not null,
  revision integer not null check (revision > 0),
  snapshot jsonb not null,
  saved_at timestamptz not null default now(),
  unique (session_id, revision),
  foreign key (session_id, user_id) references public.workout_sessions (id, user_id)
);

create table public.session_conflicts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  session_id uuid not null,
  base_revision integer not null check (base_revision > 0),
  local_snapshot jsonb not null,
  remote_snapshot jsonb not null,
  rejected_snapshot jsonb,
  status text not null default 'pending' check (status in ('pending', 'resolved')),
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  foreign key (session_id, user_id) references public.workout_sessions (id, user_id),
  check ((status = 'pending' and resolved_at is null) or
         (status = 'resolved' and resolved_at is not null and rejected_snapshot is not null))
);

-- All private tables have direct user ownership and parent keys that preserve it.
do $$
declare table_name text;
begin
  foreach table_name in array array[
    'user_settings', 'workout_templates', 'template_weekdays',
    'template_exercises', 'template_set_targets', 'planned_workouts',
    'planned_exercises', 'planned_set_targets',
    'muscle_group_notes', 'exercise_notes'
  ] loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('grant select, insert, update, delete on public.%I to authenticated', table_name);
    execute format(
      'create policy %I on public.%I for all to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id)',
      table_name || '_owner', table_name
    );
  end loop;

  -- Session changes must pass through versioned, owner-checked write functions
  -- added with the offline sync milestone. Direct edits would erase history.
  foreach table_name in array array[
    'workout_sessions', 'session_intervals', 'session_exercises',
    'logged_sets', 'session_revisions', 'session_conflicts'
  ] loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('revoke insert, update, delete on public.%I from authenticated', table_name);
    execute format('grant select on public.%I to authenticated', table_name);
    execute format(
      'create policy %I on public.%I for select to authenticated using ((select auth.uid()) = user_id)',
      table_name || '_read_owner', table_name
    );
  end loop;
end $$;

alter table public.muscle_groups enable row level security;
alter table public.muscle_subdivisions enable row level security;
alter table public.exercises enable row level security;
grant select, insert, update, delete on public.muscle_groups, public.muscle_subdivisions, public.exercises to authenticated;

create policy muscle_groups_read on public.muscle_groups for select to authenticated
  using (owner_id is null or owner_id = (select auth.uid()));
create policy muscle_groups_add on public.muscle_groups for insert to authenticated
  with check (owner_id = (select auth.uid()));
create policy muscle_groups_edit on public.muscle_groups for update to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy muscle_groups_remove on public.muscle_groups for delete to authenticated
  using (owner_id = (select auth.uid()));

create policy muscle_subdivisions_read on public.muscle_subdivisions for select to authenticated
  using (owner_id is null or owner_id = (select auth.uid()));
create policy muscle_subdivisions_add on public.muscle_subdivisions for insert to authenticated
  with check (owner_id = (select auth.uid()) and exists (
    select 1 from public.muscle_groups g where g.id = muscle_group_id and g.owner_id = (select auth.uid())
  ));
create policy muscle_subdivisions_edit on public.muscle_subdivisions for update to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()) and exists (
    select 1 from public.muscle_groups g where g.id = muscle_group_id and g.owner_id = (select auth.uid())
  ));
create policy muscle_subdivisions_remove on public.muscle_subdivisions for delete to authenticated
  using (owner_id = (select auth.uid()));

create policy exercises_read on public.exercises for select to authenticated
  using (owner_id is null or owner_id = (select auth.uid()));
create policy exercises_add on public.exercises for insert to authenticated
  with check (owner_id = (select auth.uid()) and exists (
    select 1 from public.muscle_groups g where g.id = muscle_group_id
      and (g.owner_id is null or g.owner_id = (select auth.uid()))
  ) and (muscle_subdivision_id is null or exists (
    select 1 from public.muscle_subdivisions s where s.id = muscle_subdivision_id
      and s.muscle_group_id = muscle_group_id
      and (s.owner_id is null or s.owner_id = (select auth.uid()))
  )));
create policy exercises_edit on public.exercises for update to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()) and exists (
    select 1 from public.muscle_groups g where g.id = muscle_group_id
      and (g.owner_id is null or g.owner_id = (select auth.uid()))
  ) and (muscle_subdivision_id is null or exists (
    select 1 from public.muscle_subdivisions s where s.id = muscle_subdivision_id
      and s.muscle_group_id = muscle_group_id
      and (s.owner_id is null or s.owner_id = (select auth.uid()))
  )));
create policy exercises_remove on public.exercises for delete to authenticated
  using (owner_id = (select auth.uid()));

-- An owned record may only point at visible catalog entries.
create policy template_exercises_catalog on public.template_exercises as restrictive
  for all to authenticated
  using (exists (select 1 from public.exercises e where e.id = exercise_id))
  with check (exists (select 1 from public.exercises e where e.id = exercise_id));
create policy planned_exercises_catalog on public.planned_exercises as restrictive
  for all to authenticated
  using (exists (select 1 from public.exercises e where e.id = exercise_id))
  with check (exists (select 1 from public.exercises e where e.id = exercise_id));
create policy session_exercises_catalog on public.session_exercises as restrictive
  for all to authenticated
  using (exists (select 1 from public.exercises e where e.id = exercise_id))
  with check (exists (select 1 from public.exercises e where e.id = exercise_id));
create policy exercise_notes_catalog on public.exercise_notes as restrictive
  for all to authenticated
  using (exists (select 1 from public.exercises e where e.id = exercise_id))
  with check (exists (select 1 from public.exercises e where e.id = exercise_id));
create policy muscle_group_notes_catalog on public.muscle_group_notes as restrictive
  for all to authenticated
  using (exists (select 1 from public.muscle_groups g where g.id = muscle_group_id))
  with check (exists (select 1 from public.muscle_groups g where g.id = muscle_group_id));
