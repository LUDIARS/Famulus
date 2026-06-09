# Famulus — 設計

LUDIARS のローカル LLM 実行を「スポナー」と「切り替え機」の 2 つに分離した再利用基盤。
背景: ローカル LLM (gemma4-12 等) の実行コアが Lictor の local-agent に埋まっていたが、
delegation 以外のタスクでも多用するため別リポに切り出した (2026-06-10、ユーザ決定)。

## 1. スポナー

「model を 1 つ受け取って動かす」純粋な実行器。Lictor の `src/local-agent/` から移植した:

- `ollama.ts` — OpenAI 互換 `/v1/chat/completions` クライアント (Ollama / vLLM / LM Studio)。
- `transcript.ts` — 会話ログの JSONL 永続 + resume 復元。
- `compaction.ts` — 文脈窓超過時の要約畳み込み (ローカル LLM 自身で要約、クラウド不要)。
- `hooks.ts` — SessionStart / UserPromptSubmit / Stop の lifecycle hook。
- `repl.ts` — readline REPL。生成中 (busy) の追加入力は FIFO キューで順次処理 (無言ドロップしない)。
- `config.ts` — env から設定 (`FAMULUS_*`、旧 `LICTOR_LOCAL_*` 後方互換)。

公開 API は `spawn()` (対話 REPL) と `oneShot()` (非対話 1 問)。Lictor は gemma4-12 provider
からこれを呼ぶ (将来の統合)。stdin/stdout 前提で、Lictor が pty で包む。

## 2. 切り替え機 (ブラックボックス)

呼び出し側は `pickModel(context) → ModelChoice` だけを見る。内部 (レジストリ + Sonnet) は隠蔽。

### 決定ロジック

1. レジストリから候補を集める (`project` 一致 FT + 汎用モデル)。
2. `project` 完全一致の FT がちょうど 1 つ → 即採用 (LLM 不要、`source=exact-match`)。
3. 候補が複数で曖昧 → **Sonnet ワンショット**で選ばせる (`source=sonnet`)。
4. Sonnet が使えない / 候補ゼロ → 決定論的フォールバック (`source=fallback`)。

→ 常に `modelId` が確定する (黒箱が必ず答えを返す)。

### FT レジストリ

`~/.famulus/models.json` (env `FAMULUS_MODELS_FILE` で上書き)。1 エントリ = 1 モデル:

```jsonc
{ "model_id": "ft-memoria:latest", "label": "Memoria FT", "is_ft": true,
  "project": "Mm", "base_model": "gemma4:12b", "notes": "...", "sort_order": 5 }
```

`is_ft`/`project`/`base_model`/`notes` でプロジェクト特化 FT を表現する。`famulus models` で CRUD。

### Sonnet ワンショット (`switcher/select.ts`)

claude CLI を headless (`claude -p --model claude-sonnet-4-6`) で起動し、候補一覧 + project を
渡して `{model_id, reasoning}` を 1 行 JSON で返させる。Windows は cmd.exe 経由 + 長 prompt は
stdin 渡し。失敗 (CLI 不在 / timeout / 候補外回答) は `null` → 上位が決定論フォールバックに落とす。

> なぜ claude CLI か: この環境は全 AI 駆動で claude CLI が常用される。Famulus は standalone
> ツールなので「自前で Sonnet を呼ぶ手段」が要り、API キー直叩きより CLI 再利用が低コスト。

## 3. 統合 (follow-up)

- **Lictor**: gemma4-12 provider が内蔵 local-agent でなく Famulus を spawn するよう載せ替え。
- **Concordia delegation**: `model="auto"` の 1 テンプレに集約し、invoke 時に `pickModel` で
  project から FT を自動選択 → `FAMULUS_MODEL` で Famulus に渡す。Concordia は LLM-free を維持
  (選択の Sonnet は Famulus 側 = 黒箱内)。
- 新 Gemma 素モデル (Gemma 4-26B MoE / E4B) は `ollama pull` 後の実タグでレジストリに登録。

## 非目標 (v0.1)

- tool-use / ファイル編集 / PR 作成 (スポナーはチャット主体。実装委託は claude / codex レーン)。
- レジストリの GUI (CLI のみ。将来 Concordia model_catalog 連携も検討)。
