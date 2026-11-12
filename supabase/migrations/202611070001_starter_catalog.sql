-- Small starter catalog reviewed against ACE's exercise library and anatomy taxonomy.
-- Shared rows have no owner. User-created catalog rows are untouched.
-- See CATALOG_PROPOSAL.md for source links and anatomy limitations.

insert into public.muscle_groups (name)
select name from (values
  ('Abdominals'), ('Biceps'), ('Calves'), ('Chest'), ('Forearms'),
  ('Glutes'), ('Hamstrings'), ('Lats'), ('Quadriceps'), ('Shoulders'), ('Triceps')
) as starter(name)
where not exists (
  select 1 from public.muscle_groups existing
  where existing.owner_id is null and lower(existing.name) = lower(starter.name)
);

insert into public.muscle_subdivisions (muscle_group_id, name)
select g.id, starter.subdivision
from (values
  ('Abdominals', 'Rectus Abdominis'),
  ('Abdominals', 'Obliques'),
  ('Calves', 'Gastrocnemius'),
  ('Calves', 'Soleus'),
  ('Chest', 'Clavicular Pectoralis Major'),
  ('Chest', 'Sternocostal Pectoralis Major'),
  ('Forearms', 'Flexors'),
  ('Forearms', 'Extensors'),
  ('Glutes', 'Gluteus Maximus'),
  ('Glutes', 'Gluteus Medius/Minimus'),
  ('Shoulders', 'Anterior and Medial Deltoids'),
  ('Shoulders', 'Posterior Deltoids')
) as starter(group_name, subdivision)
join public.muscle_groups g on g.owner_id is null and g.name = starter.group_name
where not exists (
  select 1 from public.muscle_subdivisions existing
  where existing.muscle_group_id = g.id and lower(existing.name) = lower(starter.subdivision)
);

-- A subdivision is assigned only where the cited source supports that mapping.
-- Other exercises remain assigned to their whole muscle group.
insert into public.exercises (muscle_group_id, muscle_subdivision_id, name)
select g.id, s.id, starter.exercise_name
from (values
  ('Abdominals', 'Crunch', 'Rectus Abdominis'),
  ('Abdominals', 'Side Plank', 'Obliques'),
  ('Biceps', 'Bicep Curl', null),
  ('Biceps', 'Hammer Curl', null),
  ('Calves', 'Calf Raise', null),
  ('Chest', 'Seated Chest Press', null),
  ('Chest', 'Seated Incline Cable Press', null),
  ('Chest', 'Seated Decline Cable Press', null),
  ('Forearms', 'Wrist Curl - Flexion', 'Flexors'),
  ('Forearms', 'Wrist Curl - Extension', 'Extensors'),
  ('Glutes', 'Glute Bridge', null),
  ('Glutes', 'Hip Bridge', null),
  ('Hamstrings', 'Lying Hamstrings Curl', null),
  ('Lats', 'Seated Lat Pulldown', null),
  ('Quadriceps', 'Seated Leg Extension', null),
  ('Shoulders', 'Seated Shoulder Press', null),
  ('Shoulders', 'Lateral Shoulder Raise', null),
  ('Triceps', 'Triceps Pressdown', null)
) as starter(group_name, exercise_name, subdivision_name)
join public.muscle_groups g on g.owner_id is null and g.name = starter.group_name
left join public.muscle_subdivisions s on s.muscle_group_id = g.id
  and s.name = starter.subdivision_name
where not exists (
  select 1 from public.exercises existing
  where existing.owner_id is null and existing.muscle_group_id = g.id
    and lower(existing.name) = lower(starter.exercise_name)
);
