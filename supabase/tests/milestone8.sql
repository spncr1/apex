-- Run against a disposable database after all project migrations.
begin;

insert into auth.users (id) values
  ('00000000-0000-0000-0000-000000000001'),
  ('00000000-0000-0000-0000-000000000002');

insert into public.workout_templates (id, user_id, name) values
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'Push'),
  ('10000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001', 'Pull'),
  ('10000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000001', 'Legs');
insert into public.template_weekdays (template_id, user_id, weekday) values
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 1),
  ('10000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001', 3);
insert into public.template_exercises (user_id, template_id, exercise_id)
select '00000000-0000-0000-0000-000000000001'::uuid, template.id, exercise.id
from (select id from public.workout_templates where user_id = '00000000-0000-0000-0000-000000000001') template
cross join lateral (select id from public.exercises order by name limit 1) exercise;
insert into public.template_set_targets
  (user_id, template_exercise_id, set_number, set_type, target_reps, target_weight_kg)
select '00000000-0000-0000-0000-000000000001', id, 1, 'working', 8, 50
from public.template_exercises where user_id = '00000000-0000-0000-0000-000000000001';

grant usage on schema auth to authenticated;
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';

do $$
declare
  v_push uuid;
  v_pull uuid;
  v_manual uuid;
  v_first uuid := gen_random_uuid();
  v_second uuid := gen_random_uuid();
  v_conflict uuid;
  v_snapshot jsonb;
  v_other jsonb;
  v_result jsonb;
begin
  perform public.materialize_planned_week('2026-11-09', '2026-11-09');
  select id into v_push from public.planned_workouts
    where template_id = '10000000-0000-0000-0000-000000000001';
  select id into v_pull from public.planned_workouts
    where template_id = '10000000-0000-0000-0000-000000000002';
  if v_push is null or v_pull is null then raise exception 'Recurring plans missing'; end if;

  perform public.adapt_planned_workout('move', v_push, 1, p_target_date => '2026-11-11');
  if (select count(*) from public.planned_workouts where planned_date = '2026-11-11') <> 2 then
    raise exception 'Move to occupied date failed';
  end if;
  perform public.materialize_planned_week('2026-11-09', '2026-11-09');
  if (select count(*) from public.planned_workouts) <> 2 then
    raise exception 'Moved recurrence was recreated';
  end if;

  perform public.adapt_planned_workout('replace', v_push, 2,
    p_template_id => '10000000-0000-0000-0000-000000000003');
  perform public.materialize_planned_week('2026-11-09', '2026-11-09');
  if (select count(*) from public.planned_workouts) <> 2
     or (select name from public.workout_templates where id = '10000000-0000-0000-0000-000000000001') <> 'Push'
     or (select name_snapshot from public.planned_workouts where id = v_push) <> 'Legs' then
    raise exception 'Replace changed a template or recreated the occurrence';
  end if;

  perform public.adapt_planned_workout('move', v_push, 3, p_target_date => '2026-11-10');
  perform public.adapt_planned_workout('swap', v_push, 4, v_pull, 1);
  if (select planned_date from public.planned_workouts where id = v_push) <> '2026-11-11'
     or (select planned_date from public.planned_workouts where id = v_pull) <> '2026-11-10' then
    raise exception 'Swap failed';
  end if;
  perform public.adapt_planned_workout('skip', v_pull, 2);
  perform public.materialize_planned_week('2026-11-09', '2026-11-09');
  if (select status from public.planned_workouts where id = v_pull) <> 'skipped'
     or (select count(*) from public.planned_workouts) <> 2 then
    raise exception 'Skip was not retained';
  end if;
  if (select count(*) from public.planned_workout_actions) <> 5 then
    raise exception 'Plan action history missing';
  end if;
  perform set_config('test.victim_plan_id', v_push::text, true);

  v_manual := public.schedule_workout('10000000-0000-0000-0000-000000000003', '2026-11-12');
  v_snapshot := jsonb_build_object('session', jsonb_build_object(
    'id', v_first, 'user_id', '00000000-0000-0000-0000-000000000001',
    'planned_workout_id', v_manual, 'status', 'in_progress',
    'started_at', '2026-11-12T10:00:00Z', 'finished_at', null,
    'comments', 'synced version', 'revision', 0,
    'updated_at', '2026-11-12T10:00:00Z'),
    'intervals', '[]'::jsonb, 'exercises', '[]'::jsonb, 'sets', '[]'::jsonb);
  v_result := public.upload_session_snapshot(gen_random_uuid(), 0, v_snapshot);
  if v_result->>'kind' <> 'applied' then raise exception 'Initial upload failed'; end if;
  begin
    perform public.adapt_planned_workout('skip', v_manual, 2);
    raise exception 'Started workout could be adapted';
  exception when others then
    if sqlerrm = 'Started workout could be adapted' then raise; end if;
  end;

  v_other := jsonb_set(v_snapshot, '{session,id}', to_jsonb(v_second::text));
  v_other := jsonb_set(v_other, '{session,comments}', to_jsonb('device version'::text));
  v_result := public.upload_session_snapshot(gen_random_uuid(), 0, v_other);
  if v_result->>'kind' <> 'conflict' then raise exception 'Concurrent upload did not conflict'; end if;
  v_conflict := (v_result->>'conflict_id')::uuid;
  v_result := public.resolve_session_conflict(v_conflict, 'local', v_other);
  if v_result->>'kind' <> 'resolved'
     or (select comments from public.workout_sessions where id = v_first) <> 'device version'
     or (select rejected_snapshot #>> '{session,comments}' from public.session_conflicts where id = v_conflict) <> 'synced version' then
    raise exception 'Local resolution or rejected copy failed';
  end if;
  if public.resolve_session_conflict(v_conflict, 'local', v_other) <> v_result then
    raise exception 'Resolution was not repeatable';
  end if;
  v_result := public.restore_session_copy(v_conflict, 2, gen_random_uuid());
  if v_result->>'kind' <> 'applied'
     or (select comments from public.workout_sessions where id = v_first) <> 'synced version'
     or (select count(*) from public.session_revisions where session_id = v_first) <> 3 then
    raise exception 'Recoverable copy was not restored with history';
  end if;

  v_other := jsonb_set(v_other, '{session,comments}', to_jsonb('another device version'::text));
  v_result := public.upload_session_snapshot(gen_random_uuid(), 0, v_other);
  if v_result->>'kind' <> 'conflict' then raise exception 'Second conflict missing'; end if;
  v_conflict := (v_result->>'conflict_id')::uuid;
  v_snapshot := jsonb_set(v_snapshot, '{session,comments}', to_jsonb('newer synced version'::text));
  v_result := public.upload_session_snapshot(gen_random_uuid(), 3, v_snapshot);
  if v_result->>'kind' <> 'applied' then raise exception 'Concurrent remote update failed'; end if;
  v_result := public.resolve_session_conflict(v_conflict, 'remote', v_other);
  if v_result->>'kind' <> 'changed'
     or (select remote_snapshot #>> '{session,revision}' from public.session_conflicts where id = v_conflict) <> '4' then
    raise exception 'Stale conflict was not refreshed';
  end if;
  v_result := public.resolve_session_conflict(v_conflict, 'remote', v_other);
  if v_result->>'kind' <> 'resolved'
     or (select rejected_snapshot #>> '{session,comments}' from public.session_conflicts where id = v_conflict) <> 'another device version'
     or (select comments from public.workout_sessions where id = v_first) <> 'newer synced version' then
    raise exception 'Remote resolution failed';
  end if;
  perform set_config('test.victim_conflict_id', v_conflict::text, true);
end;
$$;

set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000002';
do $$
declare
  v_plan uuid;
  v_conflict uuid;
begin
  select id into v_plan from public.planned_workouts limit 1;
  if v_plan is not null then raise exception 'Another account can see private plans'; end if;
  begin
    perform public.adapt_planned_workout('skip',
      current_setting('test.victim_plan_id')::uuid, 1);
    raise exception 'Another account changed a private plan';
  exception when others then
    if sqlerrm = 'Another account changed a private plan' then raise; end if;
  end;
  select id into v_conflict from public.session_conflicts limit 1;
  if v_conflict is not null then raise exception 'Another account can see conflicts'; end if;
  if (select count(*) from public.planned_workout_actions) <> 0 then
    raise exception 'Another account can see plan action history';
  end if;
  begin
    perform public.resolve_session_conflict(
      current_setting('test.victim_conflict_id')::uuid, 'remote', null);
    raise exception 'Another account resolved a private conflict';
  exception when others then
    if sqlerrm = 'Another account resolved a private conflict' then raise; end if;
  end;
end;
$$;

rollback;
