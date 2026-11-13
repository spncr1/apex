import {
  buildExerciseHistory,
  type ExercisePerformance,
} from '../features/exercises/exerciseHistory';
import {
  getCachedRead,
  getCachedSessionsForExercise,
  saveCachedRead,
} from '../features/sessions/sessionStore';
import type {
  ExerciseRow,
  LoggedSetRow,
  MuscleGroupRow,
  PlannedWorkoutRow,
  SessionExerciseRow,
  SessionRevisionRow,
  WorkoutSessionRow,
} from '../types/database';
import { pruneArchivedCachedSessions } from './sessionRepository';
import { supabase } from './supabase';

type HistoryRows = {
  sessions: WorkoutSessionRow[];
  sessionExercises: SessionExerciseRow[];
  sets: LoggedSetRow[];
  plans: PlannedWorkoutRow[];
  revisions: SessionRevisionRow[];
};

type ExerciseDetailCache = {
  exercise: ExerciseRow;
  group: MuscleGroupRow;
  notes: string;
  rows: HistoryRows;
};

export type ExerciseDetailLoad = {
  exercise: ExerciseRow;
  group: MuscleGroupRow;
  notes: string;
  history: ExercisePerformance[];
  cached: boolean;
  error: string | null;
};

const key = (id: string) => `exercise-detail:${id}`;

export async function loadExerciseDetail(
  accountId: string,
  exerciseId: string,
  offline: boolean,
): Promise<ExerciseDetailLoad> {
  if (!offline && supabase) {
    await pruneArchivedCachedSessions(accountId).catch(() => {
      // The normal online fetch below can still provide this detail.
    });
  }
  let cached = await getCachedRead<ExerciseDetailCache>(
    accountId,
    key(exerciseId),
  );
  const local = await getCachedSessionsForExercise(accountId, exerciseId);
  if (!cached) {
    const catalog = await getCachedRead<{
      groups: MuscleGroupRow[];
      exercises: ExerciseRow[];
    }>(accountId, 'catalog');
    const exercise = catalog?.exercises.find((item) => item.id === exerciseId);
    const group = catalog?.groups.find(
      (item) => item.id === exercise?.muscle_group_id,
    );
    if (exercise && group)
      cached = {
        exercise,
        group,
        notes: '',
        rows: {
          sessions: [],
          sessionExercises: [],
          sets: [],
          plans: [],
          revisions: [],
        },
      };
  }

  let data = cached;
  let error: string | null = null;
  let fromCache = true;
  if (!offline && supabase) {
    try {
      const [exerciseResult, notesResult, exerciseSessionsResult] =
        await Promise.all([
          supabase
            .from('exercises')
            .select('*')
            .eq('id', exerciseId)
            .maybeSingle(),
          supabase
            .from('exercise_notes')
            .select('notes')
            .eq('user_id', accountId)
            .eq('exercise_id', exerciseId)
            .maybeSingle(),
          supabase
            .from('session_exercises')
            .select('*')
            .eq('user_id', accountId)
            .eq('exercise_id', exerciseId),
        ]);
      const firstError =
        exerciseResult.error ??
        notesResult.error ??
        exerciseSessionsResult.error;
      if (firstError) throw firstError;
      if (!exerciseResult.data) throw new Error('Exercise not found.');
      const exercise = exerciseResult.data as ExerciseRow;
      const groupResult = await supabase
        .from('muscle_groups')
        .select('*')
        .eq('id', exercise.muscle_group_id)
        .maybeSingle();
      if (groupResult.error) throw groupResult.error;
      if (!groupResult.data) throw new Error('Muscle group not found.');
      const sessionExercises = (exerciseSessionsResult.data ??
        []) as SessionExerciseRow[];
      const sessionIds = [
        ...new Set(sessionExercises.map((item) => item.session_id)),
      ];
      let rows: HistoryRows = {
        sessions: [],
        sessionExercises,
        sets: [],
        plans: [],
        revisions: [],
      };
      if (sessionIds.length) {
        const [sessionsResult, setsResult, revisionsResult] = await Promise.all(
          [
            supabase
              .from('workout_sessions')
              .select('*')
              .eq('user_id', accountId)
              .is('archived_at', null)
              .in('id', sessionIds),
            supabase
              .from('logged_sets')
              .select('*')
              .eq('user_id', accountId)
              .in(
                'session_exercise_id',
                sessionExercises.map((item) => item.id),
              ),
            supabase
              .from('session_revisions')
              .select('*')
              .eq('user_id', accountId)
              .in('session_id', sessionIds)
              .order('revision', { ascending: false }),
          ],
        );
        const queryError =
          sessionsResult.error ?? setsResult.error ?? revisionsResult.error;
        if (queryError) throw queryError;
        const sessions = (sessionsResult.data ?? []) as WorkoutSessionRow[];
        const planIds = [
          ...new Set(sessions.map((item) => item.planned_workout_id)),
        ];
        const plansResult = planIds.length
          ? await supabase
              .from('planned_workouts')
              .select('*')
              .eq('user_id', accountId)
              .in('id', planIds)
          : { data: [], error: null };
        if (plansResult.error) throw plansResult.error;
        rows = {
          sessions,
          sessionExercises,
          sets: (setsResult.data ?? []) as LoggedSetRow[],
          plans: (plansResult.data ?? []) as PlannedWorkoutRow[],
          revisions: (revisionsResult.data ?? []) as SessionRevisionRow[],
        };
      }
      data = {
        exercise,
        group: groupResult.data as MuscleGroupRow,
        notes: notesResult.data?.notes ?? '',
        rows,
      };
      await saveCachedRead(accountId, key(exerciseId), data);
      fromCache = false;
    } catch (issue) {
      error =
        issue instanceof Error
          ? issue.message
          : 'Could not refresh exercise history.';
    }
  }
  if (!data)
    throw new Error(
      error ?? 'Open the exercise library online to load this exercise.',
    );
  return {
    exercise: data.exercise,
    group: data.group,
    notes: data.notes,
    history: buildExerciseHistory({ exerciseId, ...data.rows, local }),
    cached: fromCache,
    error,
  };
}

export async function saveExerciseNotes(
  accountId: string,
  detail: ExerciseDetailLoad,
  notes: string,
): Promise<void> {
  if (!supabase) throw new Error('Connect to save exercise notes.');
  const result = await supabase.from('exercise_notes').upsert(
    {
      user_id: accountId,
      exercise_id: detail.exercise.id,
      notes,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id,exercise_id' },
  );
  if (result.error) throw result.error;
  const cached = await getCachedRead<ExerciseDetailCache>(
    accountId,
    key(detail.exercise.id),
  );
  if (cached)
    await saveCachedRead(accountId, key(detail.exercise.id), {
      ...cached,
      notes,
    });
}
