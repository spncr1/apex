import { startOfWeek } from '../features/home/dates';
import { loadPlanning, type PlanDetail } from './planningRepository';
import {
  cacheRemoteSession,
  findCachedSessionByPlan,
  saveSessionEdit,
} from '../features/sessions/sessionStore';
import { syncPendingSessions } from '../features/sessions/sessionSync';
import type {
  LoggedSetRow,
  SessionExerciseRow,
  SessionIntervalRow,
  SessionSnapshot,
  WorkoutSessionRow,
} from '../types/database';
import { supabase } from './supabase';

export interface SessionLoad {
  plan: PlanDetail | null;
  snapshot: SessionSnapshot | null;
  syncState: 'clean' | 'pending' | 'conflict' | null;
  error: string | null;
}

export async function loadWorkoutSession(
  accountId: string,
  planId: string,
  plannedDate: string,
  offline: boolean,
): Promise<SessionLoad> {
  const week = startOfWeek(new Date(`${plannedDate}T12:00:00`));
  const planning = await loadPlanning(accountId, week, offline);
  const plan =
    planning.snapshot?.plans.find((item) => item.plan.id === planId) ?? null;
  const cached = await findCachedSessionByPlan(accountId, planId);
  if (cached && (offline || cached.syncState !== 'clean' || !supabase))
    return {
      plan,
      snapshot: cached.snapshot,
      syncState: cached.syncState,
      error: planning.error,
    };
  if (offline || !supabase)
    return {
      plan,
      snapshot: cached?.snapshot ?? null,
      syncState: cached?.syncState ?? null,
      error: planning.error,
    };

  const result = await supabase
    .from('workout_sessions')
    .select('*')
    .eq('user_id', accountId)
    .eq('planned_workout_id', planId)
    .maybeSingle();
  if (result.error)
    return {
      plan,
      snapshot: cached?.snapshot ?? null,
      syncState: cached?.syncState ?? null,
      error: result.error.message,
    };
  if (!result.data)
    return {
      plan,
      snapshot: cached?.snapshot ?? null,
      syncState: cached?.syncState ?? null,
      error: planning.error,
    };
  const session = result.data as WorkoutSessionRow;
  const [intervals, exercises] = await Promise.all([
    supabase
      .from('session_intervals')
      .select('*')
      .eq('user_id', accountId)
      .eq('session_id', session.id),
    supabase
      .from('session_exercises')
      .select('*')
      .eq('user_id', accountId)
      .eq('session_id', session.id),
  ]);
  if (intervals.error || exercises.error)
    return {
      plan,
      snapshot: cached?.snapshot ?? null,
      syncState: cached?.syncState ?? null,
      error: intervals.error?.message ?? exercises.error?.message ?? null,
    };
  const exerciseRows = (exercises.data ?? []) as SessionExerciseRow[];
  const sets = exerciseRows.length
    ? await supabase
        .from('logged_sets')
        .select('*')
        .eq('user_id', accountId)
        .in(
          'session_exercise_id',
          exerciseRows.map((item) => item.id),
        )
    : { data: [], error: null };
  if (sets.error)
    return {
      plan,
      snapshot: cached?.snapshot ?? null,
      syncState: cached?.syncState ?? null,
      error: sets.error.message,
    };
  const snapshot: SessionSnapshot = {
    session,
    intervals: (intervals.data ?? []) as SessionIntervalRow[],
    exercises: exerciseRows,
    sets: (sets.data ?? []) as LoggedSetRow[],
  };
  await cacheRemoteSession(accountId, snapshot);
  return { plan, snapshot, syncState: 'clean', error: planning.error };
}

export async function persistWorkoutSession(
  accountId: string,
  snapshot: SessionSnapshot,
  online: boolean,
) {
  await saveSessionEdit(accountId, snapshot);
  if (online) void syncPendingSessions(accountId);
}
