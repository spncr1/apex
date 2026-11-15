# APEX

APEX is a personal workout tracker built with Expo and React Native. Plan workouts for specific days, log working sets and notes during timed sessions, browse your exercise library, and review workout history and progress.

The product name and technical identifier are both APEX (`apex` in package and project settings). Existing storage and native identifiers retain their original names to preserve compatibility.

## Run locally

You need Node.js, npm, and access to a Supabase project with this repository's migrations applied.

1. Install dependencies: `npm ci`
2. Copy `.env.example` to `.env`.
3. Set `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` in `.env` to the URL and **publishable** key for that project. Do not put a service-role key in the app.
4. Start the web app: `npm run dev`
5. Open `http://localhost:19006`.

`npm run dev` starts Expo behind a local proxy that supplies the headers needed by the web SQLite storage. For other Expo workflows, use `npm run start`, `npm run web`, or `npm run ios`. The iOS command requires a working iOS simulator setup.

## What the app does

- **Home:** See the current week, planned workouts, weekly goal, and recent sessions.
- **Plan:** Add and edit workouts directly on a date, set a weekly goal, and manage scheduled workouts. There are no reusable workout templates in the current workflow.
- **Exercises:** Browse muscle groups and exercises, add your own entries, and view exercise notes and performance history.
- **Sessions:** Start a planned workout, pause or resume its timer, log reps, weight, and notes for each working set, then finish or edit the session.
- **Progress:** View completed sessions, active time, total exercises, logged sets, and personal records by week, month, or all time.
- **Social:** An “In Development” placeholder.

Accounts use Supabase email and password sign-in. Workout and exercise records belong to the signed-in account. The app caches data for a returning user and queues session changes made offline; planning and exercise-library edits require a connection.

## Project layout

| Path                   | Purpose                                      |
| ---------------------- | -------------------------------------------- |
| `app/`                 | Expo Router routes and tab layout            |
| `src/features/`        | Screens and workout behavior                 |
| `src/services/`        | Supabase queries and data access             |
| `src/theme/`           | Shared visual tokens                         |
| `supabase/migrations/` | Database schema and access rules             |
| `scripts/`             | Local web server and Notion import utilities |
| `public/`              | Web manifest and Home Screen icons           |

The Notion import scripts are migration utilities, not part of ordinary app startup. Do not rerun them against an account without reviewing their source data and target first.

## Checks and web deployment

Run `npm run typecheck`, `npm run lint`, and `npm run format:check` for the repository checks, or `npm run check` for all three. Build static web files with `npx expo export --platform web`; output goes to `dist/`.

`vercel.json` configures Vercel to run that web export, serve `dist/`, and route app URLs back to the Expo entry page. Set the same two `EXPO_PUBLIC_SUPABASE_*` variables in the Vercel project's **Production** environment before deploying. The deployed web app uses the configured Supabase project; moving from localhost to Vercel does not create a new database or copy account data.

The hosted app is available at [apex-workout-log.vercel.app](https://apex-workout-log.vercel.app/).

On iPhone, the hosted web app can be opened in Safari and added to the Home Screen. A native iOS build is a separate Expo/EAS workflow.
