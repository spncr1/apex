#!/usr/bin/env python3
"""Print an account-scoped, repeatable SQL import for the Notion exercise catalog."""

import argparse
import csv
import json
import re
import uuid
from pathlib import Path


EXPORT_DIR = Path(__file__).resolve().parents[1] / "notion-gym-tracker-data" / "Workout Tracker"
RELATION_SEPARATOR = " (Workout%20Tracker/"


def sql_json(value: object) -> str:
    return "'" + json.dumps(value, ensure_ascii=False).replace("'", "''") + "'::jsonb"


def read_catalog() -> tuple[list[str], list[dict[str, str]]]:
    paths = list(EXPORT_DIR.glob("Exercises *_all.csv"))
    if len(paths) != 1:
        raise ValueError(f"Expected one full Exercises export, found {len(paths)}")

    with paths[0].open(encoding="utf-8-sig", newline="") as source:
        rows = list(csv.DictReader(source))

    if len(rows) != 93:
        raise ValueError(f"Expected 93 source exercises, found {len(rows)}")

    exercises: list[dict[str, str]] = []
    for row in rows:
        relation = row["Muscle Group"]
        if RELATION_SEPARATOR not in relation:
            raise ValueError(f"Missing muscle group relation for {row['Name']!r}")
        original_group = relation.split(RELATION_SEPARATOR, 1)[0]
        if original_group == "6. Home Exercises":
            continue
        group = re.sub(r"^\d+\.\s*", "", original_group).strip()
        name = row["Name"].strip()
        if not group or not name:
            raise ValueError("An imported group or exercise name is blank")
        exercises.append({"group": group, "name": name, "notes": row["Notes"].strip()})

    groups = sorted({row["group"] for row in exercises})
    keys = [(row["group"].casefold(), row["name"].casefold()) for row in exercises]
    if len(groups) != 8 or len(exercises) != 71 or len(keys) != len(set(keys)):
        raise ValueError("Expected 8 groups and 71 unique exercises after excluding Home Exercises")
    return groups, exercises


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--user-id", required=True, type=uuid.UUID)
    account = str(parser.parse_args().user_id)
    groups, exercises = read_catalog()
    group_json = sql_json(groups)
    exercise_json = sql_json(exercises)

    print("BEGIN;")
    print(f"DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = '{account}'::uuid) "
          "THEN RAISE EXCEPTION 'Import account does not exist'; END IF; END $$;")
    print(f"""
WITH desired AS (
  SELECT jsonb_array_elements_text({group_json}) AS name
)
INSERT INTO public.muscle_groups (owner_id, name)
SELECT '{account}'::uuid, d.name
FROM desired d
WHERE NOT EXISTS (
  SELECT 1 FROM public.muscle_groups g
  WHERE g.owner_id = '{account}'::uuid AND lower(g.name) = lower(d.name)
);
""")
    print(f"""
WITH desired AS (
  SELECT * FROM jsonb_to_recordset({exercise_json})
    AS item("group" text, name text, notes text)
)
INSERT INTO public.exercises (owner_id, muscle_group_id, name)
SELECT '{account}'::uuid, g.id, d.name
FROM desired d
JOIN public.muscle_groups g
  ON g.owner_id = '{account}'::uuid AND lower(g.name) = lower(d."group")
WHERE NOT EXISTS (
  SELECT 1 FROM public.exercises e
  WHERE e.owner_id = '{account}'::uuid
    AND e.muscle_group_id = g.id AND lower(e.name) = lower(d.name)
);
""")
    print(f"""
WITH desired AS (
  SELECT * FROM jsonb_to_recordset({exercise_json})
    AS item("group" text, name text, notes text)
)
INSERT INTO public.exercise_notes (user_id, exercise_id, notes)
SELECT '{account}'::uuid, e.id, d.notes
FROM desired d
JOIN public.muscle_groups g
  ON g.owner_id = '{account}'::uuid AND lower(g.name) = lower(d."group")
JOIN public.exercises e
  ON e.owner_id = '{account}'::uuid
  AND e.muscle_group_id = g.id AND lower(e.name) = lower(d.name)
WHERE d.notes <> ''
ON CONFLICT (user_id, exercise_id) DO NOTHING;
""")
    print("COMMIT;")


if __name__ == "__main__":
    main()
