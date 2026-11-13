import * as Crypto from 'expo-crypto';

import type { PlanDetail } from '../../services/planningRepository';
import type { LoggedSetRow, SessionSnapshot } from '../../types/database';

export function startSnapshot(
  accountId: string,
  detail: PlanDetail,
  now: string,
): SessionSnapshot {
  if (detail.plan.user_id !== accountId || detail.plan.status !== 'planned') {
    throw new Error('Only a scheduled workout can be started.');
  }
  const sessionId = Crypto.randomUUID();
  const exercises = detail.exercises.map((exercise) => ({
    id: Crypto.randomUUID(),
    user_id: accountId,
    session_id: sessionId,
    exercise_id: exercise.exercise_id,
    name_snapshot: exercise.name,
  }));
  const sets = exercises.flatMap((exercise, index) =>
    detail.exercises[index].sets.map((target, setIndex): LoggedSetRow => ({
      id: Crypto.randomUUID(),
      user_id: accountId,
      session_exercise_id: exercise.id,
      set_number: setIndex + 1,
      set_type: 'working',
      target_reps: target.target_reps,
      target_weight_kg: target.target_weight_kg,
      actual_reps: null,
      actual_weight_kg: null,
      notes: null,
    })),
  );
  return {
    session: {
      id: sessionId,
      user_id: accountId,
      planned_workout_id: detail.plan.id,
      status: 'in_progress',
      started_at: now,
      finished_at: null,
      comments: null,
      revision: 0,
      updated_at: now,
      archived_at: null,
    },
    intervals: [
      {
        id: Crypto.randomUUID(),
        user_id: accountId,
        session_id: sessionId,
        started_at: now,
        ended_at: null,
      },
    ],
    exercises,
    sets,
  };
}

export function isRunning(snapshot: SessionSnapshot): boolean {
  return (
    snapshot.session.status === 'in_progress' &&
    snapshot.intervals.some((interval) => interval.ended_at === null)
  );
}

export function activeMilliseconds(
  snapshot: SessionSnapshot,
  now: string,
): number {
  return snapshot.intervals.reduce((total, interval) => {
    const start = Date.parse(interval.started_at);
    const end = Date.parse(interval.ended_at ?? now);
    return (
      total +
      (Number.isFinite(start) && Number.isFinite(end)
        ? Math.max(0, end - start)
        : 0)
    );
  }, 0);
}

export function pauseSnapshot(
  snapshot: SessionSnapshot,
  now: string,
): SessionSnapshot {
  if (!isRunning(snapshot)) throw new Error('This session is not running.');
  return {
    ...snapshot,
    intervals: snapshot.intervals.map((interval) =>
      interval.ended_at === null ? { ...interval, ended_at: now } : interval,
    ),
    session: { ...snapshot.session, updated_at: now },
  };
}

export function resumeSnapshot(
  snapshot: SessionSnapshot,
  now: string,
): SessionSnapshot {
  if (snapshot.session.status !== 'in_progress' || isRunning(snapshot))
    throw new Error('This session cannot be resumed.');
  return {
    ...snapshot,
    intervals: [
      ...snapshot.intervals,
      {
        id: Crypto.randomUUID(),
        user_id: snapshot.session.user_id,
        session_id: snapshot.session.id,
        started_at: now,
        ended_at: null,
      },
    ],
    session: { ...snapshot.session, updated_at: now },
  };
}

export function updateSet(
  snapshot: SessionSnapshot,
  setId: string,
  changes: Partial<
    Pick<LoggedSetRow, 'actual_reps' | 'actual_weight_kg' | 'notes'>
  >,
  now: string,
): SessionSnapshot {
  const current = snapshot.sets.find((set) => set.id === setId);
  if (!current) throw new Error('Set not found.');
  const updated = { ...current, ...changes };
  if ((updated.actual_reps === null) !== (updated.actual_weight_kg === null))
    throw new Error('Enter both reps and weight.');
  if (
    updated.actual_reps !== null &&
    (!Number.isInteger(updated.actual_reps) || updated.actual_reps < 0)
  )
    throw new Error('Reps must be a whole number at least zero.');
  if (
    updated.actual_weight_kg !== null &&
    (!Number.isFinite(updated.actual_weight_kg) || updated.actual_weight_kg < 0)
  )
    throw new Error('Weight must be at least zero.');
  return {
    ...snapshot,
    sets: snapshot.sets.map((set) => (set.id === setId ? updated : set)),
    session: { ...snapshot.session, updated_at: now },
  };
}

export function addSet(
  snapshot: SessionSnapshot,
  exerciseId: string,
  now: string,
): SessionSnapshot {
  const exercise = snapshot.exercises.find((item) => item.id === exerciseId);
  if (!exercise) throw new Error('Exercise not found.');
  const setNumber =
    Math.max(
      0,
      ...snapshot.sets
        .filter((set) => set.session_exercise_id === exerciseId)
        .map((set) => set.set_number),
    ) + 1;
  const set: LoggedSetRow = {
    id: Crypto.randomUUID(),
    user_id: snapshot.session.user_id,
    session_exercise_id: exerciseId,
    set_number: setNumber,
    set_type: 'working',
    target_reps: null,
    target_weight_kg: null,
    actual_reps: null,
    actual_weight_kg: null,
    notes: null,
  };
  return {
    ...snapshot,
    sets: [...snapshot.sets, set],
    session: { ...snapshot.session, updated_at: now },
  };
}

export function setComments(
  snapshot: SessionSnapshot,
  comments: string,
  now: string,
): SessionSnapshot {
  return {
    ...snapshot,
    session: {
      ...snapshot.session,
      comments: comments || null,
      updated_at: now,
    },
  };
}

export function finishSnapshot(
  snapshot: SessionSnapshot,
  now: string,
): SessionSnapshot {
  if (snapshot.session.status !== 'in_progress')
    throw new Error('This session has already finished.');
  const paused = isRunning(snapshot) ? pauseSnapshot(snapshot, now) : snapshot;
  return {
    ...paused,
    session: {
      ...paused.session,
      status: completionStatus(paused),
      finished_at: now,
      updated_at: now,
    },
  };
}

function completionStatus(snapshot: SessionSnapshot): 'completed' | 'partial' {
  return snapshot.exercises.every((exercise) =>
    snapshot.sets.some(
      (set) =>
        set.session_exercise_id === exercise.id &&
        set.set_type === 'working' &&
        set.actual_reps !== null &&
        set.actual_weight_kg !== null,
    ),
  )
    ? 'completed'
    : 'partial';
}

export function saveEditedSnapshot(
  snapshot: SessionSnapshot,
  now: string,
): SessionSnapshot {
  if (snapshot.session.status === 'in_progress')
    throw new Error('Finish this session before editing it.');
  return {
    ...snapshot,
    session: {
      ...snapshot.session,
      status: completionStatus(snapshot),
      updated_at: now,
    },
  };
}
