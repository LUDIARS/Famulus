# Famulus

Local LLM **spawner** + black-box model **switcher** for LUDIARS. Short code: **Fa**.

`Famulus` (Latin: *attendant / servant*) は、ローカル LLM (Ollama 等) を「モデルを 1 つ
受け取って動かす」純粋な実行器と、「プロジェクトに合うモデルを選ぶ」 ブラックボックスの
切り替え機を、Lictor / Concordia / 任意のタスクから再利用できる形で切り出したもの。

## 2 つのコンポーネント

| | 役割 | 公開 API |
|---|---|---|
| **スポナー** | model を受け取りローカル LLM を動かす (会話ログ + 文脈 compaction + hook、クラウド依存ゼロ) | `spawn()` / `oneShot()` / `famulus run` |
| **切り替え機 (黒箱)** | `context (project)` → `modelId`。内部の FT レジストリ + Sonnet ワンショット選択は隠蔽 | `pickModel()` / `famulus select` |

呼び出し側は切り替え機の中身 (レジストリも Sonnet も) を意識しない (ブラックボックスパターン)。

## CLI

```sh
famulus run [--model <tag>] [--base-url <url>] [--session-id <id>]   # 対話 REPL を起動
famulus select --project <code> [--task <t>] [--repo <p>]           # 黒箱で model_id を 1 行出力
famulus models list
famulus models add --id <tag> --label <l> [--project <code>] [--ft] [--base <m>] [--notes <n>] [--sort <n>]
famulus models remove --id <tag>
```

`famulus select` は stdout に `model_id` だけを出すので、シェルで合成できる:

```sh
famulus run --model "$(famulus select --project Mm)"
```

## ライブラリ

```ts
import { spawn, oneShot, pickModel } from "@ludiars/famulus";

const { modelId } = await pickModel({ project: "Mm", task: "..." });
await spawn({ model: modelId });
```

## 設定 (env)

`FAMULUS_*` を正、旧 `LICTOR_LOCAL_*` も後方互換で受理する (Lictor からの drop-in 用)。

| env | 既定 | 用途 |
|---|---|---|
| `FAMULUS_MODEL` | `gemma4:12b` | 既定モデル (Ollama タグ) |
| `FAMULUS_BASE_URL` | `http://127.0.0.1:11434/v1` | OpenAI 互換エンドポイント |
| `FAMULUS_SESSIONS_DIR` | `~/.famulus/sessions` | 会話ログ JSONL の置き場 |
| `FAMULUS_MODELS_FILE` | `~/.famulus/models.json` | FT レジストリ |
| `FAMULUS_SESSION_ID` | 自動採番 | セッション ID (ログ + hook) |

設計の詳細は `DESIGN.md` / `spec/famulus.md` を参照。
