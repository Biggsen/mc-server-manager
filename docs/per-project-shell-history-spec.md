# Per-Project Shell History – Specification

## Overview

**Goal:** Isolate shell history per project so that pressing Up in the terminal cycles only through commands used in the current project, instead of commands from all projects and sessions.

**Platform:** Windows with WSL. Shell: zsh (recommended for cleaner hooks and history control).

**Scope:** Affects only interactive shell history. No impact on Cursor agent, git, Docker, builds, or automated tooling.

---

## Requirements

### Functional
1. When the user `cd`s into a project directory, the shell must switch to that project's history file.
2. Up/Down arrow keys must cycle only through commands from the current project's history.
3. History must persist across terminal sessions for each project.
4. Multiple terminals open in the same project must append to the same history (no clobbering).

### Non-Functional
1. Setup should be reproducible and version-controllable per project.
2. Minimal friction: one-time setup per project, transparent thereafter.
3. Graceful when outside a project: fall back to default/global history.

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│ WSL (Ubuntu or similar)                                 │
│  ┌───────────────────────────────────────────────────┐ │
│  │ zsh + direnv                                       │ │
│  │  • direnv: loads .envrc when entering project dir  │ │
│  │  • precmd (after direnv): flush/clear/reload hist  │ │
│  └───────────────────────────────────────────────────┘ │
│                         │                               │
│                         ▼                               │
│  ┌───────────────────────────────────────────────────┐ │
│  │ Project directory (e.g. mc-server-manager/)       │ │
│  │  • .envrc  → export HISTFILE="$PWD/.history"       │ │
│  │  • .history → project-specific command history     │ │
│  │  • .gitignore → contains .history                  │ │
│  └───────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────┘
```

---

## Prerequisites

1. **WSL** – `wsl --install` if not present; restart if needed.
2. **zsh** – `sudo apt install zsh`; set as default: `chsh -s $(which zsh)`.
3. **direnv** – `sudo apt install direnv` (or build from source).

---

## Implementation

### 1. Shell configuration (~/.zshrc)

**direnv hook:**
```bash
eval "$(direnv hook zsh)"
```

**Append mode (prevent history clobbering with multiple shells):**
```bash
setopt APPEND_HISTORY
```

**History swap hook – per-directory history:**

The critical sequence: `HISTFILE` alone is not enough. Must flush, clear, and reload:

| Step | zsh | bash | Purpose |
|------|-----|------|---------|
| 1 | `fc -W` | `history -a` | Write current history to file |
| 2 | (implicit in reload) | `history -c` | Clear in-memory buffer |
| 3 | `fc -R` | `history -r` | Load from new HISTFILE |

**Hook ordering:** direnv runs at prompt time (via its hook in precmd); `chpwd` runs immediately after `cd`. So on `cd`, `chpwd` runs *before* direnv has set the new `HISTFILE`. Therefore the history swap must run in **precmd** (or equivalent), *after* direnv. Ensure direnv's hook runs first in precmd, then your swap logic.

**Logic:**
1. Track the last `HISTFILE` we used (e.g. in a variable).
2. In precmd (after direnv): if `HISTFILE` differs from last, run flush → clear → reload, then update the tracked value.
3. On first load, treat "no previous" as "use current HISTFILE as-is, just load it".

### 2. Per-project setup

**Create `.envrc` in project root:**
```bash
export HISTFILE="$PWD/.history"
```

**Add to `.gitignore`:**
```
.history
```

**First-time allowance:**
```bash
direnv allow
```

---

## Edge Cases

| Case | Behavior |
|------|----------|
| `cd` into project | direnv loads, sets `HISTFILE`; `chpwd` flushes old, loads `.history`. |
| `cd` out of project | direnv unloads; `HISTFILE` reverts to default. `chpwd` flushes project history, loads default. |
| New project, no `.history` yet | First commands create it; empty history on first enter is fine. |
| Multiple terminals in same project | `APPEND_HISTORY` ensures all append; no overwrite. |
| `.envrc` not allowed | direnv shows prompt; `HISTFILE` not set; no project history (use default). |
| Nested projects (project inside project) | Innermost project wins (direnv uses nearest `.envrc`). |

---

## Out of Scope

- Cursor agent: runs discrete commands; does not use shell history.
- PowerShell: this spec targets WSL + zsh. PowerShell alternative would require different approach.
- History search (Ctrl+R): works as normal within current project's history.
- Cross-project sharing: no mechanism to merge or search across projects.

---

## Verification

1. `cd` into project → run `echo $HISTFILE` → should show `.../project/.history`.
2. Run a few commands; close terminal; reopen; `cd` into project → Up should show those commands.
3. Open two terminals in same project; run different commands in each; both should appear when pressing Up in either terminal (after both have appended).
4. `cd` to `~` or other non-project dir → Up should show global/default history, not project commands.

---

## Estimated Setup Time

| Task | Time |
|------|------|
| WSL install (if needed) | 10–15 min |
| zsh + direnv install | ~5 min |
| Shell config (chpwd, hooks) | 10–15 min |
| Per-project (.envrc, .gitignore) | ~2 min |
| **Total** | **15–30 min** (WSL already present) |

---

## References

- direnv: https://direnv.net/
- zsh chpwd hook: `man zshmisc` → "Hook Functions"
- zsh history options: `man zshoptions` → APPEND_HISTORY, etc.
