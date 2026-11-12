-- A recurring occurrence is distinct from a manually added dated workout.
alter table public.planned_workouts
  add column is_recurring boolean not null default false;

create unique index planned_workouts_recurring_occurrence_key
  on public.planned_workouts (user_id, template_id, planned_date)
  where is_recurring;

create or replace function public._copy_template_exercises(
  p_user_id uuid, p_template_id uuid, p_plan_id uuid
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_exercise record;
  v_planned_exercise_id uuid;
begin
  if auth.uid() is distinct from p_user_id or not exists (
    select 1 from public.workout_templates
    where id = p_template_id and user_id = p_user_id
  ) or not exists (
    select 1 from public.planned_workouts
    where id = p_plan_id and user_id = p_user_id and template_id = p_template_id
  ) then
    raise exception 'Workout is not available to this account';
  end if;

  delete from public.planned_set_targets
  where user_id = p_user_id and planned_exercise_id in (
    select id from public.planned_exercises
    where user_id = p_user_id and planned_workout_id = p_plan_id
  );
  delete from public.planned_exercises
  where user_id = p_user_id and planned_workout_id = p_plan_id;

  for v_exercise in
    select te.exercise_id, e.name, te.id as template_exercise_id
    from public.template_exercises te
    join public.exercises e on e.id = te.exercise_id
    where te.user_id = p_user_id and te.template_id = p_template_id
  loop
    insert into public.planned_exercises
      (user_id, planned_workout_id, exercise_id, name_snapshot)
    values (p_user_id, p_plan_id, v_exercise.exercise_id, v_exercise.name)
    returning id into v_planned_exercise_id;

    insert into public.planned_set_targets
      (user_id, planned_exercise_id, set_number, set_type, target_reps, target_weight_kg)
    select p_user_id, v_planned_exercise_id, set_number, set_type,
           target_reps, target_weight_kg
    from public.template_set_targets
    where user_id = p_user_id
      and template_exercise_id = v_exercise.template_exercise_id;
  end loop;
end;
$$;

revoke all on function public._copy_template_exercises(uuid, uuid, uuid)
  from public, anon, authenticated;

create or replace function public.save_workout_template(
  p_template_id uuid,
  p_expected_revision integer,
  p_name text,
  p_goal_label text,
  p_weekdays integer[],
  p_exercises jsonb,
  p_today date
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_template_id uuid;
  v_revision integer;
  v_weekday integer;
  v_exercise jsonb;
  v_set record;
  v_exercise_id uuid;
  v_template_exercise_id uuid;
  v_seen uuid[] := array[]::uuid[];
  v_plan record;
begin
  if v_user_id is null then raise exception 'Sign in required'; end if;
  if nullif(btrim(p_name), '') is null then
    raise exception 'Template name is required';
  end if;
  if p_today is null or p_weekdays is null or p_exercises is null
     or jsonb_typeof(p_exercises) <> 'array'
     or jsonb_array_length(p_exercises) = 0 then
    raise exception 'Add at least one exercise and a valid date';
  end if;
  foreach v_weekday in array p_weekdays loop
    if v_weekday not between 1 and 7 then
      raise exception 'Weekdays must be 1 through 7';
    end if;
  end loop;

  if p_template_id is null then
    insert into public.workout_templates (user_id, name, goal_label)
    values (v_user_id, btrim(p_name), nullif(btrim(p_goal_label), ''))
    returning id, revision into v_template_id, v_revision;
  else
    update public.workout_templates
    set name = btrim(p_name), goal_label = nullif(btrim(p_goal_label), ''),
        revision = revision + 1, updated_at = now()
    where id = p_template_id and user_id = v_user_id
      and revision = p_expected_revision
    returning id, revision into v_template_id, v_revision;
    if v_template_id is null then
      raise exception 'Template changed elsewhere. Reload and try again';
    end if;

    delete from public.template_set_targets
    where user_id = v_user_id and template_exercise_id in (
      select id from public.template_exercises
      where user_id = v_user_id and template_id = v_template_id
    );
    delete from public.template_exercises
    where user_id = v_user_id and template_id = v_template_id;
    delete from public.template_weekdays
    where user_id = v_user_id and template_id = v_template_id;
  end if;

  insert into public.template_weekdays (template_id, user_id, weekday)
  select v_template_id, v_user_id, distinct_weekday
  from (select distinct unnest(p_weekdays) as distinct_weekday) days;

  for v_exercise in select value from jsonb_array_elements(p_exercises) loop
    v_exercise_id := (v_exercise->>'exercise_id')::uuid;
    if v_exercise_id = any(v_seen) or not exists (
      select 1 from public.exercises
      where id = v_exercise_id and (owner_id is null or owner_id = v_user_id)
    ) then
      raise exception 'Exercise is duplicated or unavailable';
    end if;
    v_seen := array_append(v_seen, v_exercise_id);
    if jsonb_typeof(v_exercise->'sets') <> 'array'
       or jsonb_array_length(v_exercise->'sets') = 0 then
      raise exception 'Each exercise needs at least one planned set';
    end if;

    insert into public.template_exercises (user_id, template_id, exercise_id)
    values (v_user_id, v_template_id, v_exercise_id)
    returning id into v_template_exercise_id;

    for v_set in
      select value, ordinality
      from jsonb_array_elements(v_exercise->'sets') with ordinality
    loop
      insert into public.template_set_targets
        (user_id, template_exercise_id, set_number, set_type,
         target_reps, target_weight_kg)
      values (
        v_user_id, v_template_exercise_id, v_set.ordinality,
        v_set.value->>'set_type',
        (v_set.value->>'target_reps')::integer,
        (v_set.value->>'target_weight_kg')::numeric
      );
    end loop;
  end loop;

  -- A removed weekday stops future recurring occurrences that were untouched.
  for v_plan in
    select id from public.planned_workouts pw
    where pw.user_id = v_user_id and pw.template_id = v_template_id
      and pw.is_recurring and pw.planned_date >= p_today
      and pw.status = 'planned' and not pw.is_overridden
      and not (extract(isodow from pw.planned_date)::integer = any(p_weekdays))
      and not exists (
        select 1 from public.workout_sessions s
        where s.user_id = v_user_id and s.planned_workout_id = pw.id
      )
  loop
    delete from public.planned_set_targets
    where user_id = v_user_id and planned_exercise_id in (
      select id from public.planned_exercises
      where user_id = v_user_id and planned_workout_id = v_plan.id
    );
    delete from public.planned_exercises
    where user_id = v_user_id and planned_workout_id = v_plan.id;
    delete from public.planned_workouts
    where id = v_plan.id and user_id = v_user_id;
  end loop;

  -- Keep a user's one-off edits and started workouts exactly as they were.
  for v_plan in
    select id from public.planned_workouts pw
    where pw.user_id = v_user_id and pw.template_id = v_template_id
      and pw.planned_date >= p_today and pw.status = 'planned'
      and not pw.is_overridden
      and not exists (
        select 1 from public.workout_sessions s
        where s.user_id = v_user_id and s.planned_workout_id = pw.id
      )
  loop
    update public.planned_workouts
    set name_snapshot = btrim(p_name), goal_snapshot = nullif(btrim(p_goal_label), ''),
        source_template_revision = v_revision, revision = revision + 1,
        updated_at = now()
    where id = v_plan.id;
    perform public._copy_template_exercises(v_user_id, v_template_id, v_plan.id);
  end loop;

  return v_template_id;
end;
$$;

revoke all on function public.save_workout_template(uuid, integer, text, text, integer[], jsonb, date) from public, anon;
grant execute on function public.save_workout_template(uuid, integer, text, text, integer[], jsonb, date) to authenticated;

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
       source_template_revision, is_recurring)
    values
      (v_user_id, v_occurrence.template_id, v_occurrence.planned_date,
       v_occurrence.name, v_occurrence.goal_label, v_occurrence.revision, true)
    on conflict (user_id, template_id, planned_date) where is_recurring
      do nothing
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

revoke all on function public.materialize_planned_week(date, date) from public, anon;
grant execute on function public.materialize_planned_week(date, date) to authenticated;

create or replace function public.schedule_workout(
  p_template_id uuid, p_planned_date date
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_template public.workout_templates%rowtype;
  v_plan_id uuid;
begin
  if v_user_id is null then raise exception 'Sign in required'; end if;
  if p_planned_date is null then raise exception 'Date is required'; end if;
  select * into v_template from public.workout_templates
  where id = p_template_id and user_id = v_user_id;
  if not found then raise exception 'Template not found'; end if;
  insert into public.planned_workouts
    (user_id, template_id, planned_date, name_snapshot, goal_snapshot,
     source_template_revision, is_recurring)
  values
    (v_user_id, p_template_id, p_planned_date, v_template.name,
     v_template.goal_label, v_template.revision, false)
  returning id into v_plan_id;
  perform public._copy_template_exercises(v_user_id, p_template_id, v_plan_id);
  return v_plan_id;
end;
$$;

revoke all on function public.schedule_workout(uuid, date) from public, anon;
grant execute on function public.schedule_workout(uuid, date) to authenticated;

create or replace function public.save_planned_workout(
  p_plan_id uuid,
  p_expected_revision integer,
  p_name text,
  p_goal_label text,
  p_exercises jsonb
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_revision integer;
  v_exercise jsonb;
  v_set record;
  v_exercise_id uuid;
  v_planned_exercise_id uuid;
  v_exercise_name text;
  v_seen uuid[] := array[]::uuid[];
begin
  if v_user_id is null then raise exception 'Sign in required'; end if;
  if nullif(btrim(p_name), '') is null or p_exercises is null
     or jsonb_typeof(p_exercises) <> 'array'
     or jsonb_array_length(p_exercises) = 0 then
    raise exception 'Name and exercises are required';
  end if;
  update public.planned_workouts pw
  set name_snapshot = btrim(p_name),
      goal_snapshot = nullif(btrim(p_goal_label), ''),
      is_overridden = true, revision = revision + 1, updated_at = now()
  where pw.id = p_plan_id and pw.user_id = v_user_id
    and pw.revision = p_expected_revision and pw.status = 'planned'
    and not exists (
      select 1 from public.workout_sessions s
      where s.user_id = v_user_id and s.planned_workout_id = pw.id
    )
  returning revision into v_revision;
  if v_revision is null then
    raise exception 'Workout changed or already started. Reload and try again';
  end if;

  delete from public.planned_set_targets
  where user_id = v_user_id and planned_exercise_id in (
    select id from public.planned_exercises
    where user_id = v_user_id and planned_workout_id = p_plan_id
  );
  delete from public.planned_exercises
  where user_id = v_user_id and planned_workout_id = p_plan_id;

  for v_exercise in select value from jsonb_array_elements(p_exercises) loop
    v_exercise_id := (v_exercise->>'exercise_id')::uuid;
    if v_exercise_id = any(v_seen) then
      raise exception 'Exercise appears more than once';
    end if;
    v_seen := array_append(v_seen, v_exercise_id);
    select name into v_exercise_name from public.exercises
    where id = v_exercise_id and (owner_id is null or owner_id = v_user_id);
    if v_exercise_name is null then
      raise exception 'Exercise is not available';
    end if;
    if jsonb_typeof(v_exercise->'sets') <> 'array'
       or jsonb_array_length(v_exercise->'sets') = 0 then
      raise exception 'Each exercise needs at least one planned set';
    end if;
    insert into public.planned_exercises
      (user_id, planned_workout_id, exercise_id, name_snapshot)
    values (v_user_id, p_plan_id, v_exercise_id, v_exercise_name)
    returning id into v_planned_exercise_id;
    for v_set in
      select value, ordinality
      from jsonb_array_elements(v_exercise->'sets') with ordinality
    loop
      insert into public.planned_set_targets
        (user_id, planned_exercise_id, set_number, set_type,
         target_reps, target_weight_kg)
      values (
        v_user_id, v_planned_exercise_id, v_set.ordinality,
        v_set.value->>'set_type',
        (v_set.value->>'target_reps')::integer,
        (v_set.value->>'target_weight_kg')::numeric
      );
    end loop;
  end loop;
  return v_revision;
end;
$$;

revoke all on function public.save_planned_workout(uuid, integer, text, text, jsonb) from public, anon;
grant execute on function public.save_planned_workout(uuid, integer, text, text, jsonb) to authenticated;
