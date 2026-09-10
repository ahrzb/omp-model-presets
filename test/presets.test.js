import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import modelPresets from "../index.js";

test("saved roles override built-ins and default restores OMP roles", async (t) => {
  const agentDir = await mkdtemp(join(tmpdir(), "omp-model-presets-"));
  t.after(() => rm(agentDir, { recursive: true, force: true }));

  const savedRoles = {
    default: "custom/default:high",
    task: "custom/task:low",
  };
  let currentRoles = savedRoles;
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
  await handler("save openai", ctx);

  assert.deepEqual(
    JSON.parse(await readFile(join(agentDir, "model-presets.json"), "utf8")),
    { openai: savedRoles },
  );

  currentRoles = { default: "other/model:medium" };
  await handler("openai", ctx);

  assert.deepEqual(appliedRoles, savedRoles);
  assert.deepEqual(selectedModel, { id: "custom/default" });
  assert.equal(thinkingLevel, "high");
  assert.equal(reloads, 1);

  await handler("default", ctx);

  assert.equal(resets, 1);
  assert.deepEqual(selectedModel, { id: "custom/default" });
  assert.equal(thinkingLevel, "high");
  assert.equal(reloads, 2);
  assert.deepEqual(notifications.map(({ level }) => level), ["info", "info", "info"]);
});
