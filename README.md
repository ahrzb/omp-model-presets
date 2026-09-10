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
| `/preset current` | Show the matching preset, or `custom` when roles differ. |
| `/preset list` | List available presets. |
| `/preset save <name>` | Save the current complete `modelRoles` mapping as a preset. |

## Custom presets

Save the current roles under any lowercase name:

```text
/preset save work
```

The plugin writes custom presets to `model-presets.json` in the active OMP agent directory. Find that directory with:

```sh
omp config path
```

To customize a preset, save a complete working role configuration first, then edit its model strings in `model-presets.json`. Model strings use OMP's `provider/model:thinking-level` format.

Custom presets override built-ins with the same name. For example, after configuring roles manually, this replaces the shipped `openai` preset with your current roles:

```text
/preset save openai
```

Delete the `openai` entry from `model-presets.json` to restore the shipped preset. Preset names may contain lowercase letters, numbers, `.`, `_`, and `-`; `list`, `current`, and `save` are reserved.

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
git tag v0.2.0
git push origin v0.2.0
```

The tag workflow rejects mismatched versions and publishes the package to npm with provenance.

## License

[MIT](LICENSE)
