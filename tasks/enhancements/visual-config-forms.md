# Visual Configuration Forms

## Overview

Add ongoing form-based editing for `server.properties` and `paper-global.yml` within projects. Currently, the `GenerateProfile` page can generate these files, but there's no way to edit them through the UI after project creation.

## Current State

- `GenerateProfile.tsx` exists and can generate `server.properties` and `paper-global.yml` from forms
- Forms include: MOTD, max players, view distance, online mode, target tick distance
- **Not integrated into project editing** - it's a one-time generation step
- Users must manually edit config files or re-run profile generation
- Config files can be uploaded, but no form-based editing exists

## Enhancement

### Configuration Editor

1. **Editor Interface:**
   - Add "Configuration" tab in Project Detail page
   - Form-based editor for `server.properties`
   - Form-based editor for `paper-global.yml`
   - Real-time preview of generated config
   - Save changes to project profile

2. **Server Properties Form:**
   - MOTD (text input)
   - Max players (number input)
   - View distance (number input, 3-32)
   - Simulation distance (number input, 3-32)
   - Online mode (toggle)
   - Enforce secure profile (toggle)
   - Level seed (text input, optional)
   - Difficulty (dropdown: peaceful, easy, normal, hard)
   - PVP (toggle)
   - Spawn monsters (toggle)
   - Spawn animals (toggle)
   - Spawn NPCs (toggle)
   - Generate structures (toggle)
   - Hardcore mode (toggle)
   - Additional common properties

3. **Paper Global Form:**
   - Target tick distance (number input, 1-12)
   - Chunk system settings
   - Performance settings
   - Other common Paper global config options

4. **Profile Integration:**
   - Update `profiles/base.yml` `configs.files` section with form values
   - Preserve existing template structure
   - Commit changes to GitHub on save
   - Show diff preview before saving

### Workflow

1. User opens Project Detail → Configuration tab
2. Form is populated from current profile config values
3. User edits values in form
4. Preview shows generated config content
5. User saves → updates profile → commits to GitHub
6. Next build uses updated configuration

## Implementation

1. **Backend Routes:**
   - `GET /projects/:id/config` - get current config values from profile
   - `PUT /projects/:id/config` - update config values in profile
   - Parse profile YAML to extract config template data
   - Update profile with new config values

2. **Profile Service:**
   - `services/configEditor.ts` - parse and update profile configs
   - Extract template data from `profiles/base.yml`
   - Merge form values into profile structure
   - Validate config values (ranges, formats)

3. **Frontend Components:**
   - `ConfigEditor.tsx` - main configuration editor
   - `ServerPropertiesForm.tsx` - server.properties form
   - `PaperGlobalForm.tsx` - paper-global.yml form
   - `ConfigPreview.tsx` - preview generated config
   - Add to Project Detail page (new "Configuration" tab)

4. **Form State Management:**
   - Load current values from profile on mount
   - Track dirty state (unsaved changes)
   - Validate on save
   - Show success/error feedback

## Benefits

- **User-friendly:** No need to edit YAML or config files manually
- **Validation:** Form inputs can validate ranges and formats
- **Consistency:** All configs managed in one place
- **Version control:** Changes committed to GitHub automatically
- **Preview:** See generated config before saving

## Priority

**High** - The spec lists "Visual Configuration" as a main feature and step 4 in project creation. Currently users must use the one-time GenerateProfile page or manually edit files, which breaks the visual workflow.

