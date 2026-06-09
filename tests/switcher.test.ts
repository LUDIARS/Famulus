import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { add, list, remove } from "../src/switcher/registry.js";
import { parseSelection, buildSelectPrompt } from "../src/switcher/select.js";
import { pickModel } from "../src/switcher/index.js";

function tmpEnv(): NodeJS.ProcessEnv {
  const dir = mkdtempSync(join(tmpdir(), "famulus-test-"));
  return { ...process.env, FAMULUS_MODELS_FILE: join(dir, "models.json") };
}

test("registry: add / list / remove round-trip (sorted by sort_order)", () => {
  const env = tmpEnv();
  add({ model_id: "b:1", label: "B", is_ft: false, sort_order: 20 }, env);
  add({ model_id: "a:1", label: "A", is_ft: false, sort_order: 10 }, env);
  const ids = list(env).map((m) => m.model_id);
  assert.deepEqual(ids, ["a:1", "b:1"]);
  assert.equal(remove("a:1", env), 1);
  assert.deepEqual(list(env).map((m) => m.model_id), ["b:1"]);
  assert.equal(remove("missing", env), 0);
  rmSync(env.FAMULUS_MODELS_FILE!, { force: true });
});

test("registry: add with same model_id upserts (no dup)", () => {
  const env = tmpEnv();
  add({ model_id: "x:1", label: "old", is_ft: false }, env);
  add({ model_id: "x:1", label: "new", is_ft: true, project: "Mm" }, env);
  const all = list(env);
  assert.equal(all.length, 1);
  assert.equal(all[0].label, "new");
  assert.equal(all[0].project, "Mm");
});

test("parseSelection: extracts model_id from a JSON object", () => {
  assert.deepEqual(parseSelection('{"model_id":"ft:1","reasoning":"best fit"}'), {
    model_id: "ft:1",
    reasoning: "best fit",
  });
});

test("parseSelection: tolerates surrounding text", () => {
  const out = "Here is my pick:\n{\"model_id\": \"ft:2\", \"reasoning\": \"x\"}\nthanks";
  assert.equal(parseSelection(out)?.model_id, "ft:2");
});

test("parseSelection: returns null on garbage", () => {
  assert.equal(parseSelection("no json here"), null);
  assert.equal(parseSelection('{"reasoning":"missing id"}'), null);
});

test("buildSelectPrompt: lists candidates and forces JSON reply", () => {
  const p = buildSelectPrompt(
    { project: "Mm" },
    [{ model_id: "ft:1", label: "L", is_ft: true, project: "Mm" }],
  );
  assert.match(p, /Target project code: Mm/);
  assert.match(p, /model_id=ft:1/);
  assert.match(p, /single-line JSON/);
});

test("pickModel: exact project FT match short-circuits (no Sonnet)", async () => {
  const env = tmpEnv();
  add({ model_id: "ft-mm:1", label: "Mm FT", is_ft: true, project: "Mm" }, env);
  add({ model_id: "gemma4:12b", label: "base", is_ft: false }, env);
  const c = await pickModel({ project: "Mm" }, "gemma4:12b", env);
  assert.equal(c.modelId, "ft-mm:1");
  assert.equal(c.source, "exact-match");
});

test("pickModel: empty registry falls back to provided default", async () => {
  const env = tmpEnv();
  const c = await pickModel({ project: "Mm" }, "gemma4:12b", env);
  assert.equal(c.modelId, "gemma4:12b");
  assert.equal(c.source, "fallback");
});
