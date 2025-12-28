# **Overlays Specification – MC Server Manager**

## Overview

Overlays allow environment-specific configuration variations (dev, live, staging) without duplicating entire config files. Each overlay modifies the base profile by adding or overriding specific settings.

## File Structure

Overlays are YAML files stored in the `overlays/` directory of each project:

```
project-root/
  profiles/
    base.yml          # Base configuration
  overlays/
    dev.yml           # Development environment overlay
    live.yml          # Production environment overlay
    staging.yml       # Staging environment overlay (optional)
```

## Merge / Override Rules

### Order of Application

When building with an overlay, settings are applied in this order:

1. `copyTrees` (if defined)
2. Rendered templates (from base profile and overlay)
3. Base profile `overrides`
4. Overlay `overrides` (wins over base)

### Merge Rules

**YAML/JSON files:**
- Deep merge by key
- Nested objects are merged recursively
- Leaf values are replaced by overlay

**Arrays:**
- Full replace by default (overlay array replaces base array)
- Can be controlled via `mergePolicy.arrays`:
  - `replace` (default) - overlay array completely replaces base
  - `append` - overlay array items are appended to base array
  - `uniqueAppend` - overlay array items are appended, duplicates removed

**`.properties` files:**
- Key-by-key replacement
- Each property is treated independently

### Path Syntax

Overrides use `:` to separate file path from key path:

- **Properties files:** `server.properties:max-players`
- **YAML files:** `paper-global.yml:chunk-system.target-tick-distance`
- **Nested YAML:** Use dot notation for nested keys

## Override Structure

Each override entry has:
- `path`: File path and key (using `:` separator)
- `value`: The value to set (can be string, number, boolean, or object)

```yaml
overrides:
  - path: "server.properties:max-players"
    value: 60
  - path: "paper-global.yml:chunk-system.target-tick-distance"
    value: 6
  - path: "config/plugin.yml:settings.debug"
    value: true
```

## Examples

### Example 1: Basic Override

**Base profile (`profiles/base.yml`):**
```yaml
configs:
  files:
    - template: server.properties.hbs
      output: server.properties
      data:
        motd: "Charidh Dev"
        maxPlayers: 20
overrides:
  - path: "server.properties:view-distance"
    value: 16
```

**Live overlay (`overlays/live.yml`):**
```yaml
overrides:
  - path: "server.properties:max-players"
    value: 60
  - path: "paper-global.yml:chunk-system.target-tick-distance"
    value: 6
```

**Result when building with `live` overlay:**
- `max-players` = 60 (overlay wins)
- `view-distance` = 16 (base kept, not overridden)
- `chunk-system.target-tick-distance` = 6 (overlay adds new override)

### Example 2: Template Override in Overlay

**Dev overlay (`overlays/dev.yml`):**
```yaml
configs:
  files:
    - template: server.properties.hbs
      output: server.properties
      data:
        motd: "[DEV] Charidh"
        maxPlayers: 10
overrides:
  - path: "server.properties:enforce-secure-profile"
    value: "false"
```

**Live overlay (`overlays/live.yml`):**
```yaml
overrides:
  - path: "server.properties:max-players"
    value: 60
  - path: "server.properties:online-mode"
    value: "true"
mergePolicy:
  arrays: "replace"
```

### Example 3: Array Merge Policy

**Base profile:**
```yaml
plugins:
  - id: worldguard
    version: "7.0.10"
  - id: placeholderapi
    version: "2.11.6"
```

**Overlay with append policy:**
```yaml
mergePolicy:
  arrays: "append"
plugins:
  - id: essentials
    version: "2.20.0"
```

**Result (with append):**
```yaml
plugins:
  - id: worldguard
    version: "7.0.10"
  - id: placeholderapi
    version: "2.11.6"
  - id: essentials
    version: "2.20.0"
```

**Result (with replace, default):**
```yaml
plugins:
  - id: essentials
    version: "2.20.0"
```

## Overlay Selection

**Build-time selection:**
- Overlays are selected when initiating a build
- Only one overlay can be active per build
- If no overlay is specified, only the base profile is used

**UI/API:**
- Build interface should allow selecting an overlay (e.g., dropdown: "dev", "live", "none")
- Overlay selection is stored in build metadata

## Implementation Notes

### Current State
- Overlay files are read and parsed
- Plugin and config arrays are merged
- **TODO:** Override application to config files is not yet implemented

### Required Implementation
1. Parse override paths (file:key format)
2. Apply overrides to rendered config files:
   - For `.properties`: Replace key-value pairs
   - For YAML: Deep merge at specified path
3. Respect merge policies for arrays
4. Validate override paths exist in target files

### Error Handling
- Invalid override paths should log warnings but not fail builds
- Missing overlay files should be handled gracefully
- Circular references in overlays should be detected

## Future Enhancements

- Multiple overlay composition (e.g., `dev` + `debug`)
- Overlay inheritance (overlay extends another overlay)
- Conditional overrides based on Minecraft version or loader
- Overlay validation schema

