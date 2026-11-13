#!/usr/bin/env python3
"""Build a checked, repeatable SQL import from the reviewed Notion manifest.

Usage: python3 scripts/import-notion-history.py MANIFEST USER_ID OUTPUT_SQL
Review the SQL, then run it against the intended Supabase project.
"""

import collections
import datetime as dt
import json
import re
import sys
import uuid
from pathlib import Path
from zoneinfo import ZoneInfo


NAMESPACE = uuid.UUID("1dd4d9bc-421b-4aa7-821a-9f58b98b6ae7")
BASELINE_DATES = {"2026-11-09", "2026-11-10", "2026-11-12", "2026-11-13"}


def source_uuid(value: str) -> str:
    return str(uuid.UUID(value))


def sql_json(value: object) -> str:
    encoded = json.dumps(value, ensure_ascii=False, separators=(",", ":"))
    if "$notion_import$" in encoded:
        raise ValueError("Unexpected SQL delimiter in source data")
    return "$notion_import$" + encoded + "$notion_import$::jsonb"


def build(manifest: dict, user_id: str) -> str:
    groups = manifest["groups"]
    exercises = manifest["exercises"]
    source_workouts = manifest["workouts"]
    source_sets = manifest["sets"]
    if len(groups) != 8 or len(exercises) != 71:
        raise ValueError("Expected 8 groups and 71 exercises")
    if any("Home Exercises" in group["name"] for group in groups):
        raise ValueError("Home Exercises must be excluded")
    group_ids = {source_uuid(group["source_group_id"]) for group in groups}
    exercise_ids = {source_uuid(exercise["source_exercise_id"]) for exercise in exercises}
    if len(group_ids) != len(groups) or len(exercise_ids) != len(exercises):
        raise ValueError("Duplicate group or exercise source ID")
    if any(source_uuid(exercise["source_group_id"]) not in group_ids for exercise in exercises):
        raise ValueError("Exercise has an unknown group")

    verified = [row for row in source_sets if row["verified_complete"] is True]
    if len(verified) != 673 or len(source_sets) - len(verified) != 132:
        raise ValueError("Expected 673 verified and 132 excluded sets")
    if len({source_uuid(row["source_set_id"]) for row in verified}) != len(verified):
        raise ValueError("Duplicate verified set ID")
    by_workout = collections.Counter(source_uuid(row["source_workout_id"]) for row in verified)
    all_by_workout = collections.Counter(source_uuid(row["source_workout_id"])
                                         for row in source_sets if row["source_workout_id"])
    source_workout_ids = {source_uuid(row["source_workout_id"]) for row in source_workouts}
    if len(source_workout_ids) != len(source_workouts) or set(by_workout) - source_workout_ids:
        raise ValueError("Invalid workout source IDs")
    if len(by_workout) != 120:
        raise ValueError("Expected 120 workouts with verified sets")

    positions = set()
    exercise_positions: dict[tuple[str, str], list[int]] = collections.defaultdict(list)
    sets = []
    for row in verified:
        workout_id = source_uuid(row["source_workout_id"])
        exercise_id = source_uuid(row["source_exercise_id"])
        if exercise_id not in exercise_ids:
            raise ValueError("Verified set has an unknown exercise")
        raw_number = row["set_number"]
        raw_reps = row["actual_reps"]
        if (raw_number is None or raw_number < 1 or int(raw_number) != raw_number
                or raw_reps is None or raw_reps < 0 or int(raw_reps) != raw_reps
                or row["actual_weight_kg"] is None or row["actual_weight_kg"] < 0):
            raise ValueError("Invalid verified set values")
        number = int(raw_number)
        position = (workout_id, exercise_id, number)
        if position in positions:
            raise ValueError("Duplicate set number in workout exercise")
        positions.add(position)
        exercise_positions[(workout_id, exercise_id)].append(number)
        sets.append({
            "id": source_uuid(row["source_set_id"]),
            "workout_id": workout_id,
            "source_exercise_id": exercise_id,
            "session_exercise_id": str(uuid.uuid5(NAMESPACE, f"session-exercise:{workout_id}:{exercise_id}")),
            "set_number": number,
            "reps": int(raw_reps),
            "weight": row["actual_weight_kg"],
            "notes": row["notes"] or None,
        })
    if any(sorted(numbers) != list(range(1, len(numbers) + 1))
           for numbers in exercise_positions.values()):
        raise ValueError("Verified set numbers are not consecutive")

    workouts = []
    for row in source_workouts:
        workout_id = source_uuid(row["source_workout_id"])
        if workout_id not in by_workout:
            continue
        date = dt.date.fromisoformat(row["workout_date"])
        if row["start_time"] or row["finish_time"]:
            raise ValueError("Unexpected source time: review before import")
        # Storage marker only. No interval is created, so active duration is zero.
        marker = dt.datetime.combine(date, dt.time(12), ZoneInfo("Australia/Sydney"))
        status = "completed" if by_workout[workout_id] == all_by_workout[workout_id] else "partial"
        if row["workout_date"] in BASELINE_DATES and status != "completed":
            raise ValueError("Baseline workout has excluded sets")
        workouts.append({
            "id": workout_id,
            "date": date.isoformat(),
            "name": row["name"],
            "comments": row["comments"] or None,
            "status": status,
            "marker": marker.isoformat(),
            "session_id": str(uuid.uuid5(NAMESPACE, f"session:{workout_id}")),
        })
    if {row["date"] for row in workouts if row["date"] in BASELINE_DATES} != BASELINE_DATES:
        raise ValueError("Four baseline dates are not all present")

    normalized_groups = [{"id": source_uuid(row["source_group_id"]),
                          "name": re.sub(r"^\d+\.\s*", "", row["name"]).strip()}
                         for row in groups]
    catalog = [{"id": source_uuid(row["source_exercise_id"]),
                "group_id": source_uuid(row["source_group_id"]), "name": row["name"]}
               for row in exercises]
    if any(not row["name"] for row in normalized_groups + catalog + workouts):
        raise ValueError("Blank source name")

    return f"""-- Generated from reviewed Notion manifest. Account-scoped, atomic, repeatable.
-- Date-only legacy workouts use noon Sydney as a storage marker, not a real time.
-- No session intervals are imported; active duration remains zero.
BEGIN;
CREATE TEMP TABLE _notion_groups ON COMMIT DROP AS
SELECT * FROM jsonb_to_recordset({sql_json(normalized_groups)}) AS x(id uuid, name text);
CREATE TEMP TABLE _notion_exercises ON COMMIT DROP AS
SELECT * FROM jsonb_to_recordset({sql_json(catalog)}) AS x(id uuid, group_id uuid, name text);
CREATE TEMP TABLE _notion_workouts ON COMMIT DROP AS
SELECT * FROM jsonb_to_recordset({sql_json(workouts)})
AS x(id uuid, date date, name text, comments text, status text, marker timestamptz, session_id uuid);
CREATE TEMP TABLE _notion_sets ON COMMIT DROP AS
SELECT * FROM jsonb_to_recordset({sql_json(sets)})
AS x(id uuid, workout_id uuid, source_exercise_id uuid, session_exercise_id uuid,
     set_number integer, reps integer, weight numeric, notes text);
CREATE TEMP TABLE _notion_catalog ON COMMIT DROP AS
SELECT e.id AS source_id, live.id AS exercise_id, live.name AS exercise_name
FROM _notion_exercises e
JOIN _notion_groups g ON g.id = e.group_id
JOIN public.muscle_groups lg ON lg.owner_id = '{user_id}'::uuid AND lower(lg.name) = lower(g.name)
JOIN public.exercises live ON live.owner_id = '{user_id}'::uuid
 AND live.muscle_group_id = lg.id AND lower(live.name) = lower(e.name);
DO $preflight$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = '{user_id}'::uuid) THEN
   RAISE EXCEPTION 'Import account does not exist'; END IF;
 IF (SELECT count(*) FROM _notion_groups) <> 8
    OR (SELECT count(*) FROM _notion_exercises) <> 71
    OR (SELECT count(*) FROM _notion_catalog) <> 71
    OR (SELECT count(*) FROM _notion_workouts) <> 120
    OR (SELECT count(*) FROM _notion_sets) <> 673 THEN
   RAISE EXCEPTION 'Source or account catalog count mismatch'; END IF;
 IF EXISTS (SELECT 1 FROM _notion_exercises e LEFT JOIN _notion_catalog c ON c.source_id=e.id
            WHERE c.source_id IS NULL) THEN
   RAISE EXCEPTION 'An exercise is missing from the account catalog'; END IF;
 IF EXISTS (SELECT 1 FROM _notion_workouts w JOIN public.planned_workouts p ON p.id=w.id
            WHERE p.user_id <> '{user_id}'::uuid OR p.planned_date <> w.date OR p.name_snapshot <> w.name) THEN
   RAISE EXCEPTION 'Source workout ID already belongs to a different plan'; END IF;
 IF EXISTS (SELECT 1 FROM _notion_workouts w JOIN public.planned_workouts p ON p.id=w.id
            LEFT JOIN public.workout_sessions s ON s.planned_workout_id=p.id
            WHERE s.id IS NULL OR s.id <> w.session_id OR s.user_id <> '{user_id}'::uuid) THEN
   RAISE EXCEPTION 'Existing source workout has no matching imported session'; END IF;
 IF EXISTS (SELECT 1 FROM _notion_workouts w JOIN public.workout_sessions s ON s.id=w.session_id
            WHERE s.planned_workout_id <> w.id OR s.user_id <> '{user_id}'::uuid) THEN
   RAISE EXCEPTION 'Source session ID already belongs to another workout'; END IF;
 IF EXISTS (SELECT 1 FROM _notion_sets n JOIN public.logged_sets l ON l.id=n.id
            JOIN public.session_exercises se ON se.id=l.session_exercise_id
            JOIN public.workout_sessions s ON s.id=se.session_id
            WHERE s.planned_workout_id <> n.workout_id OR se.exercise_id <>
              (SELECT c.exercise_id FROM _notion_catalog c WHERE c.source_id=n.source_exercise_id)) THEN
   RAISE EXCEPTION 'Source set ID already belongs to another workout or exercise'; END IF;
END;
$preflight$;
CREATE TEMP TABLE _notion_new ON COMMIT DROP AS
SELECT w.* FROM _notion_workouts w
WHERE NOT EXISTS (SELECT 1 FROM public.planned_workouts p WHERE p.id=w.id);
INSERT INTO public.planned_workouts
  (id, user_id, planned_date, name_snapshot, status, revision, is_overridden)
SELECT id, '{user_id}'::uuid, date, name, status, 2, false FROM _notion_new;
INSERT INTO public.planned_exercises (user_id, planned_workout_id, exercise_id, name_snapshot)
SELECT DISTINCT '{user_id}'::uuid, n.id, c.exercise_id, c.exercise_name
FROM _notion_new n JOIN _notion_sets s ON s.workout_id=n.id
JOIN _notion_catalog c ON c.source_id=s.source_exercise_id;
INSERT INTO public.planned_set_targets
  (user_id, planned_exercise_id, set_number, set_type, target_reps, target_weight_kg)
SELECT '{user_id}'::uuid, pe.id, s.set_number, 'working', NULL, NULL
FROM _notion_new n JOIN _notion_sets s ON s.workout_id=n.id
JOIN _notion_catalog c ON c.source_id=s.source_exercise_id
JOIN public.planned_exercises pe ON pe.planned_workout_id=n.id AND pe.exercise_id=c.exercise_id;
INSERT INTO public.workout_sessions
  (id, user_id, planned_workout_id, status, started_at, finished_at, comments, revision)
SELECT session_id, '{user_id}'::uuid, id, status, marker, marker, comments, 1 FROM _notion_new;
INSERT INTO public.session_exercises
  (id, user_id, session_id, exercise_id, name_snapshot)
SELECT DISTINCT s.session_exercise_id, '{user_id}'::uuid, n.session_id, c.exercise_id, c.exercise_name
FROM _notion_new n JOIN _notion_sets s ON s.workout_id=n.id
JOIN _notion_catalog c ON c.source_id=s.source_exercise_id;
INSERT INTO public.logged_sets
  (id, user_id, session_exercise_id, set_number, set_type,
   target_reps, target_weight_kg, actual_reps, actual_weight_kg, notes)
SELECT s.id, '{user_id}'::uuid, s.session_exercise_id, s.set_number, 'working',
       NULL, NULL, s.reps, s.weight, s.notes
FROM _notion_new n JOIN _notion_sets s ON s.workout_id=n.id;
INSERT INTO public.session_revisions (user_id, session_id, revision, snapshot)
SELECT '{user_id}'::uuid, n.session_id, 1, public.session_snapshot_internal(n.session_id)
FROM _notion_new n;
SELECT (SELECT count(*) FROM _notion_new) AS imported_workouts,
       (SELECT count(*) FROM _notion_new n JOIN _notion_sets s ON s.workout_id=n.id) AS imported_sets,
       (SELECT count(*) FROM _notion_workouts) AS source_workouts,
       (SELECT count(*) FROM _notion_sets) AS verified_source_sets;
COMMIT;
"""


if __name__ == "__main__":
    if len(sys.argv) != 4:
        raise SystemExit(__doc__)
    manifest_path, account_id, output_path = sys.argv[1:]
    sql = build(json.loads(Path(manifest_path).read_text(encoding="utf-8")),
                str(uuid.UUID(account_id)))
    Path(output_path).write_text(sql, encoding="utf-8")
    print(f"Wrote {output_path} ({len(sql)} bytes)")
