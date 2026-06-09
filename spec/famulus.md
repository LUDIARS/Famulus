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

## 4. 統合 (未着手 follow-up)

Lictor gemma4-12 → Famulus spawn 載せ替え / Concordia delegation `model="auto"` で `pickModel`
自動選択 / 新 Gemma 素モデル登録。詳細と非目標は `DESIGN.md §3 / 非目標`。
