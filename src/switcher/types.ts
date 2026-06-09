/**
 * switcher (黒箱) の公開型。呼び出し側はこの型と pickModel() だけを見る。
 * spec/famulus.md §2。
 */

export interface SelectContext {
  /** 対象 LUDIARS プロジェクトコード (例 "Mm")。FT のマッチに使う。 */
  project?: string | null;
  /** 対象リポの絶対パス (任意、ヒント)。 */
  repoPath?: string;
  /** タスク要約 (任意、Sonnet の判断材料)。 */
  task?: string;
}

export interface ModelChoice {
  /** 選ばれた Ollama タグ (spawner にそのまま渡せる)。 */
  modelId: string;
  /** 選択理由 (短文)。 */
  reasoning: string;
  /** 決定方法: project 完全一致 / Sonnet 判断 / フォールバック。 */
  source: "exact-match" | "sonnet" | "fallback";
}
