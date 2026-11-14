# Engineering rules

The official product name is APEX and its technical identifier is `apex`.

## Scope and approval

- Treat the owner's active task as the complete authorisation. Do not add unrequested features, screens, packages, abstractions, utilities, sample data, design variations, integrations, or documentation.
- An implementation plan proposed by Codex is not authorisation. Once the owner approves a plan, implement only its active milestone and acceptance criteria.
- Stop and ask the owner before changing approved architecture, visual decisions, workflows, product decisions, or work outside the active task or approved milestone. Do not silently substitute a different solution when a requirement is ambiguous, contradictory, or impossible.
- Preserve user edits. Inspect the worktree and existing code before modifying files. Keep changes within scope.

## Engineering practice

- Respect the approved stack: React Native, Expo, TypeScript, Expo Router, React Native StyleSheet, Supabase Auth and PostgreSQL through Supabase, Inter, Lucide React Native, react-native-svg, and Anatome assets.
- Follow the established route and feature boundaries. Keep presentation, domain logic, and persistence responsibilities separate. Prefer reusable abstractions where reuse is real; avoid unnecessary dependencies.
- Use strict TypeScript practices. Keep route files thin and do not implement speculative modules.
- Read `DESIGN_SYSTEM.md` before relevant UI work. Read `APP_RULES.md` before relevant product or business-logic work. Inspect the relevant approved mockups before implementing a screen.
- Run relevant available checks after changes. Report changes, verification results, and unresolved issues accurately; do not claim simulator or backend verification without performing it.
