/**
 * モデル切り替え機 — ブラックボックス。呼び出し側は pickModel(context) → ModelChoice
 * だけを見る。内部 (FT レジストリ / Sonnet ワンショット選択 / フォールバック) は隠蔽。
 *
 * 決定ロジック:
 *   1. レジストリから候補を集める (project 一致 FT + 汎用)。
 *   2. project 完全一致の FT がちょうど 1 つ → それを即採用 (LLM 不要)。
 *   3. 候補が複数で曖昧 → Sonnet ワンショットで選ばせる。
 *   4. Sonnet が使えない / 候補ゼロ → 決定論的フォールバック (sort_order 先頭 or 既定)。
 *
 * spec/famulus.md §2。
 */

import { list, type FtModel } from "./registry.js";
import { selectViaSonnet } from "./select.js";
import type { ModelChoice, SelectContext } from "./types.js";

export type { FtModel } from "./registry.js";
export type { ModelChoice, SelectContext } from "./types.js";
export { list as listModels, add as addModel, remove as removeModel, registryPath } from "./registry.js";

/** project に合致する候補 (一致 FT を先頭、その後 汎用) を返す。 */
function candidatesFor(project: string | null | undefined, all: FtModel[]): FtModel[] {
  const p = project?.trim() || null;
  const matched = p ? all.filter((m) => m.is_ft && m.project === p) : [];
  const general = all.filter((m) => !m.project); // project 未指定 = 汎用
  // 一致 FT を優先、重複は除く。
  const seen = new Set<string>();
  const ordered: FtModel[] = [];
  for (const m of [...matched, ...general]) {
    if (!seen.has(m.model_id)) {
      seen.add(m.model_id);
      ordered.push(m);
    }
  }
  return ordered;
}

/**
 * context (主に project) からローカルモデルを 1 つ選ぶ。常に ModelChoice を返す
 * (内部で何が起きても modelId は必ず確定する)。
 *
 * @param fallbackModel 候補が一切無いときの既定モデル (既定 "gemma4:12b")。
 */
export async function pickModel(
  ctx: SelectContext,
  fallbackModel = "gemma4:12b",
  env: NodeJS.ProcessEnv = process.env,
): Promise<ModelChoice> {
  const all = list(env);
  const candidates = candidatesFor(ctx.project, all);

  if (candidates.length === 0) {
    return { modelId: fallbackModel, reasoning: "候補レジストリが空のため既定モデル", source: "fallback" };
  }

  // project 完全一致 FT がちょうど 1 つなら即採用。
  const p = ctx.project?.trim() || null;
  const exact = p ? all.filter((m) => m.is_ft && m.project === p) : [];
  if (exact.length === 1) {
    return { modelId: exact[0].model_id, reasoning: `project=${p} 完全一致の FT`, source: "exact-match" };
  }

  // 曖昧 → Sonnet ワンショット。
  const sel = await selectViaSonnet(ctx, candidates, env);
  if (sel) {
    return { modelId: sel.model_id, reasoning: sel.reasoning || "Sonnet 選択", source: "sonnet" };
  }

  // フォールバック: 候補先頭 (sort_order 昇順済)。
  return { modelId: candidates[0].model_id, reasoning: "Sonnet 不可のため候補先頭", source: "fallback" };
}
