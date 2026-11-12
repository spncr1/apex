-- New workouts are dated plans in their own right. Keep old template rows and
-- their existing dated plans so that workout and session history is preserved.
alter table public.planned_workouts
  alter column template_id drop not null,
  alter column source_template_revision drop not null;

create function public.create_planned_workout(
  p_plan_id uuid,
  p_planned_date date,
  p_name text,
  p_goal_label text,
  p_exercises jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_created_id uuid;
  v_existing public.planned_workouts%rowtype;
begin
  if v_user_id is null then raise exception 'Sign in required'; end if;
  if p_plan_id is null or p_planned_date is null then
    raise exception 'Workout ID and date are required';
  end if;
  if nullif(btrim(p_name), '') is null then
    raise exception 'Workout name is required';
  end if;

  insert into public.planned_workouts
    (id, user_id, planned_date, name_snapshot, goal_snapshot)
  values
    (p_plan_id, v_user_id, p_planned_date, btrim(p_name),
     nullif(btrim(p_goal_label), ''))
  on conflict (id) do nothing
  returning id into v_created_id;

  if v_created_id is null then
    select * into v_existing from public.planned_workouts
      where id = p_plan_id;
    if not found or v_existing.user_id <> v_user_id
       or v_existing.planned_date <> p_planned_date
       or v_existing.name_snapshot <> btrim(p_name) then
      raise exception 'Workout ID is already in use';
    end if;
    return p_plan_id;
  end if;

  -- The existing editor function validates the exercises and set targets.
  -- Its writes share this transaction with the plan insert.
  perform public.save_planned_workout(
    p_plan_id, 1, p_name, p_goal_label, p_exercises
  );
  update public.planned_workouts
    set revision = 1, is_overridden = false
    where id = p_plan_id and user_id = v_user_id;
  return p_plan_id;
end;
$$;

revoke all on function public.create_planned_workout(uuid, date, text, text, jsonb)
  from public, anon;
grant execute on function public.create_planned_workout(uuid, date, text, text, jsonb)
  to authenticated;
