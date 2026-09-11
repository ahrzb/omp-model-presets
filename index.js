import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

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
    globalActiveFile: join(agentDir, "model-presets.active"),
    projectActiveFile: join(cwd, ".omp", "model-presets.active"),
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
  if (name) {
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, `${name}\n`, "utf8");
  } else {
    await rm(file, { force: true });
  }
}

const SCOPES = new Set(["global", "project", "session"]);
const SESSION_STATE_TYPE = "model-presets.active";

const SCOPE_HINT = "[--scope global|project|session]";
const SCOPE_VALUE_HINT = "<global|project|session>";
const ACTION_COMPLETIONS = [
  { name: "default", description: "Clear the selected scope", hint: SCOPE_HINT },
  { name: "current", description: "Show active and effective presets" },
  { name: "list", description: "List available presets" },
  { name: "new", description: "Create a preset from current roles", hint: `<name> ${SCOPE_HINT}` },
  { name: "delete", description: "Delete a preset", hint: "<name>" },
];

function presetArgumentCompletions(argumentPrefix, presetNames) {
  const text = argumentPrefix.trimStart().toLowerCase();
  const trailingSpace = /\s$/.test(text);
  const words = text.split(/\s+/).filter(Boolean);
  const prefix = trailingSpace ? "" : (words.pop() ?? "");

  if (words.at(-1) === "--scope") {
    const matches = [...SCOPES]
      .filter((scope) => scope.startsWith(prefix))
      .map((scope) => ({
        value: `${words.join(" ")} ${scope} `,
        label: scope,
        description: `Use ${scope} scope`,
      }));
    return matches.length > 0 ? matches : null;
  }
  if (words.includes("--scope")) return null;

  if (words.length === 0) {
    const candidates = [
      ...presetNames.map((name) => ({
        name,
        description: "Apply preset",
        hint: SCOPE_HINT,
      })),
      ...ACTION_COMPLETIONS,
    ];
    const matches = candidates
      .filter(({ name }) => name.startsWith(prefix))
      .map(({ name, description, hint }) => ({
        value: `${name} `,
        label: name,
        description,
        ...(hint ? { hint } : {}),
      }));
    return matches.length > 0 ? matches : null;
  }

  if (words.length === 1 && (words[0] === "delete" || words[0] === "rm")) {
    const matches = presetNames
      .filter((name) => name.startsWith(prefix))
      .map((name) => ({ value: `${words[0]} ${name} `, label: name, description: "Delete preset" }));
    return matches.length > 0 ? matches : null;
  }

  const [action] = words;
  const acceptsScope = (
    words.length === 1
    && action !== "new"
    && action !== "current"
    && action !== "list"
    && (action === "default" || presetNames.includes(action))
  ) || (action === "new" && words.length === 2);
  if (!acceptsScope || !"--scope".startsWith(prefix)) return null;
  return [{
    value: `${words.join(" ")} --scope `,
    label: "--scope",
    description: "Choose where the preset applies",
    hint: SCOPE_VALUE_HINT,
  }];
}

function presetInlineHint(argumentText, presetNames) {
  const text = argumentText.trimStart().toLowerCase();
  if (!text) return `<preset|default|current|list|new> ${SCOPE_HINT}`;

  const trailingSpace = /\s$/.test(text);
  const words = text.split(/\s+/).filter(Boolean);
  const scopeIndex = words.indexOf("--scope");
  if (scopeIndex !== -1) {
    const scopePrefix = words[scopeIndex + 1];
    if (!scopePrefix) return trailingSpace ? SCOPE_VALUE_HINT : ` ${SCOPE_VALUE_HINT}`;
    if (trailingSpace || scopeIndex !== words.length - 2) return null;
    const scope = [...SCOPES].find((candidate) => candidate.startsWith(scopePrefix));
    return scope?.slice(scopePrefix.length) || null;
  }

  const [action] = words;
  if (!trailingSpace && words.length === 1) {
    const candidate = [
      ...presetNames.map((name) => ({ name, hint: SCOPE_HINT })),
      ...ACTION_COMPLETIONS,
    ].find(({ name }) => name.startsWith(action));
    if (!candidate) return null;
    const remaining = candidate.name.slice(action.length);
    if (remaining) return `${remaining}${candidate.hint ? ` ${candidate.hint}` : ""}`;
    return candidate.hint ? ` ${candidate.hint}` : null;
  }

  if (action === "new") {
    if (words.length === 1) return `<name> ${SCOPE_HINT}`;
    return trailingSpace ? `--scope ${SCOPE_VALUE_HINT}` : ` ${SCOPE_HINT}`;
  }
  if (action === "delete" || action === "rm") {
    return words.length === 1 ? "<name>" : null;
  }
  if (action === "current" || action === "list" || !presetNames.includes(action) && action !== "default") {
    return null;
  }
  return trailingSpace ? `--scope ${SCOPE_VALUE_HINT}` : ` ${SCOPE_HINT}`;
}

function installPresetInlineHints(ctx, completionState) {
  if (typeof ctx.ui.addAutocompleteProvider !== "function") return;
  ctx.ui.addAutocompleteProvider((current) => new Proxy(current, {
    get(target, property) {
      if (property === "getInlineHint") {
        return (lines, cursorLine, cursorCol) => {
          const beforeCursor = (lines[cursorLine] ?? "").slice(0, cursorCol);
          const match = /^\s*\/preset\s(.*)$/.exec(beforeCursor);
          const hint = match ? presetInlineHint(match[1], completionState.names) : null;
          return hint ?? target.getInlineHint?.call(target, lines, cursorLine, cursorCol) ?? null;
        };
      }
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  }));
}

async function refreshCompletionPresets(pi, cwd, completionState) {
  try {
    const storage = await presetStorage(pi, cwd);
    const custom = await readCustomPresets(storage.presetsFile);
    completionState.names = Object.keys(custom);
  } catch (error) {
    pi.logger?.warn?.("Could not refresh preset completions", { error });
  }
}


function parseCommand(args) {
  const words = args.trim().toLowerCase().split(/\s+/).filter(Boolean);
  let scope = "global";
  const scopeFlag = words.indexOf("--scope");
  if (scopeFlag !== -1) {
    if (scopeFlag !== words.length - 2 || !SCOPES.has(words[scopeFlag + 1])) {
      throw new Error("Usage: /preset <name> [--scope global|project|session]");
    }
    scope = words[scopeFlag + 1];
    words.splice(scopeFlag, 2);
  }
  return { action: words[0] ?? "list", rest: words.slice(1), scope };
}

function roleMap(value) {
  if (!isRecord(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter(([, spec]) => typeof spec === "string" && spec.trim()),
  );
}

function settingsFor(pi) {
  const settings = pi.pi?.settings;
  if (!settings) throw new Error("This OMP version does not expose scoped settings");
  return settings;
}

function sessionState(ctx) {
  const entries = ctx.sessionManager.getBranch();
  for (let index = entries.length - 1; index >= 0; index--) {
    const entry = entries[index];
    if (entry.type !== "custom" || entry.customType !== SESSION_STATE_TYPE || !isRecord(entry.data)) continue;
    const { name, base } = entry.data;
    if (name !== null && typeof name !== "string") continue;
    return { name, base: roleMap(base) };
  }
  return undefined;
}

function setSessionState(pi, name, base) {
  pi.appendEntry(SESSION_STATE_TYPE, { name, base });
}

function activeFile(storage, scope) {
  return scope === "project" ? storage.projectActiveFile : storage.globalActiveFile;
}

function rolesForScope(settings, scope) {
  if (scope === "session") return settings.getModelRoles();
  const layer = scope === "project" ? settings.getProjectSettings() : settings.getGlobalSettings();
  return roleMap(layer.modelRoles);
}

async function syncPreset(pi, ctx, storage, scope, name) {
  const roles = rolesForScope(settingsFor(pi), scope);
  validatePreset(name, roles);
  const custom = await readCustomPresets(storage.presetsFile);
  custom[name] = roles;
  await writeCustomPresets(storage.presetsFile, custom);
}

async function syncActivePreset(pi, ctx, storage) {
  const session = sessionState(ctx);
  if (session?.name) {
    await syncPreset(pi, ctx, storage, "session", session.name);
    return;
  }
  const project = await readActivePreset(storage.projectActiveFile);
  if (project) {
    await syncPreset(pi, ctx, storage, "project", project);
    return;
  }
  const global = await readActivePreset(storage.globalActiveFile);
  if (global) await syncPreset(pi, ctx, storage, "global", global);
}

function runtimeBase(settings, current) {
  if (current) return current.base;
  return Object.fromEntries(
    Object.entries(settings.getModelRoles())
      .filter(([role]) => settings.getModelRoleProvenance(role) === "runtime"),
  );
}

function applySessionRoles(settings, preset, base) {
  settings.clearOverride("modelRoles");
  settings.overrideModelRoles(base);
  settings.overrideModelRoles(preset);
}

async function setScopedRoles(pi, ctx, scope, preset, name, runtimeState) {
  const settings = settingsFor(pi);
  if (scope === "global") {
    settings.set("modelRoles", preset);
    await settings.flush();
    return;
  }
  if (scope === "project") {
    const current = roleMap(settings.getProjectSettings().modelRoles);
    for (const role of Object.keys(current)) {
      if (!Object.hasOwn(preset, role)) settings.clearProjectModelRole(role);
    }
    for (const [role, spec] of Object.entries(preset)) settings.setProjectModelRole(role, spec);
    await settings.flush();
    return;
  }
  const current = sessionState(ctx);
  const base = runtimeBase(settings, current);
  applySessionRoles(settings, preset, base);
  runtimeState.base = base;
  setSessionState(pi, name, base);
}

async function resetScope(pi, ctx, storage, scope, runtimeState) {
  const settings = settingsFor(pi);
  if (scope === "global") {
    settings.set("modelRoles", {});
    await settings.flush();
    await setActivePreset(storage.globalActiveFile);
    return;
  }
  if (scope === "project") {
    for (const role of Object.keys(roleMap(settings.getProjectSettings().modelRoles))) {
      settings.clearProjectModelRole(role);
    }
    await settings.flush();
    await setActivePreset(storage.projectActiveFile);
    return;
  }
  const current = sessionState(ctx);
  const base = runtimeBase(settings, current);
  applySessionRoles(settings, {}, base);
  runtimeState.base = undefined;
  setSessionState(pi, null, base);
}

async function restoreSessionPreset(pi, ctx, runtimeState) {
  const current = sessionState(ctx);
  const settings = settingsFor(pi);
  if (!current) {
    if (runtimeState.base !== undefined) applySessionRoles(settings, {}, runtimeState.base);
    runtimeState.base = undefined;
    return;
  }
  if (current.name === null) {
    applySessionRoles(settings, {}, current.base);
    runtimeState.base = undefined;
    return;
  }
  const storage = await presetStorage(pi, ctx.cwd);
  const presets = await readCustomPresets(storage.presetsFile);
  const preset = presets[current.name];
  if (!preset) throw new Error(`Session preset '${current.name}' no longer exists`);
  applySessionRoles(settings, preset, current.base);
  runtimeState.base = current.base;
}

function emptyPresetHint(action) {
  return `${action} No presets defined yet. Create one with '/preset new <name>'.`;
}

export default function modelPresets(pi) {
  pi.setLabel("Model Presets");
  const runtimeState = { base: undefined };
  const completionState = { names: [], hintsInstalled: false };

  for (const event of ["session_start", "session_switch", "session_branch", "session_tree"]) {
    pi.on(event, async (_event, ctx) => {
      if (event === "session_start" && !completionState.hintsInstalled) {
        installPresetInlineHints(ctx, completionState);
        completionState.hintsInstalled = true;
      }
      await restoreSessionPreset(pi, ctx, runtimeState);
      await refreshCompletionPresets(pi, ctx.cwd, completionState);
    });
  }

  pi.registerCommand("preset", {
    description: "Switch, list, inspect, or create scoped model-role presets",
    getArgumentCompletions: (argumentPrefix) =>
      presetArgumentCompletions(argumentPrefix, completionState.names),
    handler: async (args, ctx) => {
      try {
        const { action, rest, scope } = parseCommand(args);
        const storage = await presetStorage(pi, ctx.cwd);
        const settings = settingsFor(pi);

        if (action === "new") {
          const name = rest.join(" ");
          if (!name) throw new Error("Usage: /preset new <name> [--scope global|project|session]");
          validatePresetName(name);
          if (["default", "list", "current", "new", "delete", "rm"].includes(name)) {
            throw new Error(`'${name}' is reserved and cannot be used as a preset name`);
          }

          await syncActivePreset(pi, ctx, storage);
          const roles = settings.getModelRoles();
          const custom = await readCustomPresets(storage.presetsFile);
          if (Object.hasOwn(custom, name)) {
            throw new Error(`Preset '${name}' already exists`);
          }
          validatePreset(name, roles);
          custom[name] = roles;
          await writeCustomPresets(storage.presetsFile, custom);
          completionState.names = Object.keys(custom);
          await setScopedRoles(pi, ctx, scope, roles, name, runtimeState);
          if (scope !== "session") await setActivePreset(activeFile(storage, scope), name);
          ctx.ui.notify(`Preset '${name}' created and selected for ${scope} scope`, "info");
          await ctx.reload();
          return;
        }

        if (action === "delete" || action === "rm") {
          const name = rest.join(" ");
          if (!name) throw new Error("Usage: /preset delete <name>");
          validatePresetName(name);
          const custom = await readCustomPresets(storage.presetsFile);
          if (!Object.hasOwn(custom, name)) throw new Error(`Preset '${name}' does not exist`);
          delete custom[name];
          await writeCustomPresets(storage.presetsFile, custom);
          completionState.names = Object.keys(custom);

          const cleared = [];
          for (const [scopeName, file] of [
            ["global", storage.globalActiveFile],
            ["project", storage.projectActiveFile],
          ]) {
            if ((await readActivePreset(file)) === name) {
              await setActivePreset(file);
              cleared.push(scopeName);
            }
          }
          const session = sessionState(ctx);
          if (session?.name === name) {
            setSessionState(pi, null, session.base);
            cleared.push("session");
          }

          const suffix = cleared.length > 0
            ? `; cleared its active selection for ${cleared.join(", ")} scope (roles unchanged)`
            : "";
          ctx.ui.notify(`Preset '${name}' deleted${suffix}`, "info");
          return;
        }

        if (rest.length > 0) throw new Error("Usage: /preset <name> [--scope global|project|session]");

        if (action === "default") {
          await syncActivePreset(pi, ctx, storage);
          await resetScope(pi, ctx, storage, scope, runtimeState);
          ctx.ui.notify(`Default model roles restored for ${scope} scope`, "info");
          await ctx.reload();
          return;
        }

        if (action === "list") {
          const presets = await readCustomPresets(storage.presetsFile);
          const names = Object.keys(presets);
          ctx.ui.notify(
            names.length > 0
              ? `Available presets: default, ${names.join(", ")}`
              : emptyPresetHint("Available presets: default."),
            "info",
          );
          return;
        }

        if (action === "current") {
          const presets = await readCustomPresets(storage.presetsFile);
          const session = sessionState(ctx)?.name;
          const project = await readActivePreset(storage.projectActiveFile);
          const global = await readActivePreset(storage.globalActiveFile);
          const active = [
            session && `session=${session}`,
            project && `project=${project}`,
            global && `global=${global}`,
          ].filter(Boolean);
          if (active.length > 0) {
            ctx.ui.notify(`Active presets: ${active.join(", ")}; effective: ${active[0]}`, "info");
          } else {
            const roles = settings.getModelRoles();
            const current = Object.keys(roles).length === 0 ? "default" : matchingPreset(roles, presets);
            ctx.ui.notify(current ? `Current preset: ${current}` : "Current preset: custom", "info");
          }
          return;
        }

        await syncActivePreset(pi, ctx, storage);
        const presets = await readCustomPresets(storage.presetsFile);
        const preset = Object.hasOwn(presets, action) ? presets[action] : undefined;
        if (!preset) {
          const names = Object.keys(presets);
          ctx.ui.notify(
            names.length > 0
              ? `Unknown preset '${action}'. Available: ${names.join(", ")}`
              : emptyPresetHint(`Unknown preset '${action}'.`),
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

        await setScopedRoles(pi, ctx, scope, preset, action, runtimeState);
        if (scope !== "session") await setActivePreset(activeFile(storage, scope), action);

        if (settings.getModelRoles().default === preset.default) {
          const selected = resolved.get("default");
          if (selected) {
            await pi.setModel(selected.model);
            if (selected.thinking) pi.setThinkingLevel(selected.thinking);
          }
        }
        ctx.ui.notify(`Preset '${action}' applied to ${resolved.size} roles for ${scope} scope`, "info");
        await ctx.reload();
      } catch (error) {
        ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
      }
    },
  });
}
