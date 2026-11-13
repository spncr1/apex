-- Planned reps and weight may be omitted when a workout is scheduled.
-- Actual session reps and weight remain separate and are entered while logging.
alter table public.planned_set_targets
  alter column target_reps drop not null,
  alter column target_weight_kg drop not null;
