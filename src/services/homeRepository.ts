import {
  getCachedRead,
  saveCachedRead,
} from '../features/sessions/sessionStore';
import { addDays, dateKey } from '../features/home/dates';
import type {
  LoggedSetRow,
  PlannedWorkoutRow,
  SessionExerciseRow,
  SessionIntervalRow,
  WorkoutSessionRow,
} from '../types/database';
import { supabase } from './supabase';

export interface RecentWorkout {
  session: WorkoutSessionRow;
  name: string;
  plannedDate: string;
  durationMinutes: number;
  setCount: number;
}

export interface HomeSnapshot {
  weekStart: string;
  weeklyGoal: number | null;
  plans: PlannedWorkoutRow[];
  exerciseCountByPlan: Record<string, number>;
  sessionStatusByPlan: Record<string, WorkoutSessionRow['status']>;
  completedCount: number;
  activeMinutes: number;
  totalExercises: number;
  loggedSets: number;
  recent: RecentWorkout[];
}

export interface HomeLoadResult {
  snapshot: HomeSnapshot | null;
  isCached: boolean;
  error: string | null;
}

function assertNoError(error: { message: string } | null): void {
  if (error) throw new Error(error.message);
}

function activeMillisecondsFor(
  sessionId: string,
  intervals: SessionIntervalRow[],
): number {
  return intervals
    .filter(
      (interval) => interval.session_id === sessionId && interval.ended_at,
    )
    .reduce(
      (sum, interval) =>
        sum +
        Math.max(
          0,
          new Date(interval.ended_at as string).getTime() -
            new Date(interval.started_at).getTime(),
        ),
      0,
    );
}

function activeMinutesFor(
  sessionId: string,
  intervals: SessionIntervalRow[],
): number {
  return Math.round(activeMillisecondsFor(sessionId, intervals) / 60_000);
}

async function fetchHome(
  accountId: string,
  monday: Date,
): Promise<HomeSnapshot> {
  if (!supabase) throw new Error('Supabase is not configured.');

  const weekStart = dateKey(monday);
  const weekEnd = dateKey(addDays(monday, 7));
  const [settingsResult, plansResult, recentResult, performedWeekResult] =
    await Promise.all([
      supabase
        .from('user_settings')
        .select('weekly_goal')
        .eq('user_id', accountId)
        .maybeSingle(),
      supabase
        .from('planned_workouts')
        .select('*')
        .eq('user_id', accountId)
        .is('archived_at', null)
        .gte('planned_date', weekStart)
        .lt('planned_date', weekEnd)
        .order('planned_date', { ascending: true }),
      supabase
        .from('workout_sessions')
        .select('*')
        .eq('user_id', accountId)
        .is('archived_at', null)
        .in('status', ['completed', 'partial'])
        .order('finished_at', { ascending: false })
        .limit(3),
      supabase
        .from('workout_sessions')
        .select('*')
        .eq('user_id', accountId)
        .is('archived_at', null)
        .in('status', ['completed', 'partial'])
        .gte('finished_at', monday.toISOString())
        .lt('finished_at', addDays(monday, 7).toISOString()),
    ]);
  assertNoError(settingsResult.error);
  assertNoError(plansResult.error);
  assertNoError(recentResult.error);
  assertNoError(performedWeekResult.error);

  const plans = (plansResult.data ?? []) as PlannedWorkoutRow[];
  const recentSessions = (recentResult.data ?? []) as WorkoutSessionRow[];
  const planIds = plans.map((plan) => plan.id);
  const recentPlanIds = recentSessions.map(
    (session) => session.planned_workout_id,
  );
  const missingRecentPlanIds = recentPlanIds.filter(
    (id) => !planIds.includes(id),
  );

  const [weekSessionsResult, plannedExercisesResult, recentPlansResult] =
    await Promise.all([
      planIds.length
        ? supabase
            .from('workout_sessions')
            .select('*')
            .eq('user_id', accountId)
            .is('archived_at', null)
            .in('planned_workout_id', planIds)
        : Promise.resolve({ data: [], error: null }),
      planIds.length
        ? supabase
            .from('planned_exercises')
            .select('planned_workout_id')
            .eq('user_id', accountId)
            .in('planned_workout_id', planIds)
        : Promise.resolve({ data: [], error: null }),
      missingRecentPlanIds.length
        ? supabase
            .from('planned_workouts')
            .select('id,name_snapshot,planned_date')
            .eq('user_id', accountId)
            .is('archived_at', null)
            .in('id', missingRecentPlanIds)
        : Promise.resolve({ data: [], error: null }),
    ]);
  assertNoError(weekSessionsResult.error);
  assertNoError(plannedExercisesResult.error);
  assertNoError(recentPlansResult.error);

  const weekSessions = (weekSessionsResult.data ?? []) as WorkoutSessionRow[];
  const performedWeekSessions = (performedWeekResult.data ??
    []) as WorkoutSessionRow[];
  const allSessionIds = [
    ...new Set([
      ...performedWeekSessions.map((session) => session.id),
      ...recentSessions.map((session) => session.id),
    ]),
  ];

  const [intervalsResult, sessionExercisesResult] = await Promise.all([
    allSessionIds.length
      ? supabase
          .from('session_intervals')
          .select('*')
          .eq('user_id', accountId)
          .in('session_id', allSessionIds)
      : Promise.resolve({ data: [], error: null }),
    allSessionIds.length
      ? supabase
          .from('session_exercises')
          .select('*')
          .eq('user_id', accountId)
          .in('session_id', allSessionIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  assertNoError(intervalsResult.error);
  assertNoError(sessionExercisesResult.error);

  const intervals = (intervalsResult.data ?? []) as SessionIntervalRow[];
  const sessionExercises = (sessionExercisesResult.data ??
    []) as SessionExerciseRow[];
  const exerciseIds = sessionExercises.map((exercise) => exercise.id);
  const setsResult = exerciseIds.length
    ? await supabase
        .from('logged_sets')
        .select('*')
        .eq('user_id', accountId)
        .in('session_exercise_id', exerciseIds)
    : { data: [], error: null };
  assertNoError(setsResult.error);
  const sets = (setsResult.data ?? []) as LoggedSetRow[];

  const exerciseCountByPlan: Record<string, number> = {};
  for (const exercise of plannedExercisesResult.data ?? []) {
    const planId = exercise.planned_workout_id as string;
    exerciseCountByPlan[planId] = (exerciseCountByPlan[planId] ?? 0) + 1;
  }

  const sessionIdByExercise = new Map(
    sessionExercises.map((exercise) => [exercise.id, exercise.session_id]),
  );
  const weekSessionIds = new Set(
    performedWeekSessions.map((session) => session.id),
  );
  const weekSets = sets.filter(
    (set) =>
      weekSessionIds.has(
        sessionIdByExercise.get(set.session_exercise_id) ?? '',
      ) &&
      set.actual_reps !== null &&
      set.actual_weight_kg !== null,
  );
  const workingExerciseIds = new Set(
    weekSets
      .filter((set) => set.set_type === 'working')
      .map((set) => set.session_exercise_id),
  );
  const recentPlansById = new Map(
    [...plans, ...(recentPlansResult.data ?? [])].map((plan) => [
      plan.id,
      plan,
    ]),
  );

  return {
    weekStart,
    weeklyGoal: settingsResult.data?.weekly_goal ?? null,
    plans,
    exerciseCountByPlan,
    sessionStatusByPlan: Object.fromEntries(
      weekSessions.map((session) => [
        session.planned_workout_id,
        session.status,
      ]),
    ),
    completedCount: performedWeekSessions.filter(
      (session) => session.status === 'completed',
    ).length,
    activeMinutes: Math.round(
      performedWeekSessions.reduce(
        (sum, session) => sum + activeMillisecondsFor(session.id, intervals),
        0,
      ) / 60_000,
    ),
    totalExercises: workingExerciseIds.size,
    loggedSets: weekSets.length,
    recent: recentSessions.map((session) => ({
      session,
      name:
        recentPlansById.get(session.planned_workout_id)?.name_snapshot ??
        'Workout',
      plannedDate:
        recentPlansById.get(session.planned_workout_id)?.planned_date ??
        session.started_at.slice(0, 10),
      durationMinutes: activeMinutesFor(session.id, intervals),
      setCount: sets.filter(
        (set) =>
          sessionIdByExercise.get(set.session_exercise_id) === session.id &&
          set.actual_reps !== null,
      ).length,
    })),
  };
}

export async function loadHome(
  accountId: string,
  monday: Date,
  offline: boolean,
): Promise<HomeLoadResult> {
  const cacheKey = `home:${dateKey(monday)}`;
  if (offline) {
    try {
      const cached = await getCachedRead<HomeSnapshot>(accountId, cacheKey);
      return { snapshot: cached, isCached: true, error: null };
    } catch (error) {
      return {
        snapshot: null,
        isCached: false,
        error:
          error instanceof Error ? error.message : 'Saved data is unavailable.',
      };
    }
  }

  try {
    const snapshot = await fetchHome(accountId, monday);
    try {
      await saveCachedRead(accountId, cacheKey, snapshot);
    } catch {
      return {
        snapshot,
        isCached: false,
        error: 'Offline copy could not be saved.',
      };
    }
    return { snapshot, isCached: false, error: null };
  } catch (error) {
    const cached = await getCachedRead<HomeSnapshot>(accountId, cacheKey).catch(
      () => null,
    );
    return {
      snapshot: cached,
      isCached: cached !== null,
      error: error instanceof Error ? error.message : 'Could not load Home.',
    };
  }
}
