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
  totalExercises: number;
  loggedSets: number;
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
  const finishedSessions = [...sessions.values()]
    .filter(
      (session) =>
        !session.archived_at &&
        (session.status === 'completed' || session.status === 'partial'),
    )
    .sort(
      (a, b) =>
        Date.parse(a.finished_at ?? a.started_at) -
          Date.parse(b.finished_at ?? b.started_at) || a.id.localeCompare(b.id),
    );
  const inRange = (session: WorkoutSessionRow) => {
    const finished = Date.parse(session.finished_at ?? session.started_at);
    return (
      (start === null || finished >= start.getTime()) &&
      (end === null || finished < end.getTime())
    );
  };
  const performed = finishedSessions.filter(inRange).reverse();
  let activeMs = 0;
  let totalExercises = 0;
  let loggedSets = 0;
  const bestWeightByExercise = new Map<string, number>();
  const recordsInRange = new Map<string, ExerciseBestRow>();
  const recent: ProgressSummary['recent'] = [];
  for (const session of finishedSessions) {
    const byId = new Map(
      (exercises.get(session.id) ?? []).map((exercise) => [
        exercise.id,
        exercise,
      ]),
    );
    const sessionBests = new Map<string, ExerciseBestRow>();
    for (const set of sets.get(session.id) ?? []) {
      if (
        set.set_type !== 'working' ||
        set.actual_reps === null ||
        set.actual_weight_kg === null
      )
        continue;
      const exercise = byId.get(set.session_exercise_id);
      if (!exercise) continue;
      const weight = Number(set.actual_weight_kg);
      const previous = sessionBests.get(exercise.exercise_id);
      if (
        !previous ||
        weight > previous.weightKg ||
        (weight === previous.weightKg && set.actual_reps > previous.reps)
      )
        sessionBests.set(exercise.exercise_id, {
          exerciseId: exercise.exercise_id,
          name: exercise.name_snapshot,
          weightKg: weight,
          reps: set.actual_reps,
          performedAt: session.finished_at ?? session.started_at,
        });
    }
    for (const best of sessionBests.values()) {
      const previousWeight = bestWeightByExercise.get(best.exerciseId);
      if (previousWeight !== undefined && best.weightKg <= previousWeight)
        continue;
      bestWeightByExercise.set(best.exerciseId, best.weightKg);
      if (inRange(session)) recordsInRange.set(best.exerciseId, best);
    }
  }
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
    const byId = new Set(sessionExercises.map((exercise) => exercise.id));
    const completedExerciseIds = new Set<string>();
    let sessionSetCount = 0;
    for (const set of sets.get(session.id) ?? []) {
      if (set.actual_reps === null || set.actual_weight_kg === null) continue;
      sessionSetCount++;
      loggedSets++;
      if (byId.has(set.session_exercise_id) && set.set_type === 'working')
        completedExerciseIds.add(set.session_exercise_id);
    }
    totalExercises += completedExerciseIds.size;
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
    totalExercises,
    loggedSets,
    bests: [...recordsInRange.values()].sort(
      (a, b) =>
        Date.parse(b.performedAt) - Date.parse(a.performedAt) ||
        a.name.localeCompare(b.name),
    ),
    recent,
  };
}
