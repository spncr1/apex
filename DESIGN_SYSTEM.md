# Design system

These are the approved visual foundations for future screens. The supplied mockups are the visual reference for layout, hierarchy, imagery placement, card and table identity, and navigation appearance. They do not authorise implementing those screens during scaffolding. If a relevant mockup is missing or conflicts with a written rule, ask the owner before implementation.

## Palette

| Role             | Hex       |
| ---------------- | --------- |
| Background       | `#0B1220` |
| Surface          | `#152238` |
| Elevated surface | `#1E304A` |
| Primary accent   | `#FACC15` |
| Primary text     | `#F8FAFC` |
| Muted text       | `#94A3B8` |
| Border           | `#334155` |
| Success          | `#22C55E` |
| Warning          | `#F59E0B` |
| Danger           | `#EF4444` |
| Text on yellow   | `#0B1220` |

Use the typed values in `src/theme/tokens.ts` as the single source for colours, typography, spacing, radii, and sizing. Extend central tokens only when an approved screen requires it. Avoid arbitrary hardcoded values in components.

## Visual conventions

- Use a dark navy and black foundation with electric-yellow accents, a modern cinematic superhero/comic feel, and clear visual hierarchy.
- Use Google Fonts Inter as the primary typeface and Lucide React Native for interface icons. Use `react-native-svg` for SVG rendering. Do not add competing icon or styling systems.
- Keep spacing, dimensions, card appearance, modal appearance, buttons, inputs, and form controls consistent across screens. Reuse shared components when genuinely shared; do not create an extensive component library in advance.
- Build for iPhone-sized, mobile-first layouts. Interactive targets must be at least 44 points.
- New screens must visually belong to the same application. Use the approved mockups to settle detailed card, modal, form, navigation, and table treatments when those screens are authorised; those details are not yet specified in tokens.

## Artwork and branding

- Anatome is the approved source for anatomical SVG artwork. Keep approved files under `assets/anatomy/`. Future static and interactive views should use the same artwork where technically possible. Do not invent missing anatomical regions, SVG paths, or anatomical data.
- The owner will select and supply superhero artwork for `assets/heroes/`. Do not generate, download, substitute, or source it independently.
- APEX is the approved product name. Keep the owner-supplied logo in `assets/branding/` and app icons in `assets/icons/`.
- Future UI must respect the logo, title, and artwork placements in the relevant mockups. Do not infer a permanent brand from the mockup text.
