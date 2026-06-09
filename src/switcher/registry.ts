/**
 * FT モデルレジストリ — 利用可能なローカルモデル (素モデル + プロジェクト特化 FT) の
 * 単一情報源。JSON ファイル (~/.famulus/models.json) に永続化する。
 *
 * これは switcher (黒箱) の内部実装。呼び出し側は switcher/index の pickModel() だけを
 * 見ればよく、レジストリの存在は意識しない (ブラックボックスパターン)。
 * spec/famulus.md §2。
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export interface FtModel {
  /** Ollama タグ (実 spawn に渡す model)。例 "gemma4:12b"。 */
  model_id: string;
  /** 人間向け表示名。 */
  label: string;
  /** FT の場合のベースモデル (素モデルなら省略)。 */
  base_model?: string;
  /**
   * この FT が特化する LUDIARS プロジェクトコード (例 "Mm" / "Di")。
   * null / 省略 = 汎用 (どのプロジェクトでも候補になる)。
   */
  project?: string | null;
  /** FT か素モデルか。 */
  is_ft: boolean;
  /** 選択ヒント (Sonnet が読む用途説明)。 */
  notes?: string;
  /** 並び順 (小さいほど優先)。 */
  sort_order?: number;
}

/** レジストリ JSON の置き場。env FAMULUS_MODELS_FILE で上書き可。 */
export function registryPath(env: NodeJS.ProcessEnv = process.env): string {
  return env.FAMULUS_MODELS_FILE?.trim() || join(homedir(), ".famulus", "models.json");
}

/** 全モデルを sort_order 昇順で返す。ファイルが無ければ空配列。 */
export function list(env: NodeJS.ProcessEnv = process.env): FtModel[] {
  const path = registryPath(env);
  if (!existsSync(path)) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return [];
  }
  const arr = Array.isArray(parsed) ? parsed : [];
  return arr
    .filter((m): m is FtModel => !!m && typeof (m as FtModel).model_id === "string")
    .sort((a, b) => (a.sort_order ?? 100) - (b.sort_order ?? 100));
}

function save(models: FtModel[], env: NodeJS.ProcessEnv = process.env): void {
  const path = registryPath(env);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(models, null, 2) + "\n", "utf8");
}

/** model_id をキーに upsert (同 id があれば差し替え)。 */
export function add(model: FtModel, env: NodeJS.ProcessEnv = process.env): FtModel[] {
  const models = list(env).filter((m) => m.model_id !== model.model_id);
  models.push(model);
  models.sort((a, b) => (a.sort_order ?? 100) - (b.sort_order ?? 100));
  save(models, env);
  return models;
}

/** model_id で削除。削除した数を返す。 */
export function remove(modelId: string, env: NodeJS.ProcessEnv = process.env): number {
  const before = list(env);
  const after = before.filter((m) => m.model_id !== modelId);
  if (after.length !== before.length) save(after, env);
  return before.length - after.length;
}
