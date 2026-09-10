import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import modelPresets from "../index.js";

function createSettings(globalRoles = {}) {
  let global = { ...globalRoles };
  const project = {};
  let runtime = {};

  return {
    getModelRoles() {
      return {
        ...global,
        ...Object.fromEntries(Object.entries(project).filter(([, value]) => typeof value === "string")),
        ...runtime,
      };
    },
    getGlobalSettings() {
      return { modelRoles: { ...global } };
    },
    getProjectSettings() {
      return { modelRoles: { ...project } };
    },
    getModelRoleProvenance(role) {
      if (Object.hasOwn(runtime, role)) return "runtime";
      if (typeof project[role] === "string") return "project";
      if (Object.hasOwn(global, role)) return "global";
      return "default";
    },
    set(path, value) {
      assert.equal(path, "modelRoles");
      global = { ...value };
    },
    setProjectModelRole(role, value) {
      project[role] = value;
    },
    clearProjectModelRole(role) {
      project[role] = null;
    },
    override(path, value) {
      assert.equal(path, "modelRoles");
      runtime = { ...value };
    },
    overrideModelRoles(value) {
      runtime = { ...runtime, ...value };
    },
    clearOverride(path) {
      assert.equal(path, "modelRoles");
      runtime = {};
    },
    async flush() {},
    layers() {
      return { global, project, runtime };
    },
  };
}

test("presets apply independently to global, project, and session scopes", async (t) => {
  const agentDir = await mkdtemp(join(tmpdir(), "omp-model-presets-agent-"));
  const cwd = await mkdtemp(join(tmpdir(), "omp-model-presets-project-"));
  t.after(() => Promise.all([
    rm(agentDir, { recursive: true, force: true }),
    rm(cwd, { recursive: true, force: true }),
  ]));

  await writeFile(
    join(agentDir, "model-presets.json"),
    JSON.stringify({
      openai: { default: "openai-codex/gpt-5.6-sol:high", smol: "openai-codex/gpt-5.6-luna:low" },
      anthropic: { default: "anthropic/claude-opus-5:high", smol: "anthropic/claude-haiku-4-5:high" },
    }),
    "utf8",
  );

  const settings = createSettings();
  const entries = [];
  const events = new Map();
  const notifications = [];
  let command;
  let handler;
  let inlineProvider;
  let selectedModel;
  let thinkingLevel;
  let reloads = 0;

  const pi = {
    pi: { settings },
    setLabel() {},
    on(event, callback) {
      events.set(event, callback);
    },
    registerCommand(_name, registered) {
      command = registered;
      handler = registered.handler;
    },
    appendEntry(customType, data) {
      entries.push({ type: "custom", customType, data });
    },
    async exec(_command, args) {
      if (args[0] === "config" && args[1] === "path") {
        return { code: 0, stdout: agentDir, stderr: "" };
      }
      throw new Error(`Unexpected omp invocation: ${args.join(" ")}`);
    },
    async setModel(model) {
      selectedModel = model;
    },
    setThinkingLevel(level) {
      thinkingLevel = level;
    },
  };
  const ctx = {
    cwd,
    sessionManager: {
      getBranch() {
        return entries;
      },
    },
    ui: {
      notify(message, level) {
        notifications.push({ message, level });
      },
      addAutocompleteProvider(factory) {
        inlineProvider = factory({
          async getSuggestions() {
            return null;
          },
          applyCompletion(lines, cursorLine, cursorCol) {
            return { lines, cursorLine, cursorCol };
          },
          getInlineHint() {
            return null;
          },
        });
      },
    },
    models: {
      resolve(spec) {
        return { id: spec };
      },
    },
    async reload() {
      reloads += 1;
    },
  };

  modelPresets(pi);
  await events.get("session_start")({ type: "session_start" }, ctx);
  assert.deepEqual(
    command.getArgumentCompletions("op").map(({ label, hint }) => ({ label, hint })),
    [{ label: "openai", hint: "[--scope global|project|session]" }],
  );
  assert.deepEqual(
    command.getArgumentCompletions("openai ").map(({ label, hint }) => ({ label, hint })),
    [{ label: "--scope", hint: "<global|project|session>" }],
  );
  assert.deepEqual(
    command.getArgumentCompletions("openai --scope p").map(({ label }) => label),
    ["project"],
  );

  await handler("openai", ctx);
  assert.match(settings.layers().global.default, /^openai-codex\//);
  assert.equal(await readFile(join(agentDir, "model-presets.active"), "utf8"), "openai\n");

  await handler("anthropic --scope project", ctx);
  assert.match(settings.layers().project.default, /^anthropic\//);
  assert.equal(
    await readFile(join(cwd, ".omp", "model-presets.active"), "utf8"),
    "anthropic\n",
  );
  assert.match(settings.getModelRoles().default, /^anthropic\//);

  await handler("openai --scope session", ctx);
  assert.match(settings.layers().runtime.default, /^openai-codex\//);
  assert.equal(entries.at(-1).data.name, "openai");
  assert.match(settings.getModelRoles().default, /^openai-codex\//);

  settings.clearOverride("modelRoles");
  await events.get("session_start")({ type: "session_start" }, ctx);
  assert.match(settings.layers().runtime.default, /^openai-codex\//);
  assert.equal(
    inlineProvider.getInlineHint(["/preset "], 0, "/preset ".length),
    "<preset|default|current|list|new> [--scope global|project|session]",
  );
  assert.equal(
    inlineProvider.getInlineHint(["/preset op"], 0, "/preset op".length),
    "enai [--scope global|project|session]",
  );
  assert.equal(
    inlineProvider.getInlineHint(
      ["/preset openai --scope pr"],
      0,
      "/preset openai --scope pr".length,
    ),
    "oject",
  );

  await handler("current", ctx);
  assert.match(notifications.at(-1).message, /session=openai.*project=anthropic.*global=openai/);

  await handler("new work --scope session", ctx);
  assert.deepEqual(command.getArgumentCompletions("w").map(({ label }) => label), ["work"]);

  const activeSessionEntries = entries.splice(0);
  await events.get("session_switch")({ type: "session_switch" }, ctx);
  assert.deepEqual(settings.layers().runtime, {});
  assert.match(settings.getModelRoles().default, /^anthropic\//);

  entries.push(...activeSessionEntries);
  await events.get("session_switch")({ type: "session_switch" }, ctx);
  assert.match(settings.layers().runtime.default, /^openai-codex\//);

  await handler("default --scope session", ctx);
  assert.equal(entries.at(-1).data.name, null);
  assert.deepEqual(settings.layers().runtime, {});
  assert.match(settings.getModelRoles().default, /^anthropic\//);

  await handler("default --scope project", ctx);
  assert.match(settings.getModelRoles().default, /^openai-codex\//);
  await assert.rejects(readFile(join(cwd, ".omp", "model-presets.active"), "utf8"), {
    code: "ENOENT",
  });

  await handler("default", ctx);
  assert.deepEqual(settings.getModelRoles(), {});
  await assert.rejects(readFile(join(agentDir, "model-presets.active"), "utf8"), {
    code: "ENOENT",
  });

  assert.deepEqual(selectedModel, { id: "openai-codex/gpt-5.6-sol" });
  assert.equal(thinkingLevel, "high");
  assert.ok(notifications.every(({ level }) => level === "info"));
});
