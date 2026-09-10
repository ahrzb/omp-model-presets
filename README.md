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

## License

[MIT](LICENSE)
