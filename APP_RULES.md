# Application rules

These are requirements for later approved implementation milestones. They do not authorise feature work during scaffolding.

## Workout scheduling

- Users plan workouts across the week. Scheduled workouts remain distinguishable from performed workouts.
- Add Workout creates a workout directly for the selected date. The app has no workout templates or automatic recurrence.
- Planned set reps and weight may be left blank; session logging captures the actual values.
- The weekly workout goal stays unset until the user enters one.
- Exercises within a workout are unordered. Drag-and-drop exercise ordering is not required.

## Workout sessions

- Sessions start manually. Timers support start, pause, resume, and finish.
- Exclude paused time from elapsed duration. Timing must survive application backgrounding.
- Workout statuses are planned, in progress, completed, partial, and skipped.

## Exercise logging

- New planned and logged sets are working sets. The app does not ask users to log warm-up sets.
- Session set numbers are assigned automatically as sets are added.
- Workout comments, persistent exercise notes, and individual set notes are separate.
- Preserve historical workout data.

## Exercise management

- Exercises belong to muscle groups. Predefined muscle subdivisions must be grounded in credible anatomical and exercise-science sources.
- Exercise details show previous performances in the original set-table structure, grouped by workout session and date, most recent first. Historical sessions remain accessible.

## Workout adaptation

- Dated workouts can be edited, swapped, skipped, and moved without changing other workouts.
- Exercise ordering is not required.

## Muscle-group navigation

- Show muscle groups in an alphabetical, vertically scrollable directory. Selecting one opens its specific page.
- Specific pages show predefined anatomical subdivisions and their exercises.
- An interactive anatomical controller will eventually filter exercises by selected region. Clearing the selection restores the full list.

## Community

- A tappable Community page is planned. During MVP it displays an "In Development" placeholder. Functional social networking is excluded.

## MVP exclusions

- No AI-powered exercise recommendations, advanced performance analytics, exercise demonstration video integration, exercise media upload, functional community features, nutrition tracking, or unapproved additional functionality.
