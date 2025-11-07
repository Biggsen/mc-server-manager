# Default Server Template

This scaffold seeds new Minecraft server projects with a sensible Paper setup.  
It mirrors the structure described in the spec so generated repos start with:

- `profiles/base.yml` – the main definition of the server build.
- `overlays/` – dev/live overrides to illustrate environment-specific tweaks.
- `plugins/registry.yml` – placeholder registry entry for managed plugin sources.
- `configs/*.hbs` – Handlebars templates rendered into concrete config files (e.g. `server.properties`).
- `manifest.template.json` – Starter manifest shape used when packaging a build artifact.
- `assets/` and `configs/` – folders ready for uploads; `.gitkeep` ensures they remain in the repo.

Update the template as new defaults emerge (e.g., additional overlays or registry presets).

