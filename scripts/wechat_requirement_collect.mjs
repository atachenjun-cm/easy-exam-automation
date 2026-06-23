#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

import { buildWechatRequirementDraft, loadWechatGroupConfig } from "../server/wechat_requirement_collector.mjs";

function parseArgs(argv) {
  const args = {};
  for (let index = 2; index < argv.length; index += 1) {
    const item = argv[index];
    if (!item.startsWith("--")) continue;
    const key = item.slice(2);
    if (key === "clipboard") {
      args.clipboard = true;
    } else {
      args[key] = argv[index + 1];
      index += 1;
    }
  }
  return args;
}

function readStdin() {
  try {
    return readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

function readInput(args) {
  if (args.input) return readFileSync(args.input, "utf8");
  if (args.clipboard) return execFileSync("pbpaste", { encoding: "utf8" });
  return readStdin();
}

function main() {
  const args = parseArgs(process.argv);
  if (!args.config || !args.group) {
    throw new Error(
      "用法：node scripts/wechat_requirement_collect.mjs --config config/wechat-requirement-groups.example.json --group AI赋能运营自动化小组 --input /path/chat.txt",
    );
  }

  const config = loadWechatGroupConfig(readFileSync(args.config, "utf8"));
  const text = readInput(args);
  if (!text.trim()) throw new Error("没有读取到微信群聊天文本。请提供 --input、--clipboard 或 stdin。");

  const draft = buildWechatRequirementDraft({
    config,
    groupName: args.group,
    text,
  });

  process.stdout.write(`${JSON.stringify(draft, null, 2)}\n`);
}

main();
