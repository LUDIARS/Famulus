/**
 * pickModel の曖昧時選択を成長型ブラックボックス (@ludiars/blackbox) に載せる。
 *
 * 従来は曖昧なら毎回 Sonnet ワンショット。ここでは Sonnet の選択を教師に
 * 「project=X → modelId」のルール候補を蓄積し、影評価 → trial → 人間 OK×3 で
 * auto 卒業 = その project の選択に Sonnet を呼ばなくなる (LLM 卒業)。
 *
 * ルールが現候補に無い modelId を返したら (レジストリ変更後など) 自動で NG を
 * 記録して Sonnet に落ちる = 環境変化への自己修復。
 *
 * これは switcher (黒箱) の内部実装。上位から直接 import しない。
 * レビューは CLI `famulus blackbox` (cli.ts)。設計正本: Lapilli packages/blackbox/DESIGN.md。
 */

import {
  BlackBoxEngine, domainStats,
  type DecisionRecord, type DomainStats, type FeatureMap, type Rule,
} from "@ludiars/blackbox";
import { BlackboxFile, FileDecisionLedger, FileRuleStore, blackboxPath } from "./blackbox-store.js";
import type { FtModel } from "./registry.js";
import type { ModelChoice, SelectContext } from "./types.js";

export const DOMAIN_PICK_MODEL = "famulus.pick_model";

export type SelectFn = (
  ctx: SelectContext,
  candidates: FtModel[],
  env: NodeJS.ProcessEnv,
) => Promise<{ model_id: string; reasoning: string } | null>;

interface PickInput {
  project: string;
  task?: string;
}
interface PickOutput {
  modelId: string;
}

export interface PickBlackbox {
  engine: BlackBoxEngine;
  ledger: FileDecisionLedger;
  rules: FileRuleStore;
}

export function getPickBlackbox(env: NodeJS.ProcessEnv = process.env): PickBlackbox {
  const file = new BlackboxFile(blackboxPath(env));
  const rules = new FileRuleStore(file);
  const ledger = new FileDecisionLedger(file);
  return { engine: new BlackBoxEngine(rules, ledger), ledger, rules };
}

/** 選択判断の特徴量。ルールは基本 project で切る (candidateCount は補助)。 */
export function pickFeatures(ctx: SelectContext, candidates: FtModel[]): FeatureMap {
  return {
    project: ctx.project?.trim() || "",
    candidateCount: candidates.length,
    ftCount: candidates.filter((c) => c.is_ft).length,
  };
}

/**
 * 曖昧時選択を blackbox 経由で行う。
 * - 学習済み (trial/auto) ルールが現候補内の modelId を返す → Sonnet 省略で確定
 * - ルール無し → Sonnet 選択を教師に candidate を育てて Sonnet の結果を返す
 * - Sonnet 不可 → null (呼び出し側が決定論的フォールバック)
 */
export async function decidePickViaBlackbox(
  ctx: SelectContext,
  candidates: FtModel[],
  env: NodeJS.ProcessEnv,
  selectFn: SelectFn,
): Promise<ModelChoice | null> {
  const bb = getPickBlackbox(env);
  const features = pickFeatures(ctx, candidates);
  const allowed = new Set(candidates.map((c) => c.model_id));
  const input: PickInput = { project: String(features.project), task: ctx.task };

  let result: { decision: { output: PickOutput; source: "rule" | "llm"; rationale: string }; decisionId: number };
  try {
    result = await bb.engine.decide<PickInput, PickOutput>(
      DOMAIN_PICK_MODEL, input, features,
      async () => {
        const sel = await selectFn(ctx, candidates, env);
        if (!sel) {
          throw new Error("sonnet unavailable");
        }
        const project = String(features.project);
        return {
          output: { modelId: sel.model_id },
          confidence: 0.8,
          rationale: sel.reasoning || "Sonnet 選択",
          // project → modelId の完全一致ルールを候補化 (project 不明なら提案しない)。
          proposedRule: project
            ? {
                description: `project=${project} は ${sel.model_id}`,
                when: { op: "cmp", feature: "project", cmp: "==", value: project },
                output: { modelId: sel.model_id },
                confidence: 0.7,
              }
            : undefined,
        };
      },
    );
  } catch {
    return null; // Sonnet 不可 (or 予期せぬ失敗) → 呼び出し側フォールバック
  }

  const { decision, decisionId } = result;
  const modelId = decision.output?.modelId;

  if (decision.source === "rule") {
    if (typeof modelId === "string" && allowed.has(modelId)) {
      return { modelId, reasoning: decision.rationale, source: "rule" };
    }
    // ルールが現候補に無いモデルを指した → 自動 NG (自己修復) して Sonnet に落とす。
    bb.engine.recordVerdict(decisionId, "ng");
    const sel = await selectFn(ctx, candidates, env);
    if (sel) return { modelId: sel.model_id, reasoning: sel.reasoning || "Sonnet 選択 (ルール無効化後)", source: "sonnet" };
    return null;
  }

  if (typeof modelId === "string" && allowed.has(modelId)) {
    return { modelId, reasoning: decision.rationale, source: "sonnet" };
  }
  return null;
}

// ── CLI レビュー用ヘルパ (famulus blackbox) ────────────────────────────────

export function listPendingDecisions(env: NodeJS.ProcessEnv = process.env, limit = 50): DecisionRecord[] {
  return getPickBlackbox(env).ledger.listPending(DOMAIN_PICK_MODEL, limit);
}

export function recordPickVerdict(
  id: number, verdict: "ok" | "ng", env: NodeJS.ProcessEnv = process.env,
): { ok: boolean; ruleUpdated?: Rule } {
  return getPickBlackbox(env).engine.recordVerdict(id, verdict);
}

export function listPickRules(env: NodeJS.ProcessEnv = process.env): Rule[] {
  return getPickBlackbox(env).rules.listByDomain(DOMAIN_PICK_MODEL);
}

export function pickStats(env: NodeJS.ProcessEnv = process.env, window = 100): DomainStats {
  const bb = getPickBlackbox(env);
  return domainStats(
    DOMAIN_PICK_MODEL,
    bb.ledger.listRecent(DOMAIN_PICK_MODEL, window),
    bb.rules.listByDomain(DOMAIN_PICK_MODEL),
  );
}
