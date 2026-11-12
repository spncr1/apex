import {
  addDays,
  dateKey,
  formatWeekRange,
  startOfWeek,
} from '../features/home/dates';
import {
  summarizeProgress,
  type ProgressRows,
  type ProgressSummary,
} from '../features/progress/progressMetrics';
import {
  getCachedRead,
  getCachedSessionsForAccount,
  saveCachedRead,
} from '../features/sessions/sessionStore';
import type {
  LoggedSetRow,
  PlannedWorkoutRow,
  SessionExerciseRow,
  SessionIntervalRow,
  WorkoutSessionRow,
} from '../types/database';
import { supabase } from './supabase';

export type ProgressPeriod = 'week' | 'month' | 'all';

export interface ProgressRange {
  period: ProgressPeriod;
  offset: number;
  start: Date | null;
  end: Date | null;
  label: string;
  cacheKey: string;
}

type ProgressCache = {
  rows: ProgressRows;
  planNames: Record<string, { name: string; date: string }>;
};

export interface ProgressLoad {
  summary: ProgressSummary;
  isCached: boolean;
  error: string | null;
}

const emptyRows = (): ProgressRows => ({
  sessions: [],
  intervals: [],
  exercises: [],
  sets: [],
});
const chunks = <T>(items: T[], size: number): T[][] =>
  Array.from({ length: Math.ceil(items.length / size) }, (_, index) =>
    items.slice(index * size, (index + 1) * size),
  );

export function progressRange(
  period: ProgressPeriod,
  offset: number,
  today = new Date(),
): ProgressRange {
  if (period === 'all')
    return {
      period,
      offset: 0,
      start: null,
      end: null,
      label: 'All time',
      cacheKey: 'progress:all',
    };
  if (period === 'week') {
    const start = startOfWeek(addDays(today, offset * 7));
    return {
      period,
      offset,
      start,
      end: addDays(start, 7),
      label: formatWeekRange(start),
      cacheKey: `progress:week:${dateKey(start)}`,
    };
  }
  const start = new Date(today.getFullYear(), today.getMonth() + offset, 1);
  const end = new Date(start.getFullYear(), start.getMonth() + 1, 1);
  return {
    period,
    offset,
    start,
    end,
    label: new Intl.DateTimeFormat('en-AU', {
      month: 'long',
      year: 'numeric',
    }).format(start),
    cacheKey: `progress:month:${dateKey(start)}`,
  };
}

async function fetchProgress(
  accountId: string,
  range: ProgressRange,
): Promise<ProgressCache> {
  if (!supabase) throw new Error('Supabase is not configured.');
  const sessions: WorkoutSessionRow[] = [];
  const pageSize = 500;
  for (let page = 0; ; page++) {
    let query = supabase
      .from('workout_sessions')
      .select('*')
      .eq('user_id', accountId)
      .in('status', ['completed', 'partial'])
      .order('finished_at', { ascending: false })
      .range(page * pageSize, (page + 1) * pageSize - 1);
    if (range.start)
      query = query.gte('finished_at', range.start.toISOString());
    if (range.end) query = query.lt('finished_at', range.end.toISOString());
    const result = await query;
    if (result.error) throw result.error;
    const batch = (result.data ?? []) as WorkoutSessionRow[];
    sessions.push(...batch);
    if (batch.length < pageSize) break;
  }
  const rows = emptyRows();
  rows.sessions = sessions;
  const sessionChunks = chunks(
    sessions.map((session) => session.id),
    100,
  );
  for (const ids of sessionChunks) {
    const [intervals, exercises] = await Promise.all([
      supabase
        .from('session_intervals')
        .select('*')
        .eq('user_id', accountId)
        .in('session_id', ids),
      supabase
        .from('session_exercises')
        .select('*')
        .eq('user_id', accountId)
        .in('session_id', ids),
    ]);
    if (intervals.error || exercises.error)
      throw intervals.error ?? exercises.error;
    rows.intervals.push(...((intervals.data ?? []) as SessionIntervalRow[]));
    rows.exercises.push(...((exercises.data ?? []) as SessionExerciseRow[]));
  }
  for (const ids of chunks(
    rows.exercises.map((exercise) => exercise.id),
    100,
  )) {
    const result = await supabase
      .from('logged_sets')
      .select('*')
      .eq('user_id', accountId)
      .in('session_exercise_id', ids);
    if (result.error) throw result.error;
    rows.sets.push(...((result.data ?? []) as LoggedSetRow[]));
  }
  const planNames: Record<string, { name: string; date: string }> = {};
  for (const ids of chunks(
    [...new Set(sessions.map((session) => session.planned_workout_id))],
    100,
  )) {
    const result = await supabase
      .from('planned_workouts')
      .select('id,name_snapshot,planned_date')
      .eq('user_id', accountId)
      .in('id', ids);
    if (result.error) throw result.error;
    for (const plan of (result.data ?? []) as Pick<
      PlannedWorkoutRow,
      'id' | 'name_snapshot' | 'planned_date'
    >[])
      planNames[plan.id] = {
        name: plan.name_snapshot,
        date: plan.planned_date,
      };
  }
  return { rows, planNames };
}

export async function loadProgress(
  accountId: string,
  range: ProgressRange,
  offline: boolean,
): Promise<ProgressLoad> {
  let cached = await getCachedRead<ProgressCache>(
    accountId,
    range.cacheKey,
  ).catch(() => null);
  let isCached = true;
  let error: string | null = null;
  if (!offline) {
    try {
      const fresh = await fetchProgress(accountId, range);
      cached = fresh;
      isCached = false;
      await saveCachedRead(accountId, range.cacheKey, fresh).catch(() => {
        error = 'Offline copy could not be saved.';
      });
    } catch (issue) {
      error =
        issue instanceof Error ? issue.message : 'Could not load progress.';
    }
  }
  const local = await getCachedSessionsForAccount(accountId);
  return {
    summary: summarizeProgress(
      cached?.rows ?? emptyRows(),
      local,
      range.start,
      range.end,
      cached?.planNames ?? {},
    ),
    isCached,
    error,
  };
}
