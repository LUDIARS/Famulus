/**
 * 成長型ブラックボックス (@ludiars/blackbox) の JSON ファイルストア。
 *
 * Famulus は「ランタイム依存ゼロ (node 組み込みのみ)」を守るため SQLite を使わず、
 * FT レジストリ (~/.famulus/models.json) と同じ流儀で ~/.famulus/blackbox.json に
 * ルールと判断 ledger を write-through 永続化する。CLI の呼び出し頻度なら十分軽い。
 *
 * これは switcher (黒箱) の内部実装。上位から直接 import しない。
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type {
  DecisionLedger, DecisionRecord, Rule, RuleDraft, RulePatch, RuleStore,
} from "@ludiars/blackbox";
import { ruleFingerprint } from "@ludiars/blackbox";

/** 永続ファイルの置き場。env FAMULUS_BLACKBOX_FILE で上書き可 (テスト用)。 */
export function blackboxPath(env: NodeJS.ProcessEnv = process.env): string {
  return env.FAMULUS_BLACKBOX_FILE?.trim() || join(homedir(), ".famulus", "blackbox.json");
}

interface FileState {
  rules: Rule[];
  decisions: DecisionRecord[];
  seq: number;
}

const EMPTY: FileState = { rules: [], decisions: [], seq: 0 };

/** rules / decisions を 1 つの JSON に共載する共有ファイル。 */
export class BlackboxFile {
  constructor(private readonly path: string) {}

  load(): FileState {
    if (!existsSync(this.path)) return { ...EMPTY, rules: [], decisions: [] };
    try {
      const parsed = JSON.parse(readFileSync(this.path, "utf8")) as Partial<FileState>;
      return {
        rules: Array.isArray(parsed.rules) ? parsed.rules : [],
        decisions: Array.isArray(parsed.decisions) ? parsed.decisions : [],
        seq: typeof parsed.seq === "number" ? parsed.seq : 0,
      };
    } catch {
      return { ...EMPTY, rules: [], decisions: [] };
    }
  }

  save(state: FileState): void {
    mkdirSync(dirname(this.path), { recursive: true });
    writeFileSync(this.path, JSON.stringify(state, null, 2) + "\n", "utf8");
  }
}

function newId(): string {
  const c = globalThis.crypto;
  if (c?.randomUUID) return c.randomUUID();
  return `bb-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export class FileRuleStore implements RuleStore {
  constructor(private readonly file: BlackboxFile) {}

  listByDomain(domain: string): Rule[] {
    return this.file.load().rules
      .filter((r) => r.domain === domain)
      .sort((a, b) => b.priority - a.priority || a.createdAt.localeCompare(b.createdAt));
  }

  findByFingerprint(domain: string, fingerprint: string): Rule | null {
    return this.file.load().rules.find((r) => r.domain === domain && r.fingerprint === fingerprint) ?? null;
  }

  get(id: string): Rule | null {
    return this.file.load().rules.find((r) => r.id === id) ?? null;
  }

  insert(draft: RuleDraft): Rule {
    const state = this.file.load();
    const ts = new Date().toISOString();
    const rule: Rule = {
      id: newId(),
      domain: draft.domain,
      description: draft.description,
      when: draft.when,
      output: draft.output ?? null,
      confidence: draft.confidence ?? 0.7,
      state: draft.state ?? "candidate",
      source: draft.source ?? "manual",
      approvals: 0,
      rejections: 0,
      shadowAgreements: 0,
      shadowConflicts: 0,
      proposals: 1,
      fingerprint: ruleFingerprint(draft.when, draft.output ?? null),
      priority: draft.priority ?? 0,
      createdAt: ts,
      updatedAt: ts,
    };
    state.rules.push(rule);
    this.file.save(state);
    return { ...rule };
  }

  update(id: string, patch: RulePatch): Rule | null {
    const state = this.file.load();
    const idx = state.rules.findIndex((r) => r.id === id);
    if (idx < 0) return null;
    const next: Rule = { ...state.rules[idx], ...patch, updatedAt: new Date().toISOString() };
    state.rules[idx] = next;
    this.file.save(state);
    return { ...next };
  }
}

export class FileDecisionLedger implements DecisionLedger {
  constructor(private readonly file: BlackboxFile) {}

  record(rec: Omit<DecisionRecord, "id" | "verdict" | "reviewedAt">): number {
    const state = this.file.load();
    const id = ++state.seq;
    state.decisions.push({ ...rec, id, verdict: null, reviewedAt: null });
    // ledger は直近 500 件に丸める (CLI 用途の肥大防止。ルールは丸めない)。
    if (state.decisions.length > 500) state.decisions = state.decisions.slice(-500);
    this.file.save(state);
    return id;
  }

  get(id: number): DecisionRecord | null {
    return this.file.load().decisions.find((d) => d.id === id) ?? null;
  }

  setVerdict(id: number, verdict: "ok" | "ng", reviewedAt: string): void {
    const state = this.file.load();
    const rec = state.decisions.find((d) => d.id === id);
    if (rec) {
      rec.verdict = verdict;
      rec.reviewedAt = reviewedAt;
      this.file.save(state);
    }
  }

  listPending(domain?: string, limit = 50): DecisionRecord[] {
    return this.file.load().decisions
      .filter((d) => d.status === "pending_review" && d.verdict === null && (!domain || d.domain === domain))
      .slice(-limit)
      .reverse();
  }

  listRecent(domain: string, limit: number): DecisionRecord[] {
    return this.file.load().decisions
      .filter((d) => d.domain === domain)
      .slice(-limit)
      .reverse();
  }
}
