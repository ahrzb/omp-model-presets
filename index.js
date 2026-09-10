const PRESETS = {
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

function matchingPreset(roles) {
  return Object.entries(PRESETS).find(([, preset]) =>
    Object.keys(preset).length === Object.keys(roles).length
      && Object.entries(preset).every(([role, spec]) => roles[role] === spec),
  )?.[0];
}

async function readConfiguredRoles(pi, cwd) {
  const result = await pi.exec("omp", ["config", "get", "modelRoles", "--json"], { cwd });
  if (result.code !== 0) throw new Error(result.stderr.trim() || "Could not read modelRoles");
  return JSON.parse(result.stdout).value;
}

export default function modelPresets(pi) {
  pi.setLabel("Model Presets");

  pi.registerCommand("preset", {
    description: "Switch every model role to a named provider preset",
    handler: async (args, ctx) => {
      const name = args.trim().toLowerCase();

      if (!name || name === "list") {
        ctx.ui.notify(`Available presets: ${Object.keys(PRESETS).join(", ")}`, "info");
        return;
      }

      if (name === "current") {
        try {
          const current = matchingPreset(await readConfiguredRoles(pi, ctx.cwd));
          ctx.ui.notify(current ? `Current preset: ${current}` : "Current preset: custom", "info");
        } catch (error) {
          ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
        }
        return;
      }

      const preset = Object.hasOwn(PRESETS, name) ? PRESETS[name] : undefined;
      if (!preset) {
        ctx.ui.notify(`Unknown preset '${name}'. Available: ${Object.keys(PRESETS).join(", ")}`, "error");
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

      const result = await pi.exec(
        "omp",
        ["config", "set", "modelRoles", JSON.stringify(preset)],
        { cwd: ctx.cwd },
      );
      if (result.code !== 0) {
        ctx.ui.notify(result.stderr.trim() || "Could not save modelRoles", "error");
        return;
      }

      const selected = resolved.get("default");
      await pi.setModel(selected.model);
      if (selected.thinking) pi.setThinkingLevel(selected.thinking);
      ctx.ui.notify(`Preset '${name}' applied to ${resolved.size} roles`, "info");
      await ctx.reload();
    },
  });
}
