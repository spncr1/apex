import { addDays, dateKey } from '../features/home/dates';
import {
  getCachedRead,
  saveCachedRead,
} from '../features/sessions/sessionStore';
import type {
  ExerciseRow,
  PlannedExerciseRow,
  PlannedSetTargetRow,
  PlannedWorkoutRow,
  SetType,
} from '../types/database';
import { supabase } from './supabase';

export interface SetTargetInput {
  set_type: SetType;
  target_reps: number;
  target_weight_kg: number;
}

export interface ExerciseTargetInput {
  exercise_id: string;
  name: string;
  sets: SetTargetInput[];
}

export interface PlanDetail {
  plan: PlannedWorkoutRow;
  exercises: ExerciseTargetInput[];
}

export interface PlanningSnapshot {
  weekStart: string;
  weeklyGoal: number;
  plans: PlanDetail[];
  catalog: ExerciseRow[];
}

export interface PlanningLoadResult {
  snapshot: PlanningSnapshot | null;
  isCached: boolean;
  error: string | null;
}

function check(error: { message: string } | null) {
  if (error) throw new Error(error.message);
}

function asTargets(
  exercises: PlannedExerciseRow[],
  sets: PlannedSetTargetRow[],
): ExerciseTargetInput[] {
  return exercises.map((exercise) => ({
    exercise_id: exercise.exercise_id,
    name: exercise.name_snapshot,
    sets: sets
      .filter((set) => set.planned_exercise_id === exercise.id)
      .sort((a, b) => a.set_number - b.set_number)
      .map((set) => ({
        set_type: set.set_type,
        target_reps: Number(set.target_reps),
        target_weight_kg: Number(set.target_weight_kg),
      })),
  }));
}

async function fetchPlanning(
  accountId: string,
  monday: Date,
): Promise<PlanningSnapshot> {
  if (!supabase) throw new Error('Supabase is not configured.');
  const weekStart = dateKey(monday);
  const weekEnd = dateKey(addDays(monday, 7));

  const [plansResult, catalogResult, settingsResult] = await Promise.all([
    supabase
      .from('planned_workouts')
      .select('*')
      .eq('user_id', accountId)
      .gte('planned_date', weekStart)
      .lt('planned_date', weekEnd)
      .order('planned_date'),
    supabase.from('exercises').select('*').order('name'),
    supabase
      .from('user_settings')
      .select('weekly_goal')
      .eq('user_id', accountId)
      .maybeSingle(),
  ]);
  for (const result of [plansResult, catalogResult, settingsResult])
    check(result.error);

  const plans = (plansResult.data ?? []) as PlannedWorkoutRow[];
  const catalog = (catalogResult.data ?? []) as ExerciseRow[];
  const planIds = plans.map((plan) => plan.id);
  const [plannedExercisesResult, plannedSetsResult] = await Promise.all([
    planIds.length
      ? supabase
          .from('planned_exercises')
          .select('*')
          .eq('user_id', accountId)
          .in('planned_workout_id', planIds)
      : Promise.resolve({ data: [], error: null }),
    planIds.length
      ? supabase
          .from('planned_set_targets')
          .select('*')
          .eq('user_id', accountId)
      : Promise.resolve({ data: [], error: null }),
  ]);
  check(plannedExercisesResult.error);
  check(plannedSetsResult.error);
  const plannedExercises = (plannedExercisesResult.data ??
    []) as PlannedExerciseRow[];
  const plannedSets = (plannedSetsResult.data ?? []) as PlannedSetTargetRow[];

  return {
    weekStart,
    weeklyGoal: settingsResult.data?.weekly_goal ?? 4,
    catalog,
    plans: plans.map((plan) => ({
      plan,
      exercises: asTargets(
        plannedExercises.filter((row) => row.planned_workout_id === plan.id),
        plannedSets,
      ),
    })),
  };
}

export async function loadPlanning(
  accountId: string,
  monday: Date,
  offline: boolean,
): Promise<PlanningLoadResult> {
  const cacheKey = `planning:${dateKey(monday)}`;
  if (offline) {
    const snapshot = await getCachedRead<PlanningSnapshot>(
      accountId,
      cacheKey,
    ).catch(() => null);
    return { snapshot, isCached: snapshot !== null, error: null };
  }
  try {
    const snapshot = await fetchPlanning(accountId, monday);
    await saveCachedRead(accountId, cacheKey, snapshot).catch(() => {
      // A remote read remains usable when the optional offline copy fails.
    });
    return { snapshot, isCached: false, error: null };
  } catch (issue) {
    const snapshot = await getCachedRead<PlanningSnapshot>(
      accountId,
      cacheKey,
    ).catch(() => null);
    return {
      snapshot,
      isCached: snapshot !== null,
      error: issue instanceof Error ? issue.message : 'Could not load plan.',
    };
  }
}

function payload(exercises: ExerciseTargetInput[]) {
  return exercises.map(({ exercise_id, sets }) => ({ exercise_id, sets }));
}

export async function createPlannedWorkout(input: {
  id: string;
  date: string;
  name: string;
  goal: string;
  exercises: ExerciseTargetInput[];
}) {
  if (!supabase) throw new Error('Supabase is not configured.');
  const { error } = await supabase.rpc('create_planned_workout', {
    p_plan_id: input.id,
    p_planned_date: input.date,
    p_name: input.name,
    p_goal_label: input.goal,
    p_exercises: payload(input.exercises),
  });
  check(error);
}

export async function savePlannedWorkout(input: {
  id: string;
  revision: number;
  name: string;
  goal: string;
  exercises: ExerciseTargetInput[];
}) {
  if (!supabase) throw new Error('Supabase is not configured.');
  const { error } = await supabase.rpc('save_planned_workout', {
    p_plan_id: input.id,
    p_expected_revision: input.revision,
    p_name: input.name,
    p_goal_label: input.goal,
    p_exercises: payload(input.exercises),
  });
  check(error);
}

export async function adaptPlannedWorkout(input: {
  action: 'swap' | 'skip' | 'move';
  planId: string;
  revision: number;
  otherPlanId?: string;
  otherRevision?: number;
  targetDate?: string;
}) {
  if (!supabase) throw new Error('Supabase is not configured.');
  const { error } = await supabase.rpc('adapt_planned_workout', {
    p_action: input.action,
    p_plan_id: input.planId,
    p_expected_revision: input.revision,
    p_other_plan_id: input.otherPlanId ?? null,
    p_other_expected_revision: input.otherRevision ?? null,
    p_template_id: null,
    p_target_date: input.targetDate ?? null,
  });
  check(error);
}

export async function loadSwapCandidates(
  accountId: string,
  excludePlanId: string,
  sourceDate: string,
): Promise<PlannedWorkoutRow[]> {
  if (!supabase) throw new Error('Supabase is not configured.');
  const { data, error } = await supabase
    .from('planned_workouts')
    .select('*')
    .eq('user_id', accountId)
    .eq('status', 'planned')
    .neq('id', excludePlanId)
    .neq('planned_date', sourceDate)
    .order('planned_date');
  check(error);
  return (data ?? []) as PlannedWorkoutRow[];
}

export async function saveWeeklyGoal(accountId: string, goal: number) {
  if (!supabase) throw new Error('Supabase is not configured.');
  if (!Number.isInteger(goal) || goal < 1 || goal > 99) {
    throw new Error('Weekly goal must be between 1 and 99.');
  }
  const { error } = await supabase.from('user_settings').upsert({
    user_id: accountId,
    weekly_goal: goal,
    updated_at: new Date().toISOString(),
  });
  check(error);
}
