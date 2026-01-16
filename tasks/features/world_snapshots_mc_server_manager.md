# World Snapshots – MC Server Manager

## Overview
Introduce **World Snapshots** as a first-class artifact in MC Server Manager.

A World Snapshot is an **immutable, versioned export of Minecraft world folders**, captured from a stopped Docker-based server and reused when creating new servers. Snapshots operate entirely on **host-mounted data**, not running containers.

---

## Key Principle (Docker)
- Containers are **ephemeral**
- World data must live on **persistent host storage**
- Snapshot export/import works on the **host filesystem**
- Containers do **not** need to be running

Stopping a server means stopping the container. World data remains available via bind mounts.

---

## Required Server Storage Model

Each server must have a host directory that contains world data.

```
servers/
└─ <serverId>/
   └─ data/
      ├─ world/
      ├─ world_nether/
      ├─ world_the_end/
      ├─ server.properties
      └─ ...
```

Docker container mounts:
- Host: `servers/<serverId>/data`
- Container: `/data` (or equivalent)

---

## World Snapshot Structure

```
world-snapshots/
└─ teledosi-v1/
   ├─ world/
   ├─ world_nether/        (optional)
   ├─ world_the_end/       (optional)
   └─ manifest.json
```

---

## Snapshot Manifest

```ts
WorldSnapshot {
  id: string                // "teledosi-v1"
  name: string
  sourceServerId: string
  minecraftVersion: string
  createdAt: string
  includes: string[]        // ["world", "world_nether", "world_the_end"]
  notes?: string
}
```

---

## Server Model Addition

```ts
Server {
  worldSource: {
    type: "generate" | "snapshot"
    snapshotId?: string
  }
}
```

---

## Export World Snapshot

### Preconditions
- Source server container must be **stopped**
- World data must be stored in a bind-mounted host directory

### Process
1. Stop container
2. Copy world folders from host:
   - `servers/<serverId>/data/world`
   - optional nether/end
3. Write `manifest.json`
4. Snapshot becomes **immutable**

### Safety
- Copy into a temporary directory first
- Rename atomically on success

---

## Import World Snapshot

Occurs during **server creation**.

1. Create server directory
2. Copy snapshot world folders into `servers/<newServerId>/data`
3. Set `level-name=world`
4. Skip world generation
5. Start container

Import is only allowed **before first boot**.

---

## Guardrails
- Snapshots are read-only and versioned
- No exporting from running containers
- No importing over existing worlds
- Template servers are not intended for live play
- Terrain changes require a new snapshot version

---

## Benefits
- Deterministic server spin-up
- No schematic or startup automation
- Docker-safe and filesystem-driven
- Aligns with config-as-artifact architecture

---

## Implementation Note
Prefer **bind mounts** for world data. Named Docker volumes complicate snapshotting and should be avoided unless explicitly required.

