# Changelog

All notable changes to this package are documented here.

## 0.10.0 - 2026-09-17

### Added

- Added stale-module detection. OMP loads an extension once per process, so upgrading this package while OMP is running leaves the old code — and, before 0.9.0, the old preset writer — in control. The plugin now compares the version it was loaded with against the version on disk and, once per process, tells you to restart OMP instead of letting the stale copy keep writing.

## 0.9.0 - 2026-09-17

### Fixed

- Stopped preset switches, creation, and scope resets from writing live role changes back into the previously active preset. Preset definitions now remain snapshots and are written only when explicitly created or deleted.

### Changed

- Changed the default scope from `global` to `session` when `--scope` is omitted, including for applying, creating, and clearing presets.

### Upgrade note

- Version 0.9.0 prevents future implicit writes but cannot infer a preset's original values after an older version has already overwritten them. Repair or recreate any previously affected preset once after upgrading. Then fully restart OMP before using `/preset`; running processes keep the older plugin module loaded, and `/reload` does not replace it.

## 0.8.0 - 2026-09-11

### Fixed

- Changed `/preset default` to restore the exact global, project, or session configuration that existed before the first preset was applied at that scope.
- Restored the active model and thinking level from the recovered `default` role instead of only replacing the role mapping.

## 0.7.0 - 2026-09-11

### Added

- Added `/preset delete <name>` and its `/preset rm <name>` alias.
- Added completions for deleting presets.
- Clearing a selected preset now removes its global, project, and session selection markers without altering already-applied roles.

## 0.6.0 - 2026-09-11

### Changed

- Removed the bundled `openai`, `anthropic`, and `mix` definitions. The plugin now starts empty and uses only user-defined presets captured with `/preset new` or supplied through `model-presets.json`.
- Added guidance when no presets exist, avoiding model IDs bundled by the package becoming stale or conflicting with user configuration.

## 0.5.4 - 2026-09-11

### Added

- Added the bundled `mix` preset, combining Claude for the main, planning, advisor, designer, and vision roles with Codex for slow, small, task, and spark roles.

## 0.5.3 - 2026-09-11

### Changed

- Changed the bundled OpenAI preset's default model from Astra to Sol.
- Updated its planning, designer, small, commit, and tiny role assignments and thinking levels.

## 0.5.2 - 2026-09-11

### Added

- Added command completions for preset names, actions, `--scope`, and scope values.
- Added contextual inline usage hints while typing `/preset` commands.

## 0.5.1 - 2026-09-11

### Fixed

- Isolated session-scoped runtime roles while switching, branching, and resuming sessions so one session's preset does not leak into another.
- Restored the session's pre-preset runtime roles when its preset selection is cleared.

## 0.5.0 - 2026-09-11

### Added

- Added `global`, `project`, and `session` scopes with normal OMP precedence: session over project over global.
- Persisted project selections in the project's `.omp` directory and session selections in the session transcript.
- Expanded `/preset current` to report active selections and the effective scope.

## 0.4.0 - 2026-09-10

### Added

- Added active-preset markers and `/preset new`, replacing `/preset save`.
- Added automatic persistence of live role changes into the active preset before switching or clearing it. This implicit write-back was removed in 0.9.0.

## 0.3.0 - 2026-09-10

### Added

- Added `/preset default` to restore OMP's system `modelRoles` mapping and reload the session.
- Documented preset storage across standard agent directories and named profiles.

## 0.2.0 - 2026-09-10

### Added

- Added custom presets stored in `model-presets.json` through `/preset save <name>`.
- Added preset name and value validation, custom overrides for bundled presets, and npm provenance publishing.

## 0.1.1 - 2026-09-10

### Changed

- Added the README, repository metadata, keywords, author information, and package links for the npm release.

## 0.1.0 - 2026-09-10

### Added

- Initial OMP plugin with bundled OpenAI and Anthropic presets.
- Added `/preset list`, `/preset current`, model resolution checks, immediate default-model switching, and OMP reload after applying a preset.
