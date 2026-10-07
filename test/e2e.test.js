// End-to-end: drives a real `omp` process over its RPC mode with this plugin
// loaded, in a throwaway agent directory. Skipped when `omp` is not on PATH.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import test from "node:test";
import { fileURLToPath } from "node:url";

const PLUGIN = fileURLToPath(new URL("../index.js", import.meta.url));
const OMP_AVAILABLE = spawnSync("omp", ["--version"]).status === 0;

// Test-only extension loaded beside the plugin. `/e2e-set-role` assigns a role
// through OMP's own `settings.setModelRole`, the write the model selector makes
// when you pick a model for a role; `/e2e-roles` reports the effective roles.
const DRIVER_SOURCE = `
export default function roleDriver(pi) {
  pi.registerCommand("e2e-set-role", {
    handler: async (args) => {
      const [role, spec] = args.trim().split(/\\s+/);
      pi.pi.settings.setModelRole(role, spec);
      await pi.pi.settings.flush();
    },
  });
  pi.registerCommand("e2e-roles", {
    handler: async (_args, ctx) => {
      ctx.ui.notify("e2e-roles " + JSON.stringify(pi.pi.settings.getModelRoles()), "info");
    },
  });
}
`;

const OPUS_5 = "anthropic/claude-opus-5:high";
const OPUS_5_5 = "anthropic/claude-opus-5-5:high";
const HAIKU = "anthropic/claude-haiku-4-5:high";
const PRESETS = {
  "anthropic-medium": { default: OPUS_5, smol: HAIKU },
  "haiku-only": { default: HAIKU, smol: HAIKU },
};

async function workspace(t) {
  const agentDir = await mkdtemp(join(tmpdir(), "omp-presets-e2e-agent-"));
  const cwd = await mkdtemp(join(tmpdir(), "omp-presets-e2e-cwd-"));
  t.after(() => Promise.all([
    rm(agentDir, { recursive: true, force: true }),
    rm(cwd, { recursive: true, force: true }),
  ]));
  await writeFile(join(agentDir, "model-presets.json"), JSON.stringify(PRESETS), "utf8");
  const driver = join(agentDir, "role-driver.js");
  await writeFile(driver, DRIVER_SOURCE, "utf8");
  return { agentDir, cwd, driver };
}

// A session that already holds a turn, so OMP has persisted it to disk — what
// you get when you reopen an existing conversation.
async function persistedSession({ agentDir, cwd }) {
  const file = join(agentDir, "seed", "session.jsonl");
  await mkdir(join(agentDir, "seed"), { recursive: true });
  const timestamp = "2026-10-06T00:00:00.000Z";
  const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
  const rows = [
    { type: "session", version: 3, id: "01a11400-0000-7000-8000-000000000001", timestamp, cwd },
    { type: "message", id: "a0000001", parentId: null, timestamp, message: { role: "user", content: [{ type: "text", text: "hi" }], timestamp: 1 } },
    { type: "message", id: "a0000002", parentId: "a0000001", timestamp, message: { role: "assistant", content: [{ type: "text", text: "hello" }], api: "anthropic-messages", provider: "anthropic", model: "claude-opus-5", usage, stopReason: "stop", timestamp: 2 } },
  ];
  await writeFile(file, `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`, "utf8");
  return file;
}

// Runs one OMP process, sends each slash command after the previous one
// settles, and returns every notification the commands produced.
async function omp({ agentDir, cwd, driver }, commands, { resume } = {}) {
  const args = [
    "--mode", "rpc", "--no-extensions", "--no-skills", "--no-rules", "--no-lsp", "--no-title",
    "-e", PLUGIN, "-e", driver, "--cwd", cwd,
  ];
  if (resume) args.push("--resume", resume);
  const child = spawn("omp", args, {
    env: { ...process.env, PI_CODING_AGENT_DIR: agentDir, ANTHROPIC_API_KEY: "sk-ant-e2e-placeholder" },
    stdio: ["pipe", "pipe", "pipe"],
  });
  let stderr = "";
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  const exited = new Promise((resolve) => child.on("exit", resolve));

  const notifications = [];
  const waiters = new Map();
  createInterface({ input: child.stdout }).on("line", (line) => {
    let event;
    try { event = JSON.parse(line); } catch { return; }
    if (event.method === "notify") notifications.push(event.message);
    const key = event.type === "ready" ? "ready" : event.type === "prompt_result" ? event.id : undefined;
    waiters.get(key)?.();
  });
  const settle = (key) => Promise.race([
    new Promise((resolve) => waiters.set(key, resolve)),
    exited.then(() => { throw new Error(`omp exited before '${key}': ${stderr}`); }),
  ]);

  try {
    await settle("ready");
    for (const [index, message] of commands.entries()) {
      const id = String(index);
      const done = settle(id);
      child.stdin.write(`${JSON.stringify({ id, type: "prompt", message })}\n`);
      await done;
    }
  } finally {
    child.kill();
    await exited;
  }
  return notifications;
}

function rolesReported(notifications) {
  return notifications
    .filter((message) => message.startsWith("e2e-roles "))
    .map((message) => JSON.parse(message.slice("e2e-roles ".length)));
}

async function globalConfig(agentDir) {
  const file = join(agentDir, "config.yml");
  return existsSync(file) ? readFile(file, "utf8") : "";
}

test("a role changed while in a preset is saved to that preset, not the global config", {
  skip: !OMP_AVAILABLE && "omp is not on PATH",
  timeout: 120_000,
}, async (t) => {
  const dirs = await workspace(t);
  const session = await persistedSession(dirs);

  const first = await omp(dirs, [
    "/preset anthropic-medium",
    `/e2e-set-role default ${OPUS_5_5}`,
    "/e2e-roles",
    "/preset default",
    "/e2e-roles",
  ], { resume: session });
  const [whileInPreset, afterLeaving] = rolesReported(first);
  assert.equal(whileInPreset.default, OPUS_5_5);
  assert.equal(afterLeaving.default, undefined, "leaving the preset must not keep its edit");

  const second = await omp(dirs, ["/preset anthropic-medium", "/e2e-roles"], { resume: session });
  assert.equal(rolesReported(second)[0].default, OPUS_5_5, "reopening the preset must show the edit");

  const presets = JSON.parse(await readFile(join(dirs.agentDir, "model-presets.json"), "utf8"));
  assert.equal(presets["anthropic-medium"].default, OPUS_5_5);
  assert.doesNotMatch(await globalConfig(dirs.agentDir), /claude-opus-5-5/);
});

test("a preset selected in a brand-new session stays in effect and takes role edits", {
  skip: !OMP_AVAILABLE && "omp is not on PATH",
  timeout: 120_000,
}, async (t) => {
  const dirs = await workspace(t);

  const first = await omp(dirs, [
    "/preset anthropic-medium",
    "/e2e-roles",
    `/e2e-set-role default ${OPUS_5_5}`,
  ]);
  assert.equal(rolesReported(first)[0].default, OPUS_5, "the preset must be in effect after selecting it");

  const presets = JSON.parse(await readFile(join(dirs.agentDir, "model-presets.json"), "utf8"));
  assert.equal(presets["anthropic-medium"].default, OPUS_5_5);
  assert.doesNotMatch(await globalConfig(dirs.agentDir), /claude-opus-5-5/);
});

async function presetDefinitions(agentDir) {
  return JSON.parse(await readFile(join(agentDir, "model-presets.json"), "utf8"));
}

test("switching session presets keeps each preset's edits in that preset only", {
  skip: !OMP_AVAILABLE && "omp is not on PATH",
  timeout: 120_000,
}, async (t) => {
  const dirs = await workspace(t);
  const session = await persistedSession(dirs);

  const roles = rolesReported(await omp(dirs, [
    "/preset anthropic-medium",
    `/e2e-set-role default ${OPUS_5_5}`,
    "/preset haiku-only",
    "/e2e-roles",
    `/e2e-set-role smol ${OPUS_5}`,
    "/preset anthropic-medium",
    "/e2e-roles",
  ], { resume: session }));
  assert.deepEqual(roles, [
    { default: HAIKU, smol: HAIKU },
    { default: OPUS_5_5, smol: HAIKU },
  ]);
  assert.deepEqual(await presetDefinitions(dirs.agentDir), {
    "anthropic-medium": { default: OPUS_5_5, smol: HAIKU },
    "haiku-only": { default: HAIKU, smol: OPUS_5 },
  });
  assert.doesNotMatch(await globalConfig(dirs.agentDir), /claude-opus/);
});

test("a role changed under a global preset is saved to it, and switching does not leak it", {
  skip: !OMP_AVAILABLE && "omp is not on PATH",
  timeout: 120_000,
}, async (t) => {
  const dirs = await workspace(t);

  const roles = rolesReported(await omp(dirs, [
    "/preset anthropic-medium --scope global",
    `/e2e-set-role default ${OPUS_5_5}`,
    "/preset haiku-only --scope global",
    "/e2e-roles",
    "/preset anthropic-medium --scope global",
    "/e2e-roles",
    "/preset default --scope global",
    "/e2e-roles",
  ]));
  assert.deepEqual(roles, [
    { default: HAIKU, smol: HAIKU },
    { default: OPUS_5_5, smol: HAIKU },
    {},
  ]);
  assert.deepEqual(await presetDefinitions(dirs.agentDir), {
    "anthropic-medium": { default: OPUS_5_5, smol: HAIKU },
    "haiku-only": PRESETS["haiku-only"],
  });
});
