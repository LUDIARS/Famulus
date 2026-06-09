/**
 * Famulus スポナーの設定。env から読む。`FAMULUS_*` を正、旧 `LICTOR_LOCAL_*` /
 * `LICTOR_*` も後方互換で受理する (Lictor が wrap 経由で export する env をそのまま
 * 渡しても動くように)。CLI の `--model` 等は overrides で上書きする。
 * spec/famulus.md。
 */

import { homedir } from "node:os";
import { join } from "node:path";

export interface FamulusConfig {
  baseUrl: string;
  model: string;
  apiKey: string;
  maxTokens: number;
  timeoutMs: number;
  system: string;
  /** 想定文脈窓 (compaction の基準サイズ、トークン)。 */
  contextTokens: number;
  /** contextTokens のこの割合を超えたら compaction。 */
  compactRatio: number;
  /** compaction 時に末尾から残す turn 数。 */
  keepRecent: number;
  /** hook 定義 JSON の path。 */
  hooksPath: string;
  /** transcript JSONL の置き場 dir。 */
  sessionsDir: string;
  /** セッション ID (transcript ファイル名 + hook payload)。 */
  sessionId: string;
}

/** repl.ts 等が参照する旧名 (互換 alias)。 */
export type LocalAgentConfig = FamulusConfig;

/** CLI / 呼び出し側からの上書き。env より優先。 */
export interface ConfigOverrides {
  model?: string;
  baseUrl?: string;
  sessionId?: string;
  sessionsDir?: string;
  system?: string;
  personaName?: string;
}

/** 複数の env キー候補を順に見て最初の非空を返す。 */
function pick(env: NodeJS.ProcessEnv, names: string[]): string | undefined {
  for (const n of names) {
    const v = env[n]?.trim();
    if (v) return v;
  }
  return undefined;
}

function num(env: NodeJS.ProcessEnv, names: string[], fallback: number): number {
  const raw = pick(env, names);
  const v = Number(raw);
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

function ratio(env: NodeJS.ProcessEnv, names: string[], fallback: number): number {
  const raw = pick(env, names);
  const v = Number(raw);
  return Number.isFinite(v) && v > 0 && v <= 1 ? v : fallback;
}

/** 既定の transcript 置き場。 */
export function defaultSessionsDir(): string {
  return join(homedir(), ".famulus", "sessions");
}

export function loadConfig(
  env: NodeJS.ProcessEnv = process.env,
  overrides: ConfigOverrides = {},
): FamulusConfig {
  const sessionsDir =
    overrides.sessionsDir?.trim() ||
    pick(env, ["FAMULUS_SESSIONS_DIR", "LICTOR_LOCAL_SESSIONS_DIR"]) ||
    defaultSessionsDir();

  const sessionId =
    overrides.sessionId?.trim() ||
    pick(env, ["FAMULUS_SESSION_ID", "LICTOR_SESSION_ID"]) ||
    `famulus-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;

  // persona があれば system に前置 (Lictor が LICTOR_PERSONA_NAME を export)。
  const personaName = overrides.personaName?.trim() || pick(env, ["FAMULUS_PERSONA_NAME", "LICTOR_PERSONA_NAME"]);
  const baseSystem = overrides.system?.trim() || pick(env, ["FAMULUS_SYSTEM", "LICTOR_LOCAL_SYSTEM"]) || "";
  const system = personaName
    ? `あなたは「${personaName}」というローカル AI アシスタントです。${baseSystem ? "\n" + baseSystem : ""}`
    : baseSystem;

  const baseUrl = (
    overrides.baseUrl?.trim() ||
    pick(env, ["FAMULUS_BASE_URL", "LICTOR_LOCAL_BASE_URL"]) ||
    "http://127.0.0.1:11434/v1"
  ).replace(/\/+$/, "");

  return {
    baseUrl,
    model: overrides.model?.trim() || pick(env, ["FAMULUS_MODEL", "LICTOR_LOCAL_MODEL"]) || "gemma4:12b",
    apiKey: pick(env, ["FAMULUS_API_KEY", "LICTOR_LOCAL_API_KEY"]) || "",
    maxTokens: num(env, ["FAMULUS_MAX_TOKENS", "LICTOR_LOCAL_MAX_TOKENS"], 4096),
    timeoutMs: num(env, ["FAMULUS_TIMEOUT_MS", "LICTOR_LOCAL_TIMEOUT_MS"], 300_000),
    system,
    contextTokens: num(env, ["FAMULUS_CONTEXT_TOKENS", "LICTOR_LOCAL_CONTEXT_TOKENS"], 131_072),
    compactRatio: ratio(env, ["FAMULUS_COMPACT_RATIO", "LICTOR_LOCAL_COMPACT_RATIO"], 0.75),
    keepRecent: num(env, ["FAMULUS_KEEP_RECENT", "LICTOR_LOCAL_KEEP_RECENT"], 6),
    hooksPath:
      pick(env, ["FAMULUS_HOOKS", "LICTOR_LOCAL_HOOKS"]) || join(homedir(), ".famulus", "hooks.json"),
    sessionsDir,
    sessionId,
  };
}
