# Default Server Template

This scaffold seeds new Minecraft server projects with a sensible Paper setup.  
It mirrors the structure described in the spec so generated repos start with:

- `profiles/base.yml` – the main definition of the server build.
- `overlays/` – dev/live overrides to illustrate environment-specific tweaks.
- `plugins/registry.yml` – placeholder registry entry for managed plugin sources.
- `assets/` and `configs/` – empty directories (tracked with `.gitkeep`) ready for uploads.

Update the template as new defaults emerge (e.g., additional overlays or registry presets).

