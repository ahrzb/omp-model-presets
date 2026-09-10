# OMP Model Presets

Switch every [Oh My Pi](https://github.com/can1357/oh-my-pi) model role between complete OpenAI Codex and Anthropic Claude presets with one slash command.

## Install

```sh
omp plugin install @ahrzb/omp-model-presets
```

Restart OMP, then choose a preset globally (the backward-compatible default), for the current project, or only for the current session:

```text
/preset openai
/preset anthropic --scope project
/preset openai --scope session
```

## Commands

| Command | Description |
| --- | --- |
| `/preset <name> [--scope global\|project\|session]` | Apply a preset at the selected scope. The default scope is `global`. |
| `/preset default [--scope global\|project\|session]` | Clear the selected scope so the next lower-precedence OMP configuration applies. |
| `/preset current` | Show active presets by scope and the effective preset. |
| `/preset list` | List available presets. |
| `/preset new <name> [--scope global\|project\|session]` | Create a preset from the effective `modelRoles` mapping and select it at that scope. |

Typing `/preset ` now completes built-in and custom preset names, actions, `--scope`, and scope values. The editor also shows contextual inline usage hints as you type.

Built-in presets: `anthropic`, `openai`, and `mix` (Claude for the main session and planning, Codex for `slow`/`task`, Fable as the advisor).

## Scopes

Scopes follow OMP's normal precedence:

```text
session > project > global > OMP defaults
```

| Scope | Behavior |
| --- | --- |
| `global` | Persists `modelRoles` in the active OMP profile's `config.yml` and applies everywhere without a higher-precedence override. This remains the default when `--scope` is omitted. |
| `project` | Persists `modelRoles` in `<cwd>/.omp/config.yml`. It affects OMP sessions started in that exact working directory. |
| `session` | Stores an in-memory role override and a marker in the OMP session transcript. It follows a persisted session across reload/resume but does not modify global or project configuration. |

Setting or clearing one scope does not delete another scope. For example, a session preset continues to take precedence if you change the global preset underneath it.

## Custom presets

Create and select a preset from the effective roles currently used by OMP:

```text
/preset new work
/preset new review --scope project
/preset new experiment --scope session
```

The new preset becomes active at the requested scope. Continue changing roles through OMP's normal model settings; before you switch to another preset, create another preset, or clear a scope with `/preset default`, the plugin copies the current roles from the effective active scope back into that preset automatically.

This also makes the built-in presets customizable. Select `openai`, change its roles in OMP settings, then switch away. The modified roles are stored as a custom `openai` override. To restore the shipped `openai` preset, switch away from it and delete its entry from `model-presets.json`.

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

Model strings use OMP's `provider/model:thinking-level` format. Custom presets override built-ins with the same name. Preset names may contain lowercase letters, numbers, `.`, `_`, and `-`; `default`, `list`, `current`, and `new` are reserved.

## OMP system defaults

Clear a scope with the same `--scope` syntax:

```text
/preset default
/preset default --scope project
/preset default --scope session
```

The plugin first saves pending settings changes to the effective active preset. Global default writes an empty global `modelRoles` mapping, project default clears project role overrides so global roles apply, and session default removes the session override so project or global roles apply. Preset definitions are not deleted.

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
