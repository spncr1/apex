-- Keep a recurring occurrence tied to its original weekday when its dated
-- instance is moved or replaced. The effective date and template may change.
alter table public.planned_workouts
  add column recurrence_template_id uuid,
  add column recurrence_date date;

update public.planned_workouts
set recurrence_template_id = template_id, recurrence_date = planned_date
where is_recurring;

alter table public.planned_workouts
  add constraint recurring_origin_required check (
    (is_recurring and recurrence_template_id is not null and recurrence_date is not null)
    or (not is_recurring and recurrence_template_id is null and recurrence_date is null)
  );

drop index public.planned_workouts_recurring_occurrence_key;
create unique index planned_workouts_recurring_occurrence_key
  on public.planned_workouts (user_id, recurrence_template_id, recurrence_date)
  where is_recurring;

create or replace function public.materialize_planned_week(
  p_week_start date, p_today date
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_occurrence record;
  v_plan_id uuid;
  v_count integer := 0;
begin
  if v_user_id is null then raise exception 'Sign in required'; end if;
  if p_week_start is null or p_today is null
     or extract(isodow from p_week_start) <> 1 then
    raise exception 'Week must start on Monday';
  end if;

  for v_occurrence in
    select t.id as template_id, t.name, t.goal_label, t.revision,
           p_week_start + (tw.weekday - 1) as planned_date
    from public.workout_templates t
    join public.template_weekdays tw on tw.template_id = t.id
    where t.user_id = v_user_id and tw.user_id = v_user_id
  loop
    if v_occurrence.planned_date < p_today then continue; end if;
    v_plan_id := null;
    insert into public.planned_workouts
      (user_id, template_id, planned_date, name_snapshot, goal_snapshot,
       source_template_revision, is_recurring, recurrence_template_id,
       recurrence_date)
    values
      (v_user_id, v_occurrence.template_id, v_occurrence.planned_date,
       v_occurrence.name, v_occurrence.goal_label, v_occurrence.revision,
       true, v_occurrence.template_id, v_occurrence.planned_date)
    on conflict (user_id, recurrence_template_id, recurrence_date)
      where is_recurring do nothing
    returning id into v_plan_id;
    if v_plan_id is not null then
      perform public._copy_template_exercises(
        v_user_id, v_occurrence.template_id, v_plan_id
      );
      v_count := v_count + 1;
    end if;
  end loop;
  return v_count;
end;
$$;

create table public.planned_workout_actions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  action text not null check (action in ('swap', 'replace', 'skip', 'move')),
  primary_plan_id uuid not null,
  primary_before jsonb not null,
  primary_after jsonb not null,
  other_plan_id uuid,
  other_before jsonb,
  other_after jsonb,
  created_at timestamptz not null default now()
);
alter table public.planned_workout_actions enable row level security;
grant select on public.planned_workout_actions to authenticated;
revoke insert, update, delete on public.planned_workout_actions from authenticated;
create policy planned_workout_actions_read_owner
  on public.planned_workout_actions for select to authenticated
  using ((select auth.uid()) = user_id);

create function public.adapt_planned_workout(
  p_action text,
  p_plan_id uuid,
  p_expected_revision integer,
  p_other_plan_id uuid default null,
  p_other_expected_revision integer default null,
  p_template_id uuid default null,
  p_target_date date default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_plan public.planned_workouts%rowtype;
  v_other public.planned_workouts%rowtype;
  v_template public.workout_templates%rowtype;
  v_primary_after jsonb;
  v_other_after jsonb;
begin
  if v_user_id is null then raise exception 'Sign in required'; end if;
  if p_action is null or p_action not in ('swap', 'replace', 'skip', 'move') then
    raise exception 'Unknown workout action';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_user_id::text, 1));

  select * into v_plan from public.planned_workouts
  where id = p_plan_id and user_id = v_user_id for update;
  if not found or v_plan.revision is distinct from p_expected_revision
     or v_plan.status <> 'planned' or exists (
       select 1 from public.workout_sessions
       where user_id = v_user_id and planned_workout_id = p_plan_id
     ) then
    raise exception 'Workout changed or already started. Reload and try again';
  end if;

  if p_action = 'swap' then
    if p_other_plan_id is null or p_other_plan_id = p_plan_id then
      raise exception 'Choose a different workout to swap';
    end if;
    select * into v_other from public.planned_workouts
    where id = p_other_plan_id and user_id = v_user_id for update;
    if not found or v_other.revision is distinct from p_other_expected_revision
       or v_other.status <> 'planned' or exists (
         select 1 from public.workout_sessions
         where user_id = v_user_id and planned_workout_id = p_other_plan_id
       ) then
      raise exception 'Other workout changed or already started. Reload and try again';
    end if;
    if v_plan.planned_date = v_other.planned_date then
      raise exception 'Choose workouts on different dates';
    end if;
    update public.planned_workouts
      set planned_date = v_other.planned_date, is_overridden = true,
          revision = revision + 1, updated_at = now()
      where id = p_plan_id;
    update public.planned_workouts
      set planned_date = v_plan.planned_date, is_overridden = true,
          revision = revision + 1, updated_at = now()
      where id = p_other_plan_id;
    select to_jsonb(pw) into v_other_after from public.planned_workouts pw
      where id = p_other_plan_id;
  elsif p_action = 'replace' then
    select * into v_template from public.workout_templates
      where id = p_template_id and user_id = v_user_id;
    if not found or p_template_id = v_plan.template_id then
      raise exception 'Choose a different template';
    end if;
    update public.planned_workouts
      set template_id = v_template.id, name_snapshot = v_template.name,
          goal_snapshot = v_template.goal_label,
          source_template_revision = v_template.revision,
          is_overridden = true, revision = revision + 1, updated_at = now()
      where id = p_plan_id;
    perform public._copy_template_exercises(v_user_id, v_template.id, p_plan_id);
  elsif p_action = 'skip' then
    update public.planned_workouts
      set status = 'skipped', is_overridden = true,
          revision = revision + 1, updated_at = now()
      where id = p_plan_id;
  else
    if p_target_date is null or p_target_date = v_plan.planned_date then
      raise exception 'Choose a different date';
    end if;
    update public.planned_workouts
      set planned_date = p_target_date, is_overridden = true,
          revision = revision + 1, updated_at = now()
      where id = p_plan_id;
  end if;

  select to_jsonb(pw) into v_primary_after from public.planned_workouts pw
    where id = p_plan_id;
  insert into public.planned_workout_actions
    (user_id, action, primary_plan_id, primary_before, primary_after,
     other_plan_id, other_before, other_after)
  values
    (v_user_id, p_action, p_plan_id, to_jsonb(v_plan), v_primary_after,
     p_other_plan_id, case when p_action = 'swap' then to_jsonb(v_other) end,
     v_other_after);
end;
$$;
revoke all on function public.adapt_planned_workout(text, uuid, integer, uuid, integer, uuid, date) from public, anon;
grant execute on function public.adapt_planned_workout(text, uuid, integer, uuid, integer, uuid, date) to authenticated;

alter table public.session_conflicts
  add column resolution_response jsonb;

create function public.resolve_session_conflict(
  p_conflict_id uuid,
  p_choice text,
  p_local_snapshot jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_conflict public.session_conflicts%rowtype;
  v_plan_id uuid;
  v_revision integer;
  v_current jsonb;
  v_local jsonb;
  v_intervals jsonb;
  v_exercises jsonb;
  v_upload jsonb;
  v_response jsonb;
begin
  if v_user_id is null then raise exception 'Sign in required'; end if;
  select * into v_conflict from public.session_conflicts
    where id = p_conflict_id and user_id = v_user_id;
  if not found then raise exception 'Conflict not found'; end if;
  if v_conflict.status = 'resolved' then return v_conflict.resolution_response; end if;
  if p_choice not in ('local', 'remote') then raise exception 'Choose a session version'; end if;

  v_plan_id := (v_conflict.remote_snapshot #>> '{session,planned_workout_id}')::uuid;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_plan_id::text, 0));
  select * into v_conflict from public.session_conflicts
    where id = p_conflict_id and user_id = v_user_id for update;
  if v_conflict.status = 'resolved' then return v_conflict.resolution_response; end if;
  select revision into v_revision from public.workout_sessions
    where id = v_conflict.session_id and user_id = v_user_id for update;
  if not found then raise exception 'Session not found'; end if;
  v_current := public.session_snapshot_internal(v_conflict.session_id);
  if v_revision <> (v_conflict.remote_snapshot #>> '{session,revision}')::integer then
    update public.session_conflicts set remote_snapshot = v_current
      where id = p_conflict_id;
    return jsonb_build_object('kind', 'changed');
  end if;

  v_local := coalesce(p_local_snapshot, v_conflict.local_snapshot);
  if jsonb_typeof(v_local) <> 'object'
     or (v_local #>> '{session,user_id}')::uuid <> v_user_id
     or (v_local #>> '{session,planned_workout_id}')::uuid <> v_plan_id
     or jsonb_typeof(v_local->'intervals') <> 'array'
     or jsonb_typeof(v_local->'exercises') <> 'array'
     or jsonb_typeof(v_local->'sets') <> 'array' then
    raise exception 'Local session copy is invalid';
  end if;

  if p_choice = 'local' then
    select coalesce(jsonb_agg(jsonb_set(item, '{session_id}', to_jsonb(v_conflict.session_id::text))), '[]'::jsonb)
      into v_intervals from jsonb_array_elements(v_local->'intervals') item;
    select coalesce(jsonb_agg(jsonb_set(item, '{session_id}', to_jsonb(v_conflict.session_id::text))), '[]'::jsonb)
      into v_exercises from jsonb_array_elements(v_local->'exercises') item;
    v_local := jsonb_set(v_local, '{session,id}', to_jsonb(v_conflict.session_id::text));
    v_local := jsonb_set(v_local, '{intervals}', v_intervals);
    v_local := jsonb_set(v_local, '{exercises}', v_exercises);
    v_upload := public.upload_session_snapshot(p_conflict_id, v_revision, v_local);
    if v_upload->>'kind' <> 'applied' then
      raise exception 'Session changed. Reload and try again';
    end if;
    v_response := jsonb_build_object('kind', 'resolved', 'choice', 'local',
      'snapshot', v_upload->'snapshot', 'revision', v_upload->'revision');
  else
    v_response := jsonb_build_object('kind', 'resolved', 'choice', 'remote',
      'snapshot', v_current, 'revision', v_revision);
  end if;

  update public.session_conflicts
  set status = 'resolved', resolved_at = now(),
      rejected_snapshot = case when p_choice = 'local' then v_current else v_local end,
      local_snapshot = v_local, resolution_response = v_response
  where id = p_conflict_id;
  return v_response;
end;
$$;
revoke all on function public.resolve_session_conflict(uuid, text, jsonb) from public, anon;
grant execute on function public.resolve_session_conflict(uuid, text, jsonb) to authenticated;

create function public.restore_session_copy(
  p_conflict_id uuid,
  p_expected_revision integer,
  p_mutation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_conflict public.session_conflicts%rowtype;
  v_plan_id uuid;
  v_revision integer;
  v_snapshot jsonb;
  v_intervals jsonb;
  v_exercises jsonb;
  v_response jsonb;
begin
  if v_user_id is null then raise exception 'Sign in required'; end if;
  if p_mutation_id is null or p_expected_revision is null then
    raise exception 'Expected revision and mutation are required';
  end if;
  select * into v_conflict from public.session_conflicts
    where id = p_conflict_id and user_id = v_user_id and status = 'resolved';
  if not found or v_conflict.rejected_snapshot is null then
    raise exception 'Recoverable copy not found';
  end if;
  v_plan_id := (v_conflict.remote_snapshot #>> '{session,planned_workout_id}')::uuid;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_plan_id::text, 0));
  select response into v_response from public.session_uploads
    where mutation_id = p_mutation_id and user_id = v_user_id;
  if found then return v_response; end if;
  select revision into v_revision from public.workout_sessions
    where id = v_conflict.session_id and user_id = v_user_id for update;
  if not found or v_revision <> p_expected_revision then
    raise exception 'Session changed. Reload and try again';
  end if;
  v_snapshot := v_conflict.rejected_snapshot;
  select coalesce(jsonb_agg(
    case when item->>'ended_at' is null then
      jsonb_set(jsonb_set(item, '{session_id}', to_jsonb(v_conflict.session_id::text)),
        '{ended_at}', to_jsonb(greatest(
          (v_snapshot #>> '{session,updated_at}')::timestamptz,
          (item->>'started_at')::timestamptz)::text))
    else jsonb_set(item, '{session_id}', to_jsonb(v_conflict.session_id::text)) end
  ), '[]'::jsonb)
    into v_intervals from jsonb_array_elements(v_snapshot->'intervals') item;
  select coalesce(jsonb_agg(jsonb_set(item, '{session_id}', to_jsonb(v_conflict.session_id::text))), '[]'::jsonb)
    into v_exercises from jsonb_array_elements(v_snapshot->'exercises') item;
  v_snapshot := jsonb_set(v_snapshot, '{session,id}', to_jsonb(v_conflict.session_id::text));
  v_snapshot := jsonb_set(v_snapshot, '{intervals}', v_intervals);
  v_snapshot := jsonb_set(v_snapshot, '{exercises}', v_exercises);
  v_response := public.upload_session_snapshot(p_mutation_id, v_revision, v_snapshot);
  if v_response->>'kind' <> 'applied' then
    raise exception 'Session changed. Reload and try again';
  end if;
  return v_response;
end;
$$;
revoke all on function public.restore_session_copy(uuid, integer, uuid) from public, anon;
grant execute on function public.restore_session_copy(uuid, integer, uuid) to authenticated;
