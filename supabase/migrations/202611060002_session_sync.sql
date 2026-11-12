-- Versioned, repeatable uploads for offline workout sessions.
-- Only the owner may upload a session; direct writes to session tables remain denied.

create table public.session_uploads (
  mutation_id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  session_id uuid not null,
  response jsonb not null,
  created_at timestamptz not null default now()
);

create index session_uploads_owner_session_idx on public.session_uploads (user_id, session_id);
alter table public.session_uploads enable row level security;
revoke all on public.session_uploads from anon, authenticated;

-- Two offline devices may both start the same planned workout from revision zero.
alter table public.session_conflicts
  drop constraint session_conflicts_base_revision_check;
alter table public.session_conflicts
  add constraint session_conflicts_base_revision_check check (base_revision >= 0);

create function public.session_snapshot_internal(p_session_id uuid)
returns jsonb
language sql stable
set search_path = ''
as $$
  select jsonb_build_object(
    'session', to_jsonb(s),
    'intervals', coalesce((
      select jsonb_agg(to_jsonb(i) order by i.started_at, i.id)
      from public.session_intervals i where i.session_id = s.id
    ), '[]'::jsonb),
    'exercises', coalesce((
      select jsonb_agg(to_jsonb(e) order by e.id)
      from public.session_exercises e where e.session_id = s.id
    ), '[]'::jsonb),
    'sets', coalesce((
      select jsonb_agg(to_jsonb(l) order by l.session_exercise_id, l.set_number)
      from public.logged_sets l
      join public.session_exercises e on e.id = l.session_exercise_id
      where e.session_id = s.id
    ), '[]'::jsonb)
  )
  from public.workout_sessions s
  where s.id = p_session_id;
$$;

revoke all on function public.session_snapshot_internal(uuid) from public, anon, authenticated;

create function public.upload_session_snapshot(
  p_mutation_id uuid,
  p_base_revision integer,
  p_snapshot jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_session_id uuid;
  v_planned_workout_id uuid;
  v_current_revision integer;
  v_current_owner uuid;
  v_current_plan uuid;
  v_new_revision integer;
  v_remote_snapshot jsonb;
  v_response jsonb;
  v_conflict_id uuid;
begin
  if v_user_id is null then
    raise exception 'Sign in is required' using errcode = '42501';
  end if;

  if p_mutation_id is null or p_base_revision is null or p_base_revision < 0
    or jsonb_typeof(p_snapshot) <> 'object'
    or jsonb_typeof(p_snapshot->'session') <> 'object'
    or jsonb_typeof(p_snapshot->'intervals') <> 'array'
    or jsonb_typeof(p_snapshot->'exercises') <> 'array'
    or jsonb_typeof(p_snapshot->'sets') <> 'array' then
    raise exception 'Invalid session upload' using errcode = '22023';
  end if;

  v_session_id := (p_snapshot #>> '{session,id}')::uuid;
  v_planned_workout_id := (p_snapshot #>> '{session,planned_workout_id}')::uuid;

  if v_session_id is null or v_planned_workout_id is null or not exists (
    select 1 from public.planned_workouts p
    where p.id = v_planned_workout_id and p.user_id = v_user_id
      and p.status <> 'skipped'
  ) then
    raise exception 'Scheduled workout not found' using errcode = '42501';
  end if;

  -- Serialize uploads for one plan, including two first uploads with different
  -- session IDs. The idempotency check must happen after this lock.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_planned_workout_id::text, 0)
  );

  select response into v_response
  from public.session_uploads
  where mutation_id = p_mutation_id and user_id = v_user_id;
  if found then
    return v_response;
  end if;

  -- A session can only contain exercises from its owned dated workout.
  if exists (
    select 1 from jsonb_array_elements(p_snapshot->'exercises') item
    where not exists (
      select 1 from public.planned_exercises p
      where p.planned_workout_id = v_planned_workout_id
        and p.user_id = v_user_id
        and p.exercise_id = (item->>'exercise_id')::uuid
    )
  ) then
    raise exception 'Exercise is not in the scheduled workout' using errcode = '42501';
  end if;

  select revision, user_id, planned_workout_id
    into v_current_revision, v_current_owner, v_current_plan
  from public.workout_sessions
  where id = v_session_id
  for update;

  if v_current_revision is null then
    select id, revision, user_id, planned_workout_id
      into v_session_id, v_current_revision, v_current_owner, v_current_plan
    from public.workout_sessions
    where planned_workout_id = v_planned_workout_id
    for update;
    if not found then
      v_session_id := (p_snapshot #>> '{session,id}')::uuid;
    end if;
  end if;

  if found and (v_current_owner <> v_user_id or v_current_plan <> v_planned_workout_id) then
    raise exception 'Session is not owned by this account' using errcode = '42501';
  end if;

  if v_current_revision is null and p_base_revision <> 0 then
    raise exception 'Session revision not found' using errcode = '22023';
  end if;

  if v_current_revision is not null and v_current_revision <> p_base_revision then
    v_remote_snapshot := public.session_snapshot_internal(v_session_id);
    insert into public.session_conflicts (
      user_id, session_id, base_revision, local_snapshot, remote_snapshot
    ) values (
      v_user_id, v_session_id, p_base_revision, p_snapshot, v_remote_snapshot
    ) returning id into v_conflict_id;

    v_response := jsonb_build_object(
      'kind', 'conflict',
      'conflict_id', v_conflict_id,
      'remote_snapshot', v_remote_snapshot
    );
    insert into public.session_uploads (mutation_id, user_id, session_id, response)
    values (p_mutation_id, v_user_id, v_session_id, v_response);
    return v_response;
  end if;

  v_new_revision := coalesce(v_current_revision, 0) + 1;

  if v_current_revision is null then
    insert into public.workout_sessions (
      id, user_id, planned_workout_id, status, started_at, finished_at,
      comments, revision
    ) values (
      v_session_id, v_user_id, v_planned_workout_id,
      p_snapshot #>> '{session,status}',
      (p_snapshot #>> '{session,started_at}')::timestamptz,
      (p_snapshot #>> '{session,finished_at}')::timestamptz,
      p_snapshot #>> '{session,comments}', v_new_revision
    );
  else
    update public.workout_sessions set
      status = p_snapshot #>> '{session,status}',
      started_at = (p_snapshot #>> '{session,started_at}')::timestamptz,
      finished_at = (p_snapshot #>> '{session,finished_at}')::timestamptz,
      comments = p_snapshot #>> '{session,comments}',
      revision = v_new_revision,
      updated_at = now()
    where id = v_session_id;

    delete from public.logged_sets l
    using public.session_exercises e
    where l.session_exercise_id = e.id and e.session_id = v_session_id;
    delete from public.session_exercises where session_id = v_session_id;
    delete from public.session_intervals where session_id = v_session_id;
  end if;

  insert into public.session_intervals (id, user_id, session_id, started_at, ended_at)
  select
    (item->>'id')::uuid, v_user_id, v_session_id,
    (item->>'started_at')::timestamptz,
    (item->>'ended_at')::timestamptz
  from jsonb_array_elements(p_snapshot->'intervals') item;

  insert into public.session_exercises (
    id, user_id, session_id, exercise_id, name_snapshot
  )
  select
    (item->>'id')::uuid, v_user_id, v_session_id,
    (item->>'exercise_id')::uuid, item->>'name_snapshot'
  from jsonb_array_elements(p_snapshot->'exercises') item;

  insert into public.logged_sets (
    id, user_id, session_exercise_id, set_number, set_type,
    target_reps, target_weight_kg, actual_reps, actual_weight_kg, notes
  )
  select
    (item->>'id')::uuid, v_user_id,
    (item->>'session_exercise_id')::uuid,
    (item->>'set_number')::integer,
    item->>'set_type',
    (item->>'target_reps')::integer,
    (item->>'target_weight_kg')::numeric,
    (item->>'actual_reps')::integer,
    (item->>'actual_weight_kg')::numeric,
    item->>'notes'
  from jsonb_array_elements(p_snapshot->'sets') item;

  update public.planned_workouts set
    status = p_snapshot #>> '{session,status}',
    revision = revision + 1,
    updated_at = now()
  where id = v_planned_workout_id
    and status is distinct from (p_snapshot #>> '{session,status}');

  v_remote_snapshot := public.session_snapshot_internal(v_session_id);
  insert into public.session_revisions (user_id, session_id, revision, snapshot)
  values (v_user_id, v_session_id, v_new_revision, v_remote_snapshot);

  v_response := jsonb_build_object(
    'kind', 'applied',
    'revision', v_new_revision,
    'snapshot', v_remote_snapshot
  );
  insert into public.session_uploads (mutation_id, user_id, session_id, response)
  values (p_mutation_id, v_user_id, v_session_id, v_response);
  return v_response;
end;
$$;

revoke all on function public.upload_session_snapshot(uuid, integer, jsonb) from public, anon;
grant execute on function public.upload_session_snapshot(uuid, integer, jsonb) to authenticated;
