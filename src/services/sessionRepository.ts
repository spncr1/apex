import { startOfWeek } from '../features/home/dates';
import { loadConflictReviews, resolveConflict } from './conflictRepository';
import { loadPlanning, type PlanDetail } from './planningRepository';
import {
  cacheRemoteSession,
  findCachedSessionByPlan,
  forgetArchivedSession,
  getCachedSessionsForAccount,
  getCachedSession,
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

export async function pruneArchivedCachedSessions(
  accountId: string,
): Promise<boolean> {
  if (!supabase) return false;
  const local = (await getCachedSessionsForAccount(accountId)).filter(
    (item) => item.syncState === 'clean',
  );
  let removed = false;
  for (let offset = 0; offset < local.length; offset += 100) {
    const ids = local
      .slice(offset, offset + 100)
      .map((item) => item.snapshot.session.id);
    const result = await supabase
      .from('workout_sessions')
      .select('id')
      .eq('user_id', accountId)
      .in('id', ids)
      .not('archived_at', 'is', null);
    if (result.error) throw result.error;
    for (const row of result.data ?? []) {
      await forgetArchivedSession(accountId, row.id);
      removed = true;
    }
  }
  return removed;
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
  if (!offline && planning.snapshot && !plan) {
    return {
      plan: null,
      snapshot: null,
      syncState: null,
      error: 'Workout not found.',
    };
  }
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
    .is('archived_at', null)
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

async function keepCurrentSessionEdit(
  accountId: string,
  snapshot: SessionSnapshot,
) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const reviews = await loadConflictReviews(accountId, false);
    const review = reviews.find(
      (item) =>
        item.status === 'pending' &&
        item.localSessionId === snapshot.session.id,
    );
    if (!review) throw new Error('Could not find the saved session copies.');
    const result = await resolveConflict(
      accountId,
      { ...review, localSnapshot: snapshot },
      'local',
    );
    if (result === 'resolved') return;
  }
  throw new Error(
    'The workout changed again. Your edits remain on this device.',
  );
}

export async function persistWorkoutSession(
  accountId: string,
  snapshot: SessionSnapshot,
  online: boolean,
  keepCurrentEdit = false,
): Promise<'clean' | 'pending'> {
  if (keepCurrentEdit) {
    const cached = await getCachedSession(accountId, snapshot.session.id);
    if (cached?.syncState === 'conflict') {
      if (!online)
        throw new Error(
          'Reconnect to save this workout. Your edits are still here.',
        );
      await keepCurrentSessionEdit(accountId, snapshot);
      return 'clean';
    }
  }

  try {
    await saveSessionEdit(accountId, snapshot);
  } catch (error) {
    // An upload can mark a conflict after the cache check above.
    if (
      keepCurrentEdit &&
      online &&
      error instanceof Error &&
      error.message === 'Resolve this session conflict before editing it.'
    ) {
      await keepCurrentSessionEdit(accountId, snapshot);
      return 'clean';
    }
    throw error;
  }
  if (!online) return 'pending';
  if (!keepCurrentEdit) {
    void syncPendingSessions(accountId);
    return 'pending';
  }

  // Save waits for any upload already running, then checks this workout's result.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const result = await syncPendingSessions(accountId);
    if (result.error) return 'pending';
    const cached = await getCachedSession(accountId, snapshot.session.id);
    if (cached?.syncState === 'conflict') {
      await keepCurrentSessionEdit(accountId, cached.snapshot);
      return 'clean';
    }
    if (cached?.syncState === 'clean') return 'clean';
  }
  return 'pending';
}
