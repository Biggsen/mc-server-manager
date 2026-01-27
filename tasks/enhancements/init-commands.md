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

3. **Execution Timing:**
   - Monitor server logs for "Done (X.XXXs)! For help, type "help"" message
   - Execute commands immediately after server is fully ready
   - Run once per world using marker file mechanism

4. **Marker File System:**
   - Write `.initialized` marker file in workspace after successful execution
   - Check marker file before executing commands
   - Skip execution if marker exists (prevents re-running on server restart)
   - Option to force re-execution (clear marker)

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
2. Monitor logs for pattern: `Done (X.XXXs)! For help, type "help"`
3. Check for marker file: `workspace/.initialized`
4. If marker exists → skip execution
5. If marker missing → execute all init commands sequentially
6. After successful execution → write marker file
7. Log execution results

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

**GenerateProfile.tsx:**
- Add "Init Commands" section (separate from Server Properties and Gamerules)
- UI for common gamerules (keepInventory toggle, etc.)
- UI for plugin commands (lp import, aach board init checkboxes)
- UI for custom commands (text input for arbitrary commands)
- Extract init commands from existing profile on load
- Include init commands in `buildProfileDocument` output

**UI Layout:**
- Place "Init Commands" card after "Gamerules" section
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

### 2. Backend Changes

**Profile Parsing:**
- Update profile extraction logic to read `initCommands` section
- Handle missing initCommands section gracefully (default to empty array)
- Support both simple string array and object array formats

**Run Queue (`runQueue.ts`):**
- Add log monitoring for "Done" message pattern
- Add `executeInitCommands()` function
- Check marker file before execution
- Execute commands sequentially via `sendRunCommand()`
- Write marker file after successful execution
- Handle command execution errors gracefully

**Init Commands Service:**
- Create `services/initCommands.ts`
- Function: `shouldExecuteInitCommands(workspacePath: string, projectId: string, buildId: string): boolean`
- Function: `getInitCommands(profile: ProfileDocument): string[]`
- Function: `markAsInitialized(workspacePath: string, commands: string[], projectId: string, buildId: string): Promise<void>`
- Function: `clearInitializationMarker(workspacePath: string): Promise<void>`

**Log Monitoring:**
- Monitor stdout logs in `appendLog()` or separate listener
- Detect "Done" pattern: `/Done \(\d+\.\d+s\)! For help, type "help"/`
- Trigger init command execution when pattern matches
- Ensure commands only execute once per server start

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
- Commands sent sequentially with small delays between commands
- Wait for command completion (optional - may not be necessary for most commands)
- Log each command execution with success/failure status

**Error Handling:**
- If a command fails, log error but continue with remaining commands
- Track which commands succeeded/failed in marker file
- Provide UI feedback about execution status

**Timing:**
- Execute immediately after "Done" message detected
- Small delay (100-500ms) between commands to avoid overwhelming server
- Timeout protection (don't wait indefinitely for command responses)

## Workflow

1. User opens Generate Profile page
2. Configures init commands (gamerules, plugin commands, custom commands)
3. Saves profile → init commands stored in `profiles/base.yml`
4. User builds project
5. User starts server run
6. Server starts → logs monitored
7. "Done" message detected → check marker file
8. If marker missing → execute all init commands
9. Write marker file after successful execution
10. Subsequent server starts skip execution (marker exists)

## Benefits

- **Reliable timing:** Commands execute only after server is fully ready
- **No datapack hacks:** Direct command execution, no timing workarounds
- **Works for existing worlds:** Marker file ensures commands run once per world
- **Extensible:** Easy to add new command types (gamerules, plugins, custom)
- **Version controlled:** Commands stored in profile, tracked in Git
- **Transparent:** Execution logged and visible to user
- **Flexible:** Supports any Minecraft command, not just gamerules

## Edge Cases

- **Server restart:** Marker file prevents re-execution (by design)
- **Force re-execution:** Provide UI option to clear marker and re-run
- **Command failures:** Continue with remaining commands, log failures
- **Server crashes before marker:** Commands will re-execute on next start (acceptable)
- **Multiple worlds:** Each world workspace gets its own marker file
- **Build updates:** Marker tied to buildId - new builds can re-execute if needed
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

- Remove datapack generation code (`datapackGenerator.ts`)
- Update `GenerateProfile.tsx` to use init commands instead of gamerules array
- Convert existing gamerules in profiles to init commands format
- Update spec documentation to reflect new approach

## Priority

**High** - Replaces unreliable datapack approach with robust, extensible solution. Needed for keepInventory, LuckPerms import, AdvancedAchievements board init, and future command requirements.
