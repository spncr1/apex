import type {
  LoggedSetRow,
  PlannedWorkoutRow,
  SessionExerciseRow,
  SessionRevisionRow,
  SessionSnapshot,
  WorkoutSessionRow,
} from '../../types/database';

export interface ExercisePerformance {
  session: WorkoutSessionRow;
  workoutName: string;
  plannedDate: string;
  sets: LoggedSetRow[];
  previousVersions: SessionRevisionRow[];
  syncState: 'clean' | 'pending' | 'conflict';
}

export interface ExerciseBest {
  weightKg: number;
  reps: number;
  date: string;
}

export function loggedSetsFor(
  snapshot: SessionSnapshot,
  exerciseId: string,
): LoggedSetRow[] {
  const exercise = snapshot.exercises.find(
    (item) => item.exercise_id === exerciseId,
  );
  if (!exercise) return [];
  return snapshot.sets
    .filter(
      (set) =>
        set.session_exercise_id === exercise.id &&
        set.actual_reps !== null &&
        set.actual_weight_kg !== null,
    )
    .sort((a, b) => a.set_number - b.set_number);
}

export function buildExerciseHistory(input: {
  exerciseId: string;
  sessions: WorkoutSessionRow[];
  sessionExercises: SessionExerciseRow[];
  sets: LoggedSetRow[];
  plans: PlannedWorkoutRow[];
  revisions: SessionRevisionRow[];
  local: {
    snapshot: SessionSnapshot;
    syncState: 'clean' | 'pending' | 'conflict';
  }[];
}): ExercisePerformance[] {
  const planById = new Map(input.plans.map((plan) => [plan.id, plan]));
  const exerciseBySession = new Map(
    input.sessionExercises.map((item) => [item.session_id, item]),
  );
  const localByPlan = new Map(
    input.local
      .filter((item) => item.syncState === 'pending')
      .map((item) => [item.snapshot.session.planned_workout_id, item]),
  );
  const result = input.sessions.flatMap((session): ExercisePerformance[] => {
    const local = localByPlan.get(session.planned_workout_id);
    const active = local?.snapshot.session ?? session;
    if (active.status === 'in_progress') return [];
    const exercise =
      local?.snapshot.exercises.find(
        (item) => item.exercise_id === input.exerciseId,
      ) ?? exerciseBySession.get(session.id);
    if (!exercise) return [];
    const sets = local
      ? loggedSetsFor(local.snapshot, input.exerciseId)
      : input.sets
          .filter(
            (set) =>
              set.session_exercise_id === exercise.id &&
              set.actual_reps !== null &&
              set.actual_weight_kg !== null,
          )
          .sort((a, b) => a.set_number - b.set_number);
    if (!sets.length) return [];
    const plan = planById.get(session.planned_workout_id);
    return [
      {
        session: active,
        workoutName: plan?.name_snapshot ?? 'Workout',
        plannedDate: plan?.planned_date ?? active.started_at.slice(0, 10),
        sets,
        previousVersions: input.revisions
          .filter(
            (revision) =>
              revision.session_id === session.id &&
              revision.snapshot.exercises.some(
                (item) => item.exercise_id === input.exerciseId,
              ) &&
              revision.revision <
                (local?.syncState === 'pending'
                  ? session.revision + 1
                  : active.revision),
          )
          .sort((a, b) => b.revision - a.revision),
        syncState: local?.syncState ?? 'clean',
      },
    ];
  });
  const knownPlans = new Set(
    input.sessions.map((item) => item.planned_workout_id),
  );
  for (const item of input.local) {
    const session = item.snapshot.session;
    if (
      item.syncState === 'conflict' ||
      session.status === 'in_progress' ||
      knownPlans.has(session.planned_workout_id)
    )
      continue;
    const sets = loggedSetsFor(item.snapshot, input.exerciseId);
    if (!sets.length) continue;
    const plan = planById.get(session.planned_workout_id);
    result.push({
      session,
      workoutName: plan?.name_snapshot ?? 'Workout',
      plannedDate: plan?.planned_date ?? session.started_at.slice(0, 10),
      sets,
      previousVersions: [],
      syncState: item.syncState,
    });
  }
  return result.sort(
    (a, b) =>
      Date.parse(b.session.finished_at ?? b.session.started_at) -
      Date.parse(a.session.finished_at ?? a.session.started_at),
  );
}

export function bestForHistory(
  history: ExercisePerformance[],
): ExerciseBest | null {
  let best: ExerciseBest | null = null;
  for (const item of history)
    for (const set of item.sets) {
      if (
        set.set_type !== 'working' ||
        set.actual_weight_kg === null ||
        set.actual_reps === null
      )
        continue;
      const weight = Number(set.actual_weight_kg);
      if (
        !best ||
        weight > best.weightKg ||
        (weight === best.weightKg && set.actual_reps > best.reps)
      ) {
        best = {
          weightKg: weight,
          reps: set.actual_reps,
          date: item.session.finished_at ?? item.session.started_at,
        };
      }
    }
  return best;
}
