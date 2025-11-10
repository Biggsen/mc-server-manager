## UI / UX Overhaul Plan

### Objectives
- Present a cohesive, modern interface that communicates project health at a glance and reduces cognitive load.
- Streamline common workflows (scan assets, generate manifest/build, run locally, manage plugins/configs).
- Provide responsive layouts that work on a minimum 1280px desktop viewport and gracefully degrade to tablet widths.
- Establish reusable design tokens (spacing, typography, colors, elevation) for consistent future features.

### Design Principles
- **Hierarchy first**: clear visual separation between navigation, page title, primary call-to-action, and supporting panels.
- **Action clarity**: every destructive or long-running action requires confirmatory affordances and status messaging.
- **Status visibility**: surface build/run state, manifest age, and asset completeness without drilling into detail panels.
- **Symmetry across entities**: projects, builds, runs, and deployments share common list patterns and detail views.

### IA & Navigation
1. **Primary shell**
   - Persistent left sidebar (240 px) with sections: Dashboard, Projects, Plugins, Deployments, Dev Tools, Settings.
   - Top utility bar replacing header buttons; includes global search, user profile dropdown, environment indicator.
2. **Project overview**
   - Breadcrumb: `Projects / <Project Name>`.
   - Tabs under title: Overview, Assets, Builds, Runs, Repository, Settings.
   - Each tab owns its content to reduce vertical scrolling.

### Visual System
- **Colors**: adopt neutral slate background (`#0f172a`), secondary panels `#1e293b`, primary accent teal (`#0ea5e9`), warning amber, danger rose.
- **Typography**: Inter 400/500/600; base 14 px, heading scale (32/24/18/16).
- **Spacing**: 8 px unit grid; panels 24 px padding, sections separated by 16 px.
- **Elevation**: Use subtle shadows (0 px 12 px 48 px rgba(15, 23, 42, 0.3)) and borders (1 px solid rgba(255,255,255,0.05)).
- **Components**: define tokens for badges, pills, tables, cards, toasts, skeleton loaders.

### Key Screens
1. **Dashboard**
   - Hero banner with usage summary (projects, latest build success, pending runs).
   - Recent activity feed (builds/runs) with status chips.
   - Quick actions (New Project, Import, Open Plugin Library).
2. **Project Overview Tab**
   - Top summary card: status badges, last build time, repo info.
   - Action bar with primary `Run Build`, secondary `Generate Manifest`, tertiary `Run Locally`, `Scan Assets`, `Generate Profile`.
   - Split layout:
     - **Left column (60%)**: timeline of builds/runs, manifest preview drawer.
     - **Right column (40%)**: plugin summary list, config summary, GitHub link card.
   - Toast area for inline operation feedback.
3. **Assets Tab**
   - Two-column grid: plugins table with search/pagination, configs table with upload/edit controls.
   - Empty-state illustrations guiding user to add assets.
4. **Builds Tab**
   - Table view with filtering (status, date range), ability to download artifacts.
   - Drawer for build details incl. manifest JSON viewer.
5. **Runs Tab**
   - Current run panel with live logs (virtualized), command input (future interactive console).
   - History list with status chips, rerun button.

### Interaction Enhancements
- **Async status**: integrate top-right activity indicator showing in-progress actions.
- **Toasts**: consistent success/danger info for API calls, auto-dismiss with manual close.
- **Modals**: confirm destructive actions (delete project, remove plugin).
- **Skeleton loading**: on initial fetch to reduce layout shifting.
- **Form improvements**: inline validation, field descriptions, consistent button placement.

### Technical Approach
- Adopt a component system (e.g. shadcn-based or custom) with shared UI primitives in `frontend/src/components`.
- Introduce global design tokens via CSS variables (e.g., `:root { --color-bg: ... }`) and update Tailwind/CSS modules accordingly.
- Refactor pages to use layout wrappers (`AppLayout`, `DetailLayout`, `SplitPane`).
- Implement `useToast` hook for notifications and `useAsyncAction` helper for busy states.
- Gradually replace ad-hoc styles with composition, using storybook-style preview (optional stretch) for rapid iteration.

### Rollout Plan
1. **Foundation**
   - Create design tokens, typography scale, color palette.
   - Build base components: Button, Input, Card, Badge, Tabs, Table, Toast, Skeleton.
   - Update router layout to new sidebar/topbar structure.
2. **Project Detail overhaul**
   - Migrate actions to new toolbar, reorganize content into Overview/Assets/Builds/Tabs.
   - Integrate toasts and busy indicators.
3. **Other pages**
   - Dashboard redesign, Projects list, Plugin library, Deployments.
4. **Polish**
   - Responsiveness adjustments, accessibility audit (focus order, ARIA), theme refinements.
   - Documentation of component usage in `docs/ui-guide.md`.

### Risks & Mitigations
- **Scope creep**: lock initial rollout to navigation + project detail; treat other sections as follow-up iterations.
- **CSS regression**: take snapshots, use feature flags, and test in multiple browsers.
- **Performance**: ensure virtualization for large tables; memoize expensive operations.

### Success Criteria
- Reduced clicks for core workflows (generate manifest, run locally).
- Users can identify project status without scrolling.
- Consistent branding and styling across all modules.
- Positive internal feedback and fewer “where is X?” questions during testing.


