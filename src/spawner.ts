/**
 * Famulus スポナー — 「model を 1 つ受け取ってローカル LLM を動かす」純粋な実行器。
 * Lictor の gemma4-12 provider・Concordia delegation・任意のタスクから再利用される。
 * 推論も compaction の要約もローカル LLM だけで完結する (クラウド依存ゼロ)。
 * spec/famulus.md。
 */

import { loadConfig, type ConfigOverrides } from "./config.js";
import { runRepl } from "./repl.js";
import { chat, type ChatMessage, type OllamaClientOptions } from "./ollama.js";

export interface SpawnOptions extends ConfigOverrides {
  /** 設定ソースの env (既定 process.env)。 */
  env?: NodeJS.ProcessEnv;
}

function toOllamaOptions(cfg: ReturnType<typeof loadConfig>): OllamaClientOptions {
  return {
    baseUrl: cfg.baseUrl,
    model: cfg.model,
    apiKey: cfg.apiKey,
    maxTokens: cfg.maxTokens,
    timeoutMs: cfg.timeoutMs,
  };
}

/**
 * 対話 REPL を起動する (stdin/stdout 前提。Lictor は pty で包む)。会話ログ永続 +
 * 文脈 compaction + lifecycle hook を内包する。終了するまで resolve しない。
 */
export async function spawn(opts: SpawnOptions = {}): Promise<void> {
  const { env, ...overrides } = opts;
  const cfg = loadConfig(env ?? process.env, overrides);
  await runRepl(cfg);
}

/**
 * 単発 chat (非対話)。指定モデルに 1 問だけ投げて応答テキストを返す。switcher の
 * フォールバック や、他タスクの「ローカルモデルに 1 ショット委託」用途に使う。
 */
export async function oneShot(prompt: string, opts: SpawnOptions = {}): Promise<string> {
  const { env, ...overrides } = opts;
  const cfg = loadConfig(env ?? process.env, overrides);
  const messages: ChatMessage[] = [];
  if (cfg.system) messages.push({ role: "system", content: cfg.system });
  messages.push({ role: "user", content: prompt });
  return chat(messages, toOllamaOptions(cfg));
}
