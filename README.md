# OMP Model Presets

Switch every [Oh My Pi](https://github.com/can1357/oh-my-pi) model role between complete OpenAI Codex and Anthropic Claude presets with one slash command.

## Install

```sh
omp plugin install @ahrzb/omp-model-presets
```

Restart OMP, then choose a preset:

```text
/preset openai
/preset anthropic
```

## Commands

| Command | Description |
| --- | --- |
| `/preset openai` | Assign every OMP model role to the OpenAI Codex preset. |
| `/preset anthropic` | Assign every OMP model role to the Anthropic Claude preset. |
| `/preset default` | Restore OMP's system-default `modelRoles` instead of using a named preset. |
| `/preset current` | Show the matching preset, or `custom` when roles differ. |
| `/preset list` | List available presets. |
| `/preset new <name>` | Create and select a preset from the current complete `modelRoles` mapping. |

## Custom presets

Create a preset from the roles currently stored by OMP:

```text
/preset new work
```

The new preset becomes active. Continue changing roles through OMP's normal settings UI; those changes remain persisted in OMP's `config.yml`. Before you switch to another preset, create another preset, or run `/preset default`, the plugin copies the current `modelRoles` back into the active preset automatically.

This also makes the built-in presets customizable. Select `openai`, change its roles in OMP settings, then switch away. The modified roles are stored as a custom `openai` override. To restore the shipped `openai` preset, switch away from it and delete its entry from `model-presets.json`.

### File location

All file-backed presets live in one `model-presets.json` file in the active OMP agent directory:

- Windows: `%USERPROFILE%\.omp\agent\model-presets.json`
- macOS and Linux: `~/.omp/agent/model-presets.json`
- Named profiles: `~/.omp/profiles/<profile>/agent/model-presets.json`

`PI_CODING_AGENT_DIR` is also honored. The authoritative location for the active profile is:

```sh
omp config path
```

Append `model-presets.json` to that path. The file contains one top-level JSON property per preset. You can place an existing preset file there or let `/preset new <name>` create it.

Model strings use OMP's `provider/model:thinking-level` format. Custom presets override built-ins with the same name. Preset names may contain lowercase letters, numbers, `.`, `_`, and `-`; `default`, `list`, `current`, and `new` are reserved.

## OMP system defaults

Use OMP's own system role mapping instead of any named preset:

```text
/preset default
```

The plugin first saves any pending settings changes to the active preset, then runs `omp config reset modelRoles` and reloads the session so subsequent role resolution uses OMP's system defaults. It does not delete your custom preset file. Project settings and command-line configuration overlays still take precedence according to OMP's normal configuration rules.

## What it changes

The plugin replaces the complete persistent `modelRoles` mapping, including `default`, `slow`, `smol`, `plan`, `advisor`, `task`, `designer`, `vision`, `commit`, `tiny`, and `spark`.

Before writing the configuration, it verifies that every preset model resolves in OMP. It then switches the active model immediately and reloads OMP so agents and role-based tasks use the selected provider.

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
