# MC Server Manager UI Guide

## Design Tokens
- Colors defined as CSS variables with `--mc-` prefix in `frontend/src/index.css`
- Spacing scale uses 8px base: `--mc-gap-sm`, `--mc-gap-md`, etc.
- Radii tokens: `--mc-radius-sm`, `--mc-radius-md`, `--mc-radius-lg`
- Typography primarily Inter font with sizes managed in global CSS

## Layout Primitives
- `AppShell` wraps sidebar, topbar, and main content area
- `MainCanvas` provides scrollable content with optional padding or bleed modes
- `ContentSection` replaces ad-hoc panels; supports subtle tone and flexible element type via `as` prop

## UI Components
Available under `frontend/src/components/ui` and re-exported in `index.ts`:
- `Button` variants: primary, secondary, ghost, pill, link, danger; sizes sm/md/lg; optional icons and loading state
- `Card` with header/content/footer subcomponents
- `Badge` with accent/success/warning/danger/outline variants
- `Tabs` composed of `TabList`, `TabTrigger`, `TabPanels`, `TabPanel`
- `Table`, `Skeleton`, and `Toast` provider with `useToast` hook

## Async Actions
- `useAsyncAction` helper wraps async workflows, triggers toasts, exposes `busy` state
- Global `AsyncActionsProvider` tracks in-flight actions for the header indicator
- `ActiveActionIndicator` surfaced in topbar to show current work

## Page Structure
- Sidebar navigation with sections configured in `App.tsx`
- Topbar includes environment label, search, quick actions, and activity indicator
- Page bodies should compose `ContentSection` instances for consistent elevation and spacing
- Dashboard, Projects, Project Detail, Plugin Library, Deployments, and other pages are retrofitted to use the layout primitives as references

## Styling Notes
- Global styles live in `frontend/src/App.css` with responsive breakpoints at 1200px and 720px
- `styles.css` inside `components/ui` houses component styling (e.g., buttons, badges, tabs)
- Prefer token references over hard-coded values when extending styles
- Activity indicator animation defined in `App.css` via `activity-indicator-spin`

## Future Enhancements
- Storybook (optional) for component previews remains a stretch goal
- Light theme support would require complement tokens but structure is set for dual-mode
- Continue documenting new primitives/components here as they are added
