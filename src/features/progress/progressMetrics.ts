import type {
  LoggedSetRow,
  SessionExerciseRow,
  SessionIntervalRow,
  SessionSnapshot,
  WorkoutSessionRow,
} from '../../types/database';

export interface ProgressRows {
  sessions: WorkoutSessionRow[];
  intervals: SessionIntervalRow[];
  exercises: SessionExerciseRow[];
  sets: LoggedSetRow[];
}

export interface ExerciseBestRow {
  exerciseId: string;
  name: string;
  weightKg: number;
  reps: number;
  performedAt: string;
}

export interface ProgressSummary {
  completedCount: number;
  partialCount: number;
  activeMinutes: number;
  loggedSets: number;
  volumeKg: number;
  bests: ExerciseBestRow[];
  recent: {
    session: WorkoutSessionRow;
    name: string;
    plannedDate: string;
    setCount: number;
    activeMinutes: number;
  }[];
}

export function summarizeProgress(
  rows: ProgressRows,
  local: {
    snapshot: SessionSnapshot;
    syncState: 'clean' | 'pending' | 'conflict';
  }[],
  start: Date | null,
  end: Date | null,
  planNames: Record<string, { name: string; date: string }>,
): ProgressSummary {
  const sessions = new Map(
    rows.sessions.map((session) => [session.id, session]),
  );
  const intervals = new Map<string, SessionIntervalRow[]>();
  const exercises = new Map<string, SessionExerciseRow[]>();
  const sets = new Map<string, LoggedSetRow[]>();
  for (const row of rows.intervals)
    intervals.set(row.session_id, [
      ...(intervals.get(row.session_id) ?? []),
      row,
    ]);
  for (const row of rows.exercises)
    exercises.set(row.session_id, [
      ...(exercises.get(row.session_id) ?? []),
      row,
    ]);
  const sessionByExercise = new Map(
    rows.exercises.map((row) => [row.id, row.session_id]),
  );
  for (const row of rows.sets) {
    const sessionId = sessionByExercise.get(row.session_exercise_id);
    if (sessionId) sets.set(sessionId, [...(sets.get(sessionId) ?? []), row]);
  }
  for (const item of local) {
    if (item.syncState === 'conflict') continue;
    const snapshot = item.snapshot;
    const current = sessions.get(snapshot.session.id);
    if (
      item.syncState !== 'pending' &&
      current &&
      current.revision >= snapshot.session.revision
    )
      continue;
    sessions.set(snapshot.session.id, snapshot.session);
    intervals.set(snapshot.session.id, snapshot.intervals);
    exercises.set(snapshot.session.id, snapshot.exercises);
    sets.set(snapshot.session.id, snapshot.sets);
  }
  const performed = [...sessions.values()]
    .filter((session) => {
      if (session.status !== 'completed' && session.status !== 'partial')
        return false;
      const finished = Date.parse(session.finished_at ?? session.started_at);
      return (
        (start === null || finished >= start.getTime()) &&
        (end === null || finished < end.getTime())
      );
    })
    .sort(
      (a, b) =>
        Date.parse(b.finished_at ?? b.started_at) -
        Date.parse(a.finished_at ?? a.started_at),
    );
  let activeMs = 0;
  let loggedSets = 0;
  let volumeKg = 0;
  const bestByExercise = new Map<string, ExerciseBestRow>();
  const recent: ProgressSummary['recent'] = [];
  for (const session of performed) {
    const sessionIntervals = intervals.get(session.id) ?? [];
    const durationMs = sessionIntervals.reduce((sum, interval) => {
      if (!interval.ended_at) return sum;
      return (
        sum +
        Math.max(
          0,
          Date.parse(interval.ended_at) - Date.parse(interval.started_at),
        )
      );
    }, 0);
    activeMs += durationMs;
    const sessionExercises = exercises.get(session.id) ?? [];
    const byId = new Map(
      sessionExercises.map((exercise) => [exercise.id, exercise]),
    );
    let sessionSetCount = 0;
    for (const set of sets.get(session.id) ?? []) {
      if (set.actual_reps === null || set.actual_weight_kg === null) continue;
      sessionSetCount++;
      loggedSets++;
      volumeKg += set.actual_reps * Number(set.actual_weight_kg);
      const exercise = byId.get(set.session_exercise_id);
      if (!exercise || set.set_type !== 'working') continue;
      const weight = Number(set.actual_weight_kg);
      const previous = bestByExercise.get(exercise.exercise_id);
      if (
        !previous ||
        weight > previous.weightKg ||
        (weight === previous.weightKg && set.actual_reps > previous.reps)
      ) {
        bestByExercise.set(exercise.exercise_id, {
          exerciseId: exercise.exercise_id,
          name: exercise.name_snapshot,
          weightKg: weight,
          reps: set.actual_reps,
          performedAt: session.finished_at ?? session.started_at,
        });
      }
    }
    if (recent.length < 10)
      recent.push({
        session,
        name: planNames[session.planned_workout_id]?.name ?? 'Workout',
        plannedDate:
          planNames[session.planned_workout_id]?.date ??
          session.started_at.slice(0, 10),
        setCount: sessionSetCount,
        activeMinutes: Math.round(durationMs / 60000),
      });
  }
  return {
    completedCount: performed.filter(
      (session) => session.status === 'completed',
    ).length,
    partialCount: performed.filter((session) => session.status === 'partial')
      .length,
    activeMinutes: Math.round(activeMs / 60000),
    loggedSets,
    volumeKg,
    bests: [...bestByExercise.values()].sort((a, b) =>
      a.name.localeCompare(b.name),
    ),
    recent,
  };
}
