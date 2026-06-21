# Famulus 仕様

ローカル LLM スポナー + 黒箱モデル切り替え機 (LUDIARS / Fa)。概要は `DESIGN.md`。

## 1. スポナー

`spawn(opts)` — 対話 REPL を起動 (stdin/stdout、Lictor は pty で包む)。会話ログ JSONL
永続 + 文脈 compaction + lifecycle hook。`oneShot(prompt, opts)` — 非対話 1 問 1 答。

設定は env (`FAMULUS_*`、旧 `LICTOR_LOCAL_*` 後方互換) + 呼び出し overrides。主要 env は
`README.md` の表を参照。会話ログは `<sessionsDir>/<sessionId>.jsonl` に `{ts, role, content}`
で追記する (Lictor の transcript relay がこの形式を読む)。

## 2. 切り替え機 (ブラックボックス)

公開 API は `pickModel(ctx, fallbackModel?, env?) → Promise<ModelChoice>` のみ。

```ts
interface SelectContext { project?: string|null; repoPath?: string; task?: string }
interface ModelChoice  { modelId: string; reasoning: string; source: "exact-match"|"sonnet"|"fallback" }
```

決定: ①候補収集 (project 一致 FT + 汎用) → ②完全一致 FT が 1 つなら即採用 →
③曖昧なら Sonnet ワンショット (`claude -p --model claude-sonnet-4-6`、JSON 1 行で回答) →
④Sonnet 不可/候補ゼロなら決定論フォールバック。**常に modelId を返し、例外を投げない**。

内部実装 `registry.ts` (FT レジストリ JSON) と `select.ts` (Sonnet 呼び出し) は上位から
直接 import しない (黒箱)。FT エントリの形は `DESIGN.md §2` を参照。

## 3. CLI

`famulus run` / `famulus select` / `famulus models {list,add,remove}`。`select` は stdout に
`model_id` だけを出し、選択メタ (source/reason) は stderr に出す → シェル合成可能。詳細は
`README.md`。

## 4. トークン節約 (serving 側)

Famulus は LUDIARS の **serving 側 (推論を実行する層)** として、トークン節約の 3 機構を
既に自前で持つ。consumer 側 (Discutere 等) が使う request 整形ライブラリ `@ludiars/llm-gateway`
は **依存しない** — その役割を serving 側で内製しており、かつ「ランタイム依存ゼロ」の不変条件を守るため。

- **prefix caching (KV 再利用)**: `repl.ts` は system プロンプトを先頭固定で送り、可変な会話履歴を
  後ろに積む (= prefix が安定)。実際の KV 再利用は **serving backend の設定**で有効化する:
  - **vLLM**: `--enable-prefix-caching` を付けて起動 (block 単位ハッシュで自動共有)。
  - **Ollama**: 既定で直近プロンプトの KV を再利用 (明示フラグ不要)。
  - Famulus 側は順序を崩さないことだけ守る (system を毎回先頭・不変に保つ)。
- **routing**: `pickModel()` が project/タスクから FT/素モデルを選ぶ (= 易しいタスクを安いモデルへ
  振り分ける tier ルーティングと同義)。§2 参照。
- **履歴畳み込み**: `compaction.ts` が文脈窓超過時に古いターンを要約 1 個に畳む (ローカル LLM 自身で
  要約、クラウド不要)。

## 5. 統合 (未着手 follow-up)

Lictor gemma4-12 → Famulus spawn 載せ替え / Concordia delegation `model="auto"` で `pickModel`
自動選択 / 新 Gemma 素モデル登録。詳細と非目標は `DESIGN.md §3 / 非目標`。
