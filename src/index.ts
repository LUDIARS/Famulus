/**
 * Famulus 公開ライブラリ API。任意のタスクが import して使う。
 *
 *   import { spawn, oneShot, pickModel } from "@ludiars/famulus";
 *
 * spec/famulus.md。
 */

// スポナー (model を受け取って動かす)
export { spawn, oneShot, type SpawnOptions } from "./spawner.js";
export { loadConfig, defaultSessionsDir, type FamulusConfig, type ConfigOverrides } from "./config.js";
export { chat, chatStream, type ChatMessage, type ChatRole, type OllamaClientOptions } from "./ollama.js";

// 切り替え機 (黒箱: context → modelId)
export {
  pickModel,
  listModels,
  addModel,
  removeModel,
  registryPath,
  type FtModel,
  type ModelChoice,
  type SelectContext,
} from "./switcher/index.js";
