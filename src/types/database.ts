// Row shapes for the initial Supabase schema. Dates and timestamps are ISO strings.
export type UUID = string;
export type CalendarDate = string;
export type Timestamp = string;

export type SetType = 'warm_up' | 'working';
export type WorkoutStatus =
  'planned' | 'in_progress' | 'completed' | 'partial' | 'skipped';
export type SessionStatus = 'in_progress' | 'completed' | 'partial';
export type ConflictStatus = 'pending' | 'resolved';

export interface UserSettingsRow {
  user_id: UUID;
  weekly_goal: number;
  updated_at: Timestamp;
}

export interface MuscleGroupRow {
  id: UUID;
  owner_id: UUID | null;
  name: string;
  created_at: Timestamp;
}

export interface MuscleSubdivisionRow {
  id: UUID;
  muscle_group_id: UUID;
  owner_id: UUID | null;
  name: string;
  created_at: Timestamp;
}

export interface ExerciseRow {
  id: UUID;
  muscle_group_id: UUID;
  muscle_subdivision_id: UUID | null;
  owner_id: UUID | null;
  name: string;
  created_at: Timestamp;
}

export interface PlannedWorkoutRow {
  id: UUID;
  user_id: UUID;
  template_id: UUID | null;
  planned_date: CalendarDate;
  name_snapshot: string;
  goal_snapshot: string | null;
  source_template_revision: number | null;
  is_overridden: boolean;
  is_recurring: boolean;
  status: WorkoutStatus;
  revision: number;
  created_at: Timestamp;
  updated_at: Timestamp;
  archived_at: Timestamp | null;
}

export interface PlannedExerciseRow {
  id: UUID;
  user_id: UUID;
  planned_workout_id: UUID;
  exercise_id: UUID;
  name_snapshot: string;
}

export interface PlannedSetTargetRow {
  id: UUID;
  user_id: UUID;
  planned_exercise_id: UUID;
  set_number: number;
  set_type: SetType;
  target_reps: number | null;
  target_weight_kg: number | null;
}

export interface WorkoutSessionRow {
  id: UUID;
  user_id: UUID;
  planned_workout_id: UUID;
  status: SessionStatus;
  started_at: Timestamp;
  finished_at: Timestamp | null;
  comments: string | null;
  revision: number;
  updated_at: Timestamp;
  archived_at: Timestamp | null;
}

export interface SessionIntervalRow {
  id: UUID;
  user_id: UUID;
  session_id: UUID;
  started_at: Timestamp;
  ended_at: Timestamp | null;
}

export interface SessionExerciseRow {
  id: UUID;
  user_id: UUID;
  session_id: UUID;
  exercise_id: UUID;
  name_snapshot: string;
}

export interface LoggedSetRow {
  id: UUID;
  user_id: UUID;
  session_exercise_id: UUID;
  set_number: number;
  set_type: SetType;
  target_reps: number | null;
  target_weight_kg: number | null;
  actual_reps: number | null;
  actual_weight_kg: number | null;
  notes: string | null;
}

export interface MuscleGroupNoteRow {
  user_id: UUID;
  muscle_group_id: UUID;
  notes: string;
  updated_at: Timestamp;
}

export interface ExerciseNoteRow {
  user_id: UUID;
  exercise_id: UUID;
  notes: string;
  updated_at: Timestamp;
}

export interface SessionSnapshot {
  session: WorkoutSessionRow;
  intervals: SessionIntervalRow[];
  exercises: SessionExerciseRow[];
  sets: LoggedSetRow[];
}

export interface SessionRevisionRow {
  id: UUID;
  user_id: UUID;
  session_id: UUID;
  revision: number;
  snapshot: SessionSnapshot;
  saved_at: Timestamp;
}

export interface SessionConflictRow {
  id: UUID;
  user_id: UUID;
  session_id: UUID;
  base_revision: number;
  local_snapshot: SessionSnapshot;
  remote_snapshot: SessionSnapshot;
  rejected_snapshot: SessionSnapshot | null;
  status: ConflictStatus;
  created_at: Timestamp;
  resolved_at: Timestamp | null;
  resolution_response: {
    kind: 'resolved';
    choice: 'local' | 'remote';
    snapshot: SessionSnapshot;
    revision: number;
  } | null;
}

export interface DatabaseRows {
  user_settings: UserSettingsRow;
  muscle_groups: MuscleGroupRow;
  muscle_subdivisions: MuscleSubdivisionRow;
  exercises: ExerciseRow;
  planned_workouts: PlannedWorkoutRow;
  planned_exercises: PlannedExerciseRow;
  planned_set_targets: PlannedSetTargetRow;
  workout_sessions: WorkoutSessionRow;
  session_intervals: SessionIntervalRow;
  session_exercises: SessionExerciseRow;
  logged_sets: LoggedSetRow;
  muscle_group_notes: MuscleGroupNoteRow;
  exercise_notes: ExerciseNoteRow;
  session_revisions: SessionRevisionRow;
  session_conflicts: SessionConflictRow;
}
