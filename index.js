import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

const BUILT_IN_PRESETS = {
  anthropic: {
    default: "anthropic/claude-opus-5:high",
    slow: "anthropic/claude-opus-5:max",
    smol: "anthropic/claude-haiku-4-5:high",
    plan: "anthropic/claude-opus-5:xhigh",
    advisor: "anthropic/claude-opus-5:high",
    task: "anthropic/claude-sonnet-5:high",
    designer: "anthropic/claude-opus-5:high",
    vision: "anthropic/claude-opus-5:medium",
    commit: "anthropic/claude-haiku-4-5:low",
    tiny: "anthropic/claude-haiku-4-5:minimal",
    spark: "anthropic/claude-haiku-4-5:medium",
  },
  openai: {
    default: "openai-codex/gpt-6-astra:high",
    slow: "openai-codex/gpt-6-astra:xhigh",
    smol: "openai-codex/gpt-5.6-luna:high",
    plan: "openai-codex/gpt-5.6-sol:high",
    advisor: "openai-codex/gpt-5.6-sol:high",
    task: "openai-codex/gpt-5.6-terra:high",
    designer: "openai-codex/gpt-6-astra:high",
    vision: "openai-codex/gpt-5.6-sol:medium",
    commit: "openai-codex/gpt-5.6-luna:high",
    tiny: "openai-codex/gpt-5.6-luna:high",
    spark: "openai-codex/gpt-5.3-codex-spark:medium",
  },
};

const THINKING_LEVELS = new Set(["off", "minimal", "low", "medium", "high", "xhigh", "max", "auto"]);

function splitSpec(spec) {
  const colon = spec.lastIndexOf(":");
  const suffix = colon === -1 ? "" : spec.slice(colon + 1);
  return THINKING_LEVELS.has(suffix)
    ? { model: spec.slice(0, colon), thinking: suffix }
    : { model: spec };
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function validatePresetName(name) {
  if (!/^[a-z0-9][a-z0-9._-]*$/.test(name)) {
    throw new Error(`Invalid preset name '${name}'. Use lowercase letters, numbers, '.', '_' or '-'`);
  }
}

function validatePreset(name, preset) {
  validatePresetName(name);
  if (!isRecord(preset) || Object.keys(preset).length === 0) {
    throw new Error(`Preset '${name}' must be a non-empty object`);
  }
  for (const [role, spec] of Object.entries(preset)) {
    if (!role || typeof spec !== "string" || !spec.trim()) {
      throw new Error(`Preset '${name}' has an invalid value for role '${role}'`);
    }
  }
}

function matchingPreset(roles, presets) {
  return Object.entries(presets).find(([, preset]) =>
    Object.keys(preset).length === Object.keys(roles).length
      && Object.entries(preset).every(([role, spec]) => roles[role] === spec),
  )?.[0];
}

async function runOmp(pi, args, cwd, fallback) {
  const result = await pi.exec("omp", args, { cwd });
  if (result.code !== 0) throw new Error(result.stderr.trim() || fallback);
  return result.stdout.trim();
}

async function readConfiguredRoles(pi, cwd) {
  const output = await runOmp(
    pi,
    ["config", "get", "modelRoles", "--json"],
    cwd,
    "Could not read modelRoles",
  );
  const roles = JSON.parse(output).value;
  if (!isRecord(roles)) throw new Error("OMP returned invalid modelRoles");
  return roles;
}

async function presetStorage(pi, cwd) {
  const agentDir = await runOmp(pi, ["config", "path"], cwd, "Could not find the OMP config directory");
  return {
    presetsFile: join(agentDir, "model-presets.json"),
    activeFile: join(agentDir, "model-presets.active"),
  };
}

async function readCustomPresets(file) {
  let presets;
  try {
    presets = JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return {};
    throw new Error(`Could not read ${file}: ${error instanceof Error ? error.message : String(error)}`);
  }

  if (!isRecord(presets)) throw new Error(`${file} must contain a JSON object`);
  for (const [name, preset] of Object.entries(presets)) validatePreset(name, preset);
  return presets;
}

async function writeCustomPresets(file, presets) {
  await writeFile(file, `${JSON.stringify(presets, null, 2)}\n`, "utf8");
}

async function readActivePreset(file) {
  try {
    const name = (await readFile(file, "utf8")).trim();
    if (!name) return undefined;
    validatePresetName(name);
    return name;
  } catch (error) {
    if (error?.code === "ENOENT") return undefined;
    throw new Error(`Could not read ${file}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function setActivePreset(file, name) {
  if (name) await writeFile(file, `${name}\n`, "utf8");
  else await rm(file, { force: true });
}

async function syncActivePreset(pi, cwd, storage) {
  const active = await readActivePreset(storage.activeFile);
  if (!active) return undefined;
  const roles = await readConfiguredRoles(pi, cwd);
  validatePreset(active, roles);
  const custom = await readCustomPresets(storage.presetsFile);
  custom[active] = roles;
  await writeCustomPresets(storage.presetsFile, custom);
  return roles;
}

function availablePresets(custom) {
  return { ...BUILT_IN_PRESETS, ...custom };
}

export default function modelPresets(pi) {
  pi.setLabel("Model Presets");

  pi.registerCommand("preset", {
    description: "Switch, list, inspect, or create complete model-role presets",
    handler: async (args, ctx) => {
      const input = args.trim().toLowerCase();
      const [action, ...rest] = input ? input.split(/\s+/) : ["list"];

      try {
        const storage = await presetStorage(pi, ctx.cwd);

        if (action === "new") {
          const name = rest.join(" ");
          if (!name) throw new Error("Usage: /preset new <name>");
          validatePresetName(name);
          if (["default", "list", "current", "new"].includes(name)) {
            throw new Error(`'${name}' is reserved and cannot be used as a preset name`);
          }

          const roles = await syncActivePreset(pi, ctx.cwd, storage)
            ?? await readConfiguredRoles(pi, ctx.cwd);
          const custom = await readCustomPresets(storage.presetsFile);
          if (Object.hasOwn(availablePresets(custom), name)) {
            throw new Error(`Preset '${name}' already exists`);
          }
          validatePreset(name, roles);
          custom[name] = roles;
          await writeCustomPresets(storage.presetsFile, custom);
          await setActivePreset(storage.activeFile, name);
          ctx.ui.notify(`Preset '${name}' created and selected`, "info");
          return;
        }

        if (action === "default") {
          await syncActivePreset(pi, ctx.cwd, storage);
          await runOmp(
            pi,
            ["config", "reset", "modelRoles"],
            ctx.cwd,
            "Could not restore the default modelRoles",
          );
          await setActivePreset(storage.activeFile);
          ctx.ui.notify("OMP's default model roles restored", "info");
          await ctx.reload();
          return;
        }

        if (action === "list") {
          const presets = availablePresets(await readCustomPresets(storage.presetsFile));
          ctx.ui.notify(`Available presets: default, ${Object.keys(presets).join(", ")}`, "info");
          return;
        }

        if (action === "current") {
          const presets = availablePresets(await readCustomPresets(storage.presetsFile));
          const roles = await readConfiguredRoles(pi, ctx.cwd);
          const active = await readActivePreset(storage.activeFile);
          const current = active
            ?? (Object.keys(roles).length === 0 ? "default" : matchingPreset(roles, presets));
          ctx.ui.notify(current ? `Current preset: ${current}` : "Current preset: custom", "info");
          return;
        }

        await syncActivePreset(pi, ctx.cwd, storage);
        const custom = await readCustomPresets(storage.presetsFile);
        const presets = availablePresets(custom);
        const preset = Object.hasOwn(presets, action) ? presets[action] : undefined;
        if (!preset) {
          ctx.ui.notify(
            `Unknown preset '${action}'. Available: ${Object.keys(presets).join(", ")}`,
            "error",
          );
          return;
        }

        const resolved = new Map();
        for (const [role, spec] of Object.entries(preset)) {
          const parsed = splitSpec(spec);
          const model = ctx.models.resolve(parsed.model);
          if (!model) {
            ctx.ui.notify(`Cannot resolve ${role}: ${parsed.model}`, "error");
            return;
          }
          resolved.set(role, { ...parsed, model });
        }

        await runOmp(
          pi,
          ["config", "set", "modelRoles", JSON.stringify(preset)],
          ctx.cwd,
          "Could not save modelRoles",
        );
        await setActivePreset(storage.activeFile, action);

        const selected = resolved.get("default");
        if (selected) {
          await pi.setModel(selected.model);
          if (selected.thinking) pi.setThinkingLevel(selected.thinking);
        }
        ctx.ui.notify(`Preset '${action}' applied to ${resolved.size} roles`, "info");
        await ctx.reload();
      } catch (error) {
        ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
      }
    },
  });
}
