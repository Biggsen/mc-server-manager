# Post-Start Init Rules (Gamerules)

## Overview

Add support for configuring Minecraft gamerules (like `keepInventory`) that are applied automatically when a server starts or when a world is first created. These rules are separate from `server.properties` settings and are applied via a generated datapack that runs on world load.

## Current State

- `GenerateProfile.tsx` allows configuring `server.properties` and `paper-global.yml`
- No way to configure gamerules through the UI
- Gamerules must be set manually via console/RCON after server starts
- No automated mechanism to apply gamerules on world creation
- Datapack infrastructure exists in project structure (`assets/datapacks/`) but is not programmatically generated

## Enhancement

### Gamerules Configuration

1. **UI Interface:**
   - Add "Gamerules" section in `GenerateProfile.tsx` (separate from Server Properties)
   - Toggle-based controls for common gamerules
   - Start with `keepInventory` as the first rule
   - Design for easy expansion to additional gamerules

2. **Profile Storage:**
   - Add `gamerules` section to profile YAML structure
   - Store as array of rule objects: `{ name: string, value: boolean | number | string }`
   - Separate from `configs` section (gamerules are runtime rules, not static config)

3. **Datapack Generation:**
   - Build pipeline generates init datapack when gamerules are present
   - Datapack structure: `assets/datapacks/mc-server-manager-init/`
   - Uses Minecraft's function tag system to run on world load
   - Applies all configured gamerules automatically

4. **Build Integration:**
   - Include generated datapack in build artifacts
   - Datapack is automatically loaded by Minecraft server
   - Rules apply once per world (gamerules persist in world save)

### Datapack Structure

```
assets/datapacks/mc-server-manager-init/
├── pack.mcmeta
├── data/
│   └── mc_server_manager_init/
│       ├── tags/
│       │   └── functions/
│       │       └── load.json
│       └── functions/
│           └── init.mcfunction
```

**pack.mcmeta:**
```json
{
  "pack": {
    "description": "MC Server Manager init rules",
    "pack_format": 15
  }
}
```

**load.json:**
```json
{
  "values": ["mc_server_manager_init:init"]
}
```

**init.mcfunction:**
```
gamerule keepInventory true
# Additional gamerules added here
```

### Profile Schema

Add to `profiles/base.yml`:
```yaml
gamerules:
  - name: "keepInventory"
    value: true
  # Future: additional rules
  # - name: "doMobSpawning"
  #   value: false
  # - name: "randomTickSpeed"
  #   value: 3
```

## Implementation

### 1. Frontend Changes

**GenerateProfile.tsx:**
- Add `GamerulesFields` interface with `keepInventory: boolean`
- Add state management for gamerules
- Add UI section with toggle for "Keep Inventory"
- Extract gamerules from existing profile on load
- Include gamerules in `buildProfileDocument` output

**UI Layout:**
- Place "Gamerules" card alongside "Server Properties" and "Paper Global Config"
- Use Switch component for boolean gamerules
- Add description text explaining these rules apply on world creation

### 2. Backend Changes

**Profile Parsing:**
- Update profile extraction logic to read `gamerules` section
- Handle missing gamerules section gracefully (default to empty array)

**Build Pipeline (`buildQueue.ts`):**
- Add `generateInitDatapack()` function
- Called during `materializeConfigs()` phase
- Generates datapack structure if gamerules exist
- Writes datapack to build artifact under `assets/datapacks/mc-server-manager-init/`
- Include datapack in manifest/config tracking

**Datapack Generator:**
- Create `services/datapackGenerator.ts`
- Function: `generateInitDatapack(gamerules: Gamerule[]): DatapackFiles`
- Generates all required datapack files
- Handles different gamerule value types (boolean, number, string)
- Escapes special characters in function commands

### 3. Type Definitions

**Backend Types:**
```typescript
interface Gamerule {
  name: string
  value: boolean | number | string
}

interface ProfileDocument {
  // ... existing fields
  gamerules?: Gamerule[]
}
```

**Frontend Types:**
```typescript
interface GamerulesFields {
  keepInventory: boolean
  // Future: additional fields
}
```

### 4. Build Artifact Integration

- Datapack included in ZIP artifact
- Server automatically loads datapacks from `world/datapacks/` on world creation
- Rules apply on first world load, then persist in world save
- Subsequent server starts don't re-run (gamerules already set in world)

## Workflow

1. User opens Generate Profile page
2. Configures gamerules (e.g., enables "Keep Inventory")
3. Saves profile → gamerules stored in `profiles/base.yml`
4. User builds project
5. Build pipeline generates init datapack from gamerules
6. Datapack included in build artifact
7. Server starts → world loads → datapack runs → gamerules applied
8. Gamerules persist in world save (no re-application needed)

## Benefits

- **No RCON dependency:** Works on any host without RCON setup
- **Automatic application:** Rules apply on world creation without manual intervention
- **Persistent:** Gamerules saved in world, no need to re-apply
- **Version controlled:** Gamerules stored in profile, tracked in Git
- **Extensible:** Easy to add more gamerules in the future
- **Standard approach:** Uses Minecraft's native datapack system

## Edge Cases

- **Existing worlds:** Datapack only runs on new world creation. For existing worlds, rules must be applied manually or world must be regenerated.
- **Multiple worlds:** Each world gets its own datapack application (if using multiple worlds)
- **Conflicting rules:** Last applied rule wins (standard Minecraft behavior)
- **Invalid gamerule names:** Should validate against known gamerules or let server handle errors

## Future Enhancements

- Add more common gamerules to UI (doMobSpawning, doDaylightCycle, randomTickSpeed, etc.)
- Support numeric and string gamerule values (not just booleans)
- Gamerule validation against Minecraft version
- Preview generated datapack function before build
- Option to re-apply rules to existing worlds (via command/RCON)

## Priority

**Medium** - Improves user experience for common server configuration needs. Not critical for MVP but adds significant value for users who want to configure gameplay rules without manual console commands.
