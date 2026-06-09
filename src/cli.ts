/**
 * Famulus CLI。スポナー起動 + FT レジストリ管理 + 黒箱選択をコマンドで叩く。
 *
 *   famulus run [--model X] [--base-url U] [--session-id S]   ローカル LLM REPL を起動
 *   famulus select --project <code> [--task <t>] [--repo <p>]  黒箱で model_id を選んで出力
 *   famulus models list                                       レジストリ一覧
 *   famulus models add --id <tag> --label <l> [--project <c>] [--ft] [--base <m>] [--notes <n>] [--sort <n>]
 *   famulus models remove --id <tag>
 *
 * spec/famulus.md §3。
 */

import { spawn } from "./spawner.js";
import { pickModel } from "./switcher/index.js";
import { add as addModel, list as listModels, remove as removeModel, type FtModel } from "./switcher/registry.js";

const HELP = `famulus — local LLM spawner + black-box model switcher (LUDIARS / Fa)

Usage:
  famulus run [--model <tag>] [--base-url <url>] [--session-id <id>]
                              ローカル LLM 対話 REPL を起動 (会話ログ + compaction + hook)
  famulus select --project <code> [--task <text>] [--repo <path>] [--fallback <tag>]
                              黒箱でプロジェクトに合うモデルを選び model_id を 1 行出力
  famulus models list         FT レジストリを一覧
  famulus models add --id <tag> --label <text> [--project <code>] [--ft]
                              [--base <model>] [--notes <text>] [--sort <n>]
  famulus models remove --id <tag>
  famulus --help | --version
`;

/** `--flag value` 形式を Map に。`--ft` 等の値なしフラグは "true"。 */
function parseFlags(args: string[]): Map<string, string> {
  const m = new Map<string, string>();
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (!a.startsWith("--")) continue;
    const key = a.slice(2);
    const next = args[i + 1];
    if (next === undefined || next.startsWith("--")) {
      m.set(key, "true");
    } else {
      m.set(key, next);
      i++;
    }
  }
  return m;
}

async function cmdRun(args: string[]): Promise<void> {
  const f = parseFlags(args);
  await spawn({
    model: f.get("model"),
    baseUrl: f.get("base-url"),
    sessionId: f.get("session-id"),
  });
}

async function cmdSelect(args: string[]): Promise<void> {
  const f = parseFlags(args);
  const choice = await pickModel(
    { project: f.get("project") ?? null, task: f.get("task"), repoPath: f.get("repo") },
    f.get("fallback") || "gemma4:12b",
  );
  // stdout は model_id だけ (shell で $(famulus select ...) として使える)。
  process.stdout.write(choice.modelId + "\n");
  process.stderr.write(`[famulus] source=${choice.source} reason=${choice.reasoning}\n`);
}

function cmdModels(args: string[]): void {
  const [sub, ...rest] = args;
  if (sub === "list" || sub === undefined) {
    const models = listModels();
    if (models.length === 0) {
      process.stdout.write("(レジストリは空)\n");
      return;
    }
    for (const m of models) {
      process.stdout.write(
        `${m.model_id}\t${m.is_ft ? "FT" : "base"}\tproject=${m.project ?? "-"}\t${m.label}${m.notes ? `  — ${m.notes}` : ""}\n`,
      );
    }
    return;
  }
  const f = parseFlags(rest);
  if (sub === "add") {
    const id = f.get("id");
    if (!id) {
      process.stderr.write("famulus: models add は --id <tag> が必須\n");
      process.exit(2);
    }
    const model: FtModel = {
      model_id: id,
      label: f.get("label") || id,
      is_ft: f.has("ft"),
      project: f.get("project") ?? null,
      base_model: f.get("base"),
      notes: f.get("notes"),
      sort_order: f.has("sort") ? Number(f.get("sort")) : undefined,
    };
    addModel(model);
    process.stdout.write(`added: ${id}\n`);
    return;
  }
  if (sub === "remove") {
    const id = f.get("id");
    if (!id) {
      process.stderr.write("famulus: models remove は --id <tag> が必須\n");
      process.exit(2);
    }
    const n = removeModel(id);
    process.stdout.write(n > 0 ? `removed: ${id}\n` : `not found: ${id}\n`);
    return;
  }
  process.stderr.write(`famulus: unknown models subcommand '${sub}'\n\n${HELP}`);
  process.exit(2);
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const [cmd, ...rest] = argv;

  if (!cmd || cmd === "--help" || cmd === "-h") {
    process.stdout.write(HELP);
    return;
  }
  if (cmd === "--version" || cmd === "-v") {
    process.stdout.write("@ludiars/famulus 0.1.0\n");
    return;
  }

  switch (cmd) {
    case "run":
      await cmdRun(rest);
      return;
    case "select":
      await cmdSelect(rest);
      return;
    case "models":
      cmdModels(rest);
      return;
    default:
      process.stderr.write(`famulus: unknown command '${cmd}'\n\n${HELP}`);
      process.exit(2);
  }
}

main().catch((err) => {
  process.stderr.write(`famulus: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
