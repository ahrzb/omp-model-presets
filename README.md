# OMP Model Presets

Switch every [Oh My Pi](https://github.com/can1357/oh-my-pi) model role at once with a slash command. Presets are yours: the plugin ships none and never rewrites the ones you define.

## Install

```sh
omp plugin install @ahrzb/omp-model-presets
```

Restart OMP, then capture your current roles as a preset and switch between them for the current session (the default), globally, or for the current project:

```text
/preset new work
/preset work
/preset review --scope project
/preset work --scope session
```

## Commands

| Command | Description |
| --- | --- |
| `/preset <name> [--scope global\|project\|session]` | Apply a preset at the selected scope. The default scope is `session`. |
| `/preset default [--scope global\|project\|session]` | Clear the selected scope so the next lower-precedence OMP configuration applies. |
| `/preset current` | Show active presets by scope and the effective preset. |
| `/preset list` | List available presets. |
| `/preset new <name> [--scope global\|project\|session]` | Create a preset from the effective `modelRoles` mapping and select it at that scope. |
| `/preset delete <name>` | Delete a preset definition (alias: `/preset rm <name>`). Applied roles are left in place; only the definition and any active-selection markers pointing at it are removed. |

Typing `/preset ` completes your preset names, actions, `--scope`, and scope values. The editor also shows contextual inline usage hints as you type.

## Scopes

Scopes follow OMP's normal precedence:

```text
session > project > global > OMP defaults
```

| Scope | Behavior |
| --- | --- |
| `global` | Persists `modelRoles` in the active OMP profile's `config.yml` and applies everywhere without a higher-precedence override. |
| `project` | Persists `modelRoles` in `<cwd>/.omp/config.yml`. It affects OMP sessions started in that exact working directory. |
| `session` | Stores an in-memory role override and a marker in the OMP session transcript. It follows a persisted session across reload/resume, does not modify global or project configuration, and is the default when `--scope` is omitted. |

Setting or clearing one scope does not delete another scope. For example, a session preset continues to take precedence if you change the global preset underneath it.

## Presets

The plugin starts empty. Configure the roles you want through OMP's normal model settings, then capture them:

```text
/preset new work
/preset new review --scope project
/preset new experiment --scope session
```

The new preset becomes active at the requested scope. Preset definitions are snapshots: changing OMP's live model settings after applying one does not modify `model-presets.json`. To replace a preset, delete it and create it again from the roles you want to capture.

No preset definitions are bundled, so upgrading the plugin never changes, overwrites, or conflicts with your roles, and never pins a model id that the providers have since retired.

### File location

Preset definitions are shared across scopes and live in one `model-presets.json` file in the active OMP agent directory:

- Windows: `%USERPROFILE%\.omp\agent\model-presets.json`
- macOS and Linux: `~/.omp/agent/model-presets.json`
- Named profiles: `~/.omp/profiles/<profile>/agent/model-presets.json`

`PI_CODING_AGENT_DIR` is also honored. The authoritative location for the active profile is:

```sh
omp config path
```

Append `model-presets.json` to that path. The file contains one top-level JSON property per preset. You can place an existing preset file there or let `/preset new <name>` create it.

The active global preset is tracked beside it in `model-presets.active`. The active project preset is tracked in `<cwd>/.omp/model-presets.active`. Session state is recorded in the OMP session transcript rather than a separate file.

Model strings use OMP's `provider/model:thinking-level` format. Preset names may contain lowercase letters, numbers, `.`, `_`, and `-`; `default`, `list`, `current`, `new`, `delete`, and `rm` are reserved.

## Returning to your base config

Switching presets is meant to feel like pointing at a different config file, so `/preset default` restores the configuration you had before you first applied a preset — not an empty mapping.

```text
/preset default
/preset default --scope project
/preset default --scope session
```

The first time a preset is applied to the global or project scope, the plugin snapshots that scope's existing `modelRoles` (a `model-presets.base.json` sidecar; the session scope keeps its snapshot in the transcript). `/preset default` writes that snapshot back, re-points the live model at the restored `default` role, and removes the snapshot — so the scope is exactly as it was before presets. If the scope had no roles to begin with, `default` clears it. Preset definitions are never changed or deleted by restoring a scope.

## What it changes

The plugin replaces the complete `modelRoles` mapping at the selected scope, including `default`, `slow`, `smol`, `plan`, `advisor`, `task`, `designer`, `vision`, `commit`, `tiny`, and `spark`.

Before applying a preset, it verifies that every model resolves in OMP. When the selected scope becomes effective, it switches the active model immediately and reloads OMP so agents and role-based tasks use the selected provider.

Your provider credentials and access to the configured models must already be available in OMP.

## Development

Link a local checkout into OMP:

```sh
omp plugin link . --scope user
```

Validate the installed plugin:

```sh
omp plugin doctor @ahrzb/omp-model-presets --json
```

## Releases

Every push and pull request to `main` runs the Node.js test suite and checks the npm package contents.

To publish, update `package.json` to the next version, commit it, then push the matching tag:

```sh
version=$(node -p "require('./package.json').version")
git tag "v$version"
git push origin "v$version"
```

The tag workflow rejects mismatched versions and publishes the package to npm with provenance.

## License

[MIT](LICENSE)
