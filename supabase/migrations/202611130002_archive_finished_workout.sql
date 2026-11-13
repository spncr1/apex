-- Hide an accidentally finished workout from the active app without erasing
-- its plan, session, sets, or revision history.
alter table public.planned_workouts
  add column archived_at timestamptz;

alter table public.workout_sessions
  add column archived_at timestamptz;

create function public.archive_finished_workout(
  p_plan_id uuid,
  p_expected_revision integer
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_plan public.planned_workouts%rowtype;
  v_session public.workout_sessions%rowtype;
  v_now timestamptz := now();
begin
  if v_user_id is null then raise exception 'Sign in required'; end if;

  select * into v_plan from public.planned_workouts
    where id = p_plan_id and user_id = v_user_id for update;
  if not found then raise exception 'Workout not found'; end if;
  if v_plan.archived_at is not null then raise exception 'Workout was already removed'; end if;
  if v_plan.revision <> p_expected_revision then
    raise exception 'Workout changed. Refresh and try again';
  end if;
  if v_plan.status not in ('completed', 'partial') then
    raise exception 'Only finished workouts can be removed';
  end if;

  select * into v_session from public.workout_sessions
    where planned_workout_id = p_plan_id and user_id = v_user_id for update;
  if not found or v_session.status not in ('completed', 'partial')
     or v_session.archived_at is not null then
    raise exception 'Finished session not found';
  end if;
  if exists (
    select 1 from public.session_conflicts
    where session_id = v_session.id and user_id = v_user_id and status = 'pending'
  ) then
    raise exception 'Resolve this session conflict before removing the workout';
  end if;

  update public.workout_sessions
    set archived_at = v_now, updated_at = v_now
    where id = v_session.id;
  update public.planned_workouts
    set archived_at = v_now, updated_at = v_now, revision = revision + 1
    where id = p_plan_id;
  return v_session.id;
end;
$$;

revoke all on function public.archive_finished_workout(uuid, integer)
  from public, anon;
grant execute on function public.archive_finished_workout(uuid, integer)
  to authenticated;
