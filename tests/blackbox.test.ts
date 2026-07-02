import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { add } from "../src/switcher/registry.js";
import { pickModel } from "../src/switcher/index.js";
import {
  DOMAIN_PICK_MODEL, getPickBlackbox, listPickRules, recordPickVerdict,
} from "../src/switcher/blackbox.js";
import type { SelectFn } from "../src/switcher/blackbox.js";

function tmpEnv(): NodeJS.ProcessEnv {
  const dir = mkdtempSync(join(tmpdir(), "famulus-bb-test-"));
  return {
    ...process.env,
    FAMULUS_MODELS_FILE: join(dir, "models.json"),
    FAMULUS_BLACKBOX_FILE: join(dir, "blackbox.json"),
  };
}

/** 曖昧な候補 (Mm FT ×2 + 汎用) を登録する。 */
function seedAmbiguous(env: NodeJS.ProcessEnv): void {
  add({ model_id: "ft-mm:a", label: "Mm FT A", is_ft: true, project: "Mm", sort_order: 10 }, env);
  add({ model_id: "ft-mm:b", label: "Mm FT B", is_ft: true, project: "Mm", sort_order: 20 }, env);
  add({ model_id: "gemma4:12b", label: "base", is_ft: false, sort_order: 30 }, env);
}

function fakeSonnet(modelId: string, counter: { calls: number }): SelectFn {
  return async () => {
    counter.calls += 1;
    return { model_id: modelId, reasoning: "fake sonnet" };
  };
}

test("blackbox: Sonnet 選択を教師にルールが育ち、trial で Sonnet を呼ばなくなる", async () => {
  const env = tmpEnv();
  seedAmbiguous(env);
  const counter = { calls: 0 };
  const sel = fakeSonnet("ft-mm:a", counter);

  // 1回目: 提案 / 2〜4回目: 影一致 ×3 → trial 昇格
  for (let i = 0; i < 4; i++) {
    const c = await pickModel({ project: "Mm" }, "gemma4:12b", env, sel);
    assert.equal(c.modelId, "ft-mm:a");
    assert.equal(c.source, "sonnet");
  }
  assert.equal(counter.calls, 4);
  const rules = listPickRules(env);
  assert.equal(rules.length, 1);
  assert.equal(rules[0].state, "trial");

  // 5回目: trial ルールが発火し Sonnet は呼ばれない
  const c = await pickModel({ project: "Mm" }, "gemma4:12b", env, sel);
  assert.equal(counter.calls, 4);
  assert.equal(c.source, "rule");
  assert.equal(c.modelId, "ft-mm:a");
});

test("blackbox: OK×3 で auto 卒業、NG×3 で撤回して Sonnet に戻る", async () => {
  const env = tmpEnv();
  seedAmbiguous(env);
  const counter = { calls: 0 };
  const sel = fakeSonnet("ft-mm:a", counter);
  for (let i = 0; i < 4; i++) await pickModel({ project: "Mm" }, "gemma4:12b", env, sel); // trial 化

  // trial 発火 → pending → OK×3 で auto
  const bb = getPickBlackbox(env);
  for (let i = 0; i < 3; i++) {
    await pickModel({ project: "Mm" }, "gemma4:12b", env, sel);
    const pending = bb.ledger.listPending(DOMAIN_PICK_MODEL, 10);
    assert.ok(pending.length >= 1);
    recordPickVerdict(pending[0].id, "ok", env);
  }
  assert.equal(listPickRules(env)[0].state, "auto");

  // auto でも NG×3 で retired → Sonnet に戻る
  for (let i = 0; i < 3; i++) {
    const c = await pickModel({ project: "Mm" }, "gemma4:12b", env, sel);
    assert.equal(c.source, "rule");
    const recent = bb.ledger.listRecent(DOMAIN_PICK_MODEL, 1);
    recordPickVerdict(recent[0].id, "ng", env);
  }
  assert.equal(listPickRules(env)[0].state, "retired");
  const after = await pickModel({ project: "Mm" }, "gemma4:12b", env, sel);
  assert.equal(after.source, "sonnet");
});

test("blackbox: ルールが現候補に無い modelId を指したら自動 NG して Sonnet に落ちる", async () => {
  const env = tmpEnv();
  seedAmbiguous(env);
  // 消えたモデルを指す trial ルールを直接仕込む
  const bb = getPickBlackbox(env);
  bb.engine.addRule({
    domain: DOMAIN_PICK_MODEL,
    description: "project=Mm は gone:1",
    when: { op: "cmp", feature: "project", cmp: "==", value: "Mm" },
    output: { modelId: "gone:1" },
    source: "manual",
  });
  const counter = { calls: 0 };
  const c = await pickModel({ project: "Mm" }, "gemma4:12b", env, fakeSonnet("ft-mm:b", counter));
  assert.equal(c.source, "sonnet");
  assert.equal(c.modelId, "ft-mm:b");
  assert.equal(counter.calls, 1);
  assert.equal(listPickRules(env)[0].rejections, 1);
});

test("blackbox: Sonnet 不可なら null → pickModel は決定論フォールバック (例外を投げない)", async () => {
  const env = tmpEnv();
  seedAmbiguous(env);
  const c = await pickModel({ project: "Mm" }, "gemma4:12b", env, async () => null);
  assert.equal(c.source, "fallback");
  assert.equal(c.modelId, "ft-mm:a"); // sort_order 先頭
});
