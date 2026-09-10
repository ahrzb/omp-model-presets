import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import modelPresets from "../index.js";

test("active presets retain OMP setting changes before switching", async (t) => {
  const agentDir = await mkdtemp(join(tmpdir(), "omp-model-presets-"));
  t.after(() => rm(agentDir, { recursive: true, force: true }));

  const initialRoles = {
    default: "custom/default:high",
    task: "custom/task:low",
  };
  const editedRoles = {
    default: "other/model:medium",
    task: "other/task:low",
  };
  let currentRoles = initialRoles;
  let handler;
  let appliedRoles;
  let selectedModel;
  let thinkingLevel;
  let reloads = 0;
  let resets = 0;
  const notifications = [];

  const pi = {
    setLabel() {},
    registerCommand(_name, command) {
      handler = command.handler;
    },
    async exec(_command, args) {
      if (args[0] === "config" && args[1] === "path") {
        return { code: 0, stdout: agentDir, stderr: "" };
      }
      if (args[0] === "config" && args[1] === "get") {
        return {
          code: 0,
          stdout: JSON.stringify({ value: currentRoles }),
          stderr: "",
        };
      }
      if (args[0] === "config" && args[1] === "reset") {
        currentRoles = {};
        resets += 1;
        return { code: 0, stdout: "", stderr: "" };
      }
      if (args[0] === "config" && args[1] === "set") {
        appliedRoles = JSON.parse(args[3]);
        currentRoles = appliedRoles;
        return { code: 0, stdout: "", stderr: "" };
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
    cwd: agentDir,
    ui: {
      notify(message, level) {
        notifications.push({ message, level });
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
  await handler("new work", ctx);

  assert.deepEqual(
    JSON.parse(await readFile(join(agentDir, "model-presets.json"), "utf8")),
    { work: initialRoles },
  );
  assert.equal(await readFile(join(agentDir, "model-presets.active"), "utf8"), "work\n");

  currentRoles = editedRoles;
  await handler("anthropic", ctx);

  assert.deepEqual(
    JSON.parse(await readFile(join(agentDir, "model-presets.json"), "utf8")).work,
    editedRoles,
  );

  await handler("work", ctx);

  assert.deepEqual(appliedRoles, editedRoles);
  assert.deepEqual(selectedModel, { id: "other/model" });
  assert.equal(thinkingLevel, "medium");
  assert.equal(await readFile(join(agentDir, "model-presets.active"), "utf8"), "work\n");
  assert.equal(reloads, 2);

  await handler("default", ctx);

  assert.equal(resets, 1);
  await assert.rejects(readFile(join(agentDir, "model-presets.active"), "utf8"), {
    code: "ENOENT",
  });
  assert.equal(reloads, 3);
  assert.deepEqual(notifications.map(({ level }) => level), ["info", "info", "info", "info"]);
});
