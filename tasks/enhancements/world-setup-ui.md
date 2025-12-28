# World Setup UI

## Overview

Add UI for uploading existing world files or generating new worlds during project creation and editing. This completes the "World Setup" step from the project creation flow in the main spec.

## Current State

- World configuration exists in profiles (`world.mode`, `world.seed`, `world.name`)
- World data can be stored in project repos under `assets/worlds/`
- **No UI for world upload or generation** - users must manually manage world files
- World generation happens automatically in Docker runs, but seed/type cannot be configured via UI

## Enhancement

### World Upload

1. **Upload Interface:**
   - Add "World" tab or section in Project Detail page
   - File upload component for world ZIP files
   - Support uploading entire world folders (as ZIP)
   - Store uploaded worlds in `assets/worlds/<world-name>/`
   - Validate world structure (level.dat, region files, etc.)

2. **World Management:**
   - List uploaded worlds in project
   - Set active world for builds
   - Delete/rename worlds
   - Show world metadata (name, seed if available, size)

### World Generation

1. **Generation Form:**
   - World name input
   - Seed input (text or numeric)
   - World type dropdown (`default`, `flat`, `large_biomes`, `amplified`, `single_biome_surface`)
   - Structures toggle (on/off)
   - Generate world button

2. **Generation Process:**
   - Use Minecraft server to generate world (via Docker or local JAR)
   - Store generated world in `assets/worlds/<world-name>/`
   - Update project profile with world configuration
   - Show generation progress/logs

3. **Profile Integration:**
   - Update `profiles/base.yml` with world settings:
     ```yaml
     world:
       mode: "uploaded"  # or "generated"
       seed: "12345"     # or empty for uploaded
       name: "my-world"
     ```

## Implementation

1. **Backend Routes:**
   - `POST /projects/:id/worlds/upload` - upload world ZIP
   - `POST /projects/:id/worlds/generate` - generate new world
   - `GET /projects/:id/worlds` - list worlds
   - `DELETE /projects/:id/worlds/:name` - delete world
   - `PUT /projects/:id/worlds/:name/activate` - set active world

2. **World Storage:**
   - Store in `data/projects/<project-id>/assets/worlds/<world-name>/`
   - Track in project metadata (list of available worlds, active world)
   - Include in build artifacts when active

3. **Frontend Components:**
   - `WorldUpload.tsx` - upload interface
   - `WorldGenerator.tsx` - generation form
   - `WorldList.tsx` - list and manage worlds
   - Add to Project Detail page (new tab or Assets section)

4. **Generation Service:**
   - `services/worldGenerator.ts` - handle world generation
   - Use Docker container or local Minecraft server JAR
   - Generate world with specified parameters
   - Extract and store world files

## Benefits

- **Complete workflow:** Users can set up worlds entirely through UI
- **Reproducibility:** Generated worlds with seeds are reproducible
- **Ease of use:** No need to manually manage world files
- **Version control:** Worlds stored in project repo, versioned with builds

## Priority

**High** - This is listed as step 2 in the project creation flow and is part of MVP scope. Currently users must manually manage world files, which breaks the "define first, run later" philosophy.

