# Init Commands (Post-Start Initialization)

## Overview

Add support for executing Minecraft server commands automatically after the server has fully started. This replaces the datapack approach for gamerules and provides a reliable mechanism for running initialization commands like `gamerule keepInventory true`, `lp import`, `aach board init`, and other post-start setup tasks.

## Current State

- `GenerateProfile.tsx` allows configuring `server.properties` and `paper-global.yml`
- Gamerules can be configured in the UI but were attempted via datapacks (unreliable)
- No mechanism to run post-start initialization commands
- Commands must be executed manually via console after server starts
- Server logs are captured and can be monitored for readiness signals

## Enhancement

### Init Commands System

1. **Command Types:**
   - **Gamerules:** Common gamerules like `keepInventory`, `doMobSpawning`, etc.
   - **Plugin Commands:** Plugin-specific init commands (e.g., `lp import`, `aach board init`)
   - **Custom Commands:** Arbitrary Minecraft commands for future extensibility

2. **Profile Storage:**
   - Add `initCommands` section to profile YAML structure
   - Store as array of command objects with optional metadata
   - Separate from `configs` and `gamerules` (these are runtime commands, not static config)
   - Merge `initCommands` from profile overlays (like plugins/configs) - base profile has common commands, overlays can add environment-specific ones

3. **Execution Timing:**
   - Check marker file first (before monitoring logs)
   - If marker exists and buildId matches current build → skip execution
   - If marker missing or buildId differs → monitor server logs for "Done (X.XXXs)! For help, type "help"" message
   - Execute commands immediately after server is fully ready
   - Run once per build using marker file mechanism

4. **Marker File System:**
   - Write `.initialized` marker file in workspace after all commands succeed
   - Check marker file before executing commands
   - Compare marker's `buildId` with current build's `buildId`
   - Skip execution if marker exists and buildId matches (prevents re-running on server restart)
   - Execute if marker missing or buildId differs (new build may have different commands)
   - Option to force re-execution (clear marker via UI)

### Profile Schema

Add to `profiles/base.yml`:
```yaml
initCommands:
  - type: "gamerule"
    command: "gamerule keepInventory true"
  - type: "plugin"
    command: "lp import"
    plugin: "luckperms"
  - type: "plugin"
    command: "aach board init"
    plugin: "advancedachievements"
  - type: "custom"
    command: "say Server initialized!"
    description: "Custom welcome message"
```

**Alternative simpler format:**
```yaml
initCommands:
  - "gamerule keepInventory true"
  - "lp import"
  - "aach board init"
```

### Execution Flow

1. Server starts → logs captured via stdout/stderr
2. Check for marker file: `workspace/.initialized`
3. If marker exists and `buildId` matches current build → skip execution
4. If marker missing or `buildId` differs → monitor logs for pattern: `Done (X.XXXs)! For help, type "help"`
5. When "Done" message detected → execute all init commands sequentially
6. If all commands succeed → write marker file with current `buildId`
7. If any command fails → do not write marker file (will retry on next start)
8. Log execution results

### Marker File

**Location:** `workspace/.initialized`

**Format:** JSON file containing:
```json
{
  "initializedAt": "2026-01-27T05:36:17.000Z",
  "commands": [
    "gamerule keepInventory true",
    "lp import",
    "aach board init"
  ],
  "projectId": "teledosi",
  "buildId": "2026-01-27T05-35-32Z"
}
```

**Purpose:**
- Prevents re-execution on server restart
- Tracks which commands were executed
- Allows verification of initialization status
- Can be cleared to force re-execution

## Implementation

### 1. Frontend Changes

**ProjectDetail.tsx:**
- Add new "Start Commands" tab between "Config Files" and "Builds" tabs
- UI for common gamerules (keepInventory toggle, etc.)
- UI for plugin commands (lp import, aach board init checkboxes)
- UI for custom commands (text input for arbitrary commands)
- Extract init commands from existing profile on load (merge from base profile and overlays)
- Include init commands in profile save operation
- Display marker file status (initialized at, buildId, commands executed)
- Button to clear marker file (force re-execution on next run)

**UI Layout:**
- **Gamerules subsection:**
  - Toggle for "Keep Inventory"
  - Future: Additional common gamerules
- **Plugin Commands subsection:**
  - Checkbox for "LuckPerms: Import permissions" (`lp import`)
  - Checkbox for "AdvancedAchievements: Initialize board" (`aach board init`)
  - Future: Additional plugin commands based on installed plugins
- **Custom Commands subsection:**
  - Text input for custom command
  - Add/remove buttons for multiple custom commands
  - Description field for each command
- **Status section:**
  - Show if workspace is initialized (read marker file)
  - Display initialization timestamp and buildId
  - Button to clear marker (force re-execution)

### 2. Backend Changes

**Profile Parsing:**
- Update profile extraction logic to read `initCommands` section
- Merge `initCommands` from base profile and overlays (like plugins/configs)
- Handle missing initCommands section gracefully (default to empty array)
- Support both simple string array and object array formats

**Run Queue (`runQueue.ts`):**
- Check marker file first (before monitoring logs)
- Compare marker's `buildId` with current job's `buildId`
- If marker exists and buildId matches → skip execution
- If marker missing or buildId differs → add log monitoring for "Done" message pattern
- Add `executeInitCommands()` function
- Execute commands sequentially via `sendRunCommand()` (fire-and-forget)
- Write marker file only if all commands succeed
- Handle command execution errors gracefully (continue with remaining commands, but don't write marker)

**Init Commands Service:**
- Create `services/initCommands.ts`
- Function: `shouldExecuteInitCommands(workspacePath: string, currentBuildId: string): boolean` - checks marker and compares buildId
- Function: `getInitCommands(profile: ProfileDocument, overlays: ProfileDocument[]): string[]` - merges from base and overlays
- Function: `markAsInitialized(workspacePath: string, commands: string[], projectId: string, buildId: string): Promise<void>`
- Function: `clearInitializationMarker(workspacePath: string): Promise<void>`
- Function: `readInitializationMarker(workspacePath: string): Promise<InitializationMarker | null>`

**Log Monitoring:**
- Only start monitoring if marker check indicates execution is needed
- Monitor stdout logs in `appendLog()` or separate listener
- Detect "Done" pattern: `/Done \(\d+\.\d+s\)! For help, type "help"/`
- Trigger init command execution when pattern matches
- Ensure commands only execute once per server start (via marker check)

### 3. Type Definitions

**Backend Types:**
```typescript
interface InitCommand {
  type?: "gamerule" | "plugin" | "custom"
  command: string
  plugin?: string
  description?: string
}

interface ProfileDocument {
  // ... existing fields
  initCommands?: string[] | InitCommand[]
}

interface InitializationMarker {
  initializedAt: string
  commands: string[]
  projectId: string
  buildId: string
}
```

**Frontend Types:**
```typescript
interface InitCommandsFields {
  gamerules: {
    keepInventory: boolean
    // Future: additional gamerules
  }
  pluginCommands: {
    luckpermsImport: boolean
    advancedAchievementsBoardInit: boolean
    // Future: additional plugin commands
  }
  customCommands: Array<{
    command: string
    description?: string
  }>
}
```

### 4. Command Execution

**Execution Method:**
- Use existing `sendRunCommand()` function via stdin
- Fire-and-forget approach: send command, wait delay, send next command
- Commands sent sequentially with small delays between commands (100-500ms)
- Log each command execution (sent status, not waiting for response)
- No waiting for command completion/acknowledgment

**Error Handling:**
- If a command fails (detected via log monitoring), log error but continue with remaining commands
- Only write marker file if all commands succeed
- If any command fails, marker file is not written (will retry on next start)
- Provide UI feedback about execution status

**Timing:**
- Execute immediately after "Done" message detected
- Small delay (100-500ms) between commands to avoid overwhelming server
- Fine-tune delays if necessary based on testing

## Workflow

1. User opens ProjectDetail page → "Start Commands" tab
2. Configures init commands (gamerules, plugin commands, custom commands)
3. Saves profile → init commands stored in `profiles/base.yml` (and overlays if applicable)
4. User builds project
5. User starts server run
6. Server starts → check marker file first
7. If marker exists and buildId matches → skip execution
8. If marker missing or buildId differs → monitor logs for "Done" message
9. "Done" message detected → execute all init commands sequentially
10. If all commands succeed → write marker file with current buildId
11. If any command fails → do not write marker (will retry on next start)
12. Subsequent server starts with same buildId skip execution (marker exists)
13. New build deployed → marker buildId differs → commands execute again

## Benefits

- **Reliable timing:** Commands execute only after server is fully ready
- **No datapack hacks:** Direct command execution, no timing workarounds
- **Works for existing worlds:** Marker file ensures commands run once per world
- **Extensible:** Easy to add new command types (gamerules, plugins, custom)
- **Version controlled:** Commands stored in profile, tracked in Git
- **Transparent:** Execution logged and visible to user
- **Flexible:** Supports any Minecraft command, not just gamerules

## Edge Cases

- **Server restart (same build):** Marker file with matching buildId prevents re-execution (by design)
- **New build deployed:** Marker buildId differs → commands execute again (may have changed)
- **Force re-execution:** UI button in Start Commands tab to clear marker and re-run
- **Command failures:** Continue with remaining commands, log failures, but don't write marker (will retry)
- **Server crashes before marker:** Commands will re-execute on next start (acceptable)
- **Multiple worlds:** Each world workspace gets its own marker file
- **Profile overlays:** Init commands merged from base profile and overlays (dev/live can have different commands)
- **RCON unavailable:** Falls back gracefully (commands sent via stdin work without RCON)

## Future Enhancements

- **Command validation:** Validate commands before execution (syntax checking)
- **Conditional execution:** Only run commands if certain conditions are met
- **Command dependencies:** Run commands in specific order or wait for prerequisites
- **Execution history:** Track execution history in marker file (when, which commands, results)
- **UI for execution status:** Show which commands were executed and when
- **Template commands:** Pre-defined command templates for common plugins
- **Command scheduling:** Run commands at specific times or intervals (beyond init)

## Migration from Datapack Approach

- Remove datapack generation code (`datapackGenerator.ts`) if it exists
- Convert existing gamerules in profiles to init commands format
- Update spec documentation to reflect new approach

## Priority

**High** - Replaces unreliable datapack approach with robust, extensible solution. Needed for keepInventory, LuckPerms import, AdvancedAchievements board init, and future command requirements.
