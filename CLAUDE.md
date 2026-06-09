# Famulus — CLAUDE notes

LUDIARS short code: **Fa**. ローカル LLM スポナー + 黒箱モデル切り替え機。
`README.md` = 使い方、`DESIGN.md` = 設計、`spec/famulus.md` = 詳細仕様。

## スタック / 規約

- Node ≥ 22 (global `fetch` / `WebSocket`)、TypeScript strict。**ランタイム依存ゼロ**
  (node 組み込みのみ)。新規依存は prebuild 必須・gyp-from-source 禁止。
- テストは `node:test` via `tsx` (`npm test`)。vitest/jest は使わない。
- SRP + ファイル分割を守る ([[feedback_coding_conventions]])。スポナーと切り替え機を混ぜない。

## アーキテクチャの不変条件

- **切り替え機はブラックボックス**。外部に見せるのは `src/switcher/index.ts` の
  `pickModel()` / `listModels()` 等と `types.ts` の型だけ。`registry.ts` / `select.ts`
  (Sonnet ワンショット) は内部実装で、上位から直接 import しない。
- `pickModel()` は **必ず modelId を返す** (Sonnet 不在でも fallback で確定)。例外を投げない。
- スポナーは **ローカル完結** (Ollama 等)。クラウド LLM を推論に使わない (compaction も含む)。
- `config.ts` は `FAMULUS_*` を正、旧 `LICTOR_LOCAL_*` を後方互換で受理する。Lictor からの
  drop-in 起動を壊さない。

## Lictor との関係

- `src/{ollama,transcript,compaction,hooks,repl}.ts` は Lictor `src/local-agent/` から移植。
  repl の「生成中入力の FIFO キュー化」(無言ドロップ防止) は移植済。Lictor 側の同コードを
  直したら Famulus にも反映する (当面は二重管理、将来 Lictor が Famulus を依存して解消)。

## 統合 (未着手 follow-up)

1. Lictor gemma4-12 provider → 内蔵 local-agent でなく Famulus を spawn。
2. Concordia delegation `model="auto"` → `pickModel` で project から FT 自動選択。
3. 新 Gemma 素モデル登録 (実 Ollama タグ判明後)。
