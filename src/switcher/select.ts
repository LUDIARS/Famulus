/**
 * Sonnet ワンショット選択 — switcher (黒箱) の内部実装。候補が複数あるときだけ、
 * Sonnet に「プロジェクトに最も合う model_id」を 1 ショットで選ばせる。
 *
 * 呼び出しは claude CLI (`claude -p --model sonnet`) を headless で叩く。Windows は
 * CLAUDE_CODE_GIT_BASH_PATH が要る ([[feedback_claude_cli_windows_bash]])。長い prompt は
 * stdin 渡し ([[feedback_claude_cli_long_prompt]])。失敗は null を返し、呼び出し側
 * (switcher/index) が決定論的フォールバックに落とす。
 * spec/famulus.md §2。
 */

import { spawn } from "node:child_process";
import type { FtModel } from "./registry.js";
import type { SelectContext } from "./types.js";

const SONNET_MODEL = "claude-sonnet-4-6";
const SELECT_TIMEOUT_MS = 60_000;

/** Sonnet に渡す選択プロンプトを組み立てる。 */
export function buildSelectPrompt(ctx: SelectContext, candidates: FtModel[]): string {
  const lines = candidates.map((m, i) =>
    `${i + 1}. model_id=${m.model_id} | project=${m.project ?? "general"} | ft=${m.is_ft} | ${m.label}${m.notes ? ` — ${m.notes}` : ""}`,
  );
  return [
    "You pick the single best local LLM for a task. Choose from the candidate list ONLY.",
    "",
    `Target project code: ${ctx.project ?? "(none)"}`,
    ctx.repoPath ? `Repo path: ${ctx.repoPath}` : "",
    ctx.task ? `Task summary: ${ctx.task}` : "",
    "",
    "Candidates:",
    ...lines,
    "",
    "Prefer a fine-tuned (ft=true) model whose project matches the target project.",
    "If none matches, prefer the best general model.",
    'Reply with ONLY a single-line JSON object: {"model_id":"<exact model_id>","reasoning":"<one short sentence>"}',
  ]
    .filter(Boolean)
    .join("\n");
}

/** stdout から最初の JSON オブジェクトを抜き出して model_id を取り出す。 */
export function parseSelection(stdout: string): { model_id: string; reasoning: string } | null {
  const m = stdout.match(/\{[\s\S]*?"model_id"[\s\S]*?\}/);
  if (!m) return null;
  try {
    const obj = JSON.parse(m[0]) as { model_id?: unknown; reasoning?: unknown };
    if (typeof obj.model_id === "string" && obj.model_id.trim()) {
      return { model_id: obj.model_id.trim(), reasoning: typeof obj.reasoning === "string" ? obj.reasoning : "" };
    }
  } catch {
    /* fall through */
  }
  return null;
}

/**
 * Sonnet を 1 ショットで回して候補から model_id を選ばせる。claude CLI を spawn し、
 * prompt を stdin に流す。失敗 (CLI 不在 / timeout / parse 不能) は null。
 */
export async function selectViaSonnet(
  ctx: SelectContext,
  candidates: FtModel[],
  env: NodeJS.ProcessEnv = process.env,
): Promise<{ model_id: string; reasoning: string } | null> {
  if (candidates.length === 0) return null;
  const prompt = buildSelectPrompt(ctx, candidates);
  const allowed = new Set(candidates.map((c) => c.model_id));

  const childEnv = { ...env };
  // Windows: claude CLI は git-bash path が要る。未設定なら一般的な場所を試す。
  if (process.platform === "win32" && !childEnv.CLAUDE_CODE_GIT_BASH_PATH) {
    childEnv.CLAUDE_CODE_GIT_BASH_PATH = "C:\\Program Files\\Git\\bin\\bash.exe";
  }

  return new Promise((resolve) => {
    // Windows は claude が .cmd なので cmd.exe 経由で起動 (shell:true の args 連結
    // による deprecation/インジェクションを避ける。args は定数だが明示分離する)。
    const isWin = process.platform === "win32";
    const file = isWin ? childEnv.ComSpec ?? "cmd.exe" : "claude";
    const cliArgs = isWin
      ? ["/d", "/s", "/c", "claude", "-p", "--model", SONNET_MODEL]
      : ["-p", "--model", SONNET_MODEL];
    let child;
    try {
      child = spawn(file, cliArgs, { env: childEnv });
    } catch {
      resolve(null);
      return;
    }
    let out = "";
    const timer = setTimeout(() => {
      try { child.kill(); } catch { /* ignore */ }
      resolve(null);
    }, SELECT_TIMEOUT_MS);
    timer.unref?.();

    child.stdout?.on("data", (d: Buffer) => { out += d.toString("utf8"); });
    child.on("error", () => { clearTimeout(timer); resolve(null); });
    child.on("close", () => {
      clearTimeout(timer);
      const sel = parseSelection(out);
      // 候補外の model_id を返してきたら無効として null。
      resolve(sel && allowed.has(sel.model_id) ? sel : null);
    });

    try {
      child.stdin?.end(prompt);
    } catch {
      clearTimeout(timer);
      resolve(null);
    }
  });
}
