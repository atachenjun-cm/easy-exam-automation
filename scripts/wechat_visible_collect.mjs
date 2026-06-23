#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { buildWechatRequirementDraft, loadWechatGroupConfig } from "../server/wechat_requirement_collector.mjs";

function parseArgs(argv) {
  const args = {};
  for (let index = 2; index < argv.length; index += 1) {
    const item = argv[index];
    if (!item.startsWith("--")) continue;
    const key = item.slice(2);
    if (key === "dry-run") {
      args.dryRun = true;
    } else {
      args[key] = argv[index + 1];
      index += 1;
    }
  }
  return args;
}

function readState(statePath) {
  if (!statePath || !existsSync(statePath)) return {};
  return JSON.parse(readFileSync(statePath, "utf8"));
}

function writeState(statePath, groupName, checkpoint) {
  if (!statePath) return;
  const state = readState(statePath);
  state.groups = state.groups || {};
  state.groups[groupName] = {
    ...state.groups[groupName],
    checkpoint,
    updatedAt: new Date().toISOString(),
  };
  mkdirSync(path.dirname(statePath), { recursive: true });
  writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`);
}

function captureVisibleWechatText(groupName, { dryRun = false } = {}) {
  const script = `
set targetGroup to "${escapeAppleScript(groupName)}"
tell application "WeChat" to activate
delay 0.5
tell application "System Events"
  tell process "WeChat"
    keystroke "f" using {command down}
    delay 0.2
    keystroke targetGroup
    delay 0.3
    key code 36
    delay 0.8
    keystroke "a" using {command down}
    delay 0.2
    keystroke "c" using {command down}
  end tell
end tell
delay 0.2
`;
  if (dryRun) return { script, text: "" };
  execFileSync("osascript", ["-e", script], { encoding: "utf8" });
  const text = execFileSync("pbpaste", { encoding: "utf8" });
  return { script, text };
}

function escapeAppleScript(value) {
  return String(value).replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}

function main() {
  const args = parseArgs(process.argv);
  if (!args.config) {
    throw new Error("用法：node scripts/wechat_visible_collect.mjs --config config/wechat-requirement-groups.example.json --state .easy_exam_runtime/wechat-checkpoints.json --group AI赋能运营自动化小组");
  }
  const config = loadWechatGroupConfig(readFileSync(args.config, "utf8"));
  const groups = args.group
    ? config.groups.filter((group) => group.groupName === args.group)
    : config.groups.filter((group) => group.enabled);
  if (!groups.length) throw new Error("没有找到可采集的微信群配置。");

  const state = readState(args.state);
  const results = groups.map((group) => {
    const captured = captureVisibleWechatText(group.groupName, { dryRun: args.dryRun });
    if (args.dryRun) return { groupName: group.groupName, appleScript: captured.script };
    const checkpoint = state.groups?.[group.groupName]?.checkpoint || null;
    const draft = buildWechatRequirementDraft({
      config,
      groupName: group.groupName,
      text: captured.text,
      checkpoint,
    });
    writeState(args.state, group.groupName, draft.checkpoint);
    return draft;
  });

  process.stdout.write(`${JSON.stringify({ results }, null, 2)}\n`);
}

main();
