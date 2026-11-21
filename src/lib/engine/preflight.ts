import { formatAmount, isStandardAmount } from "./amount";
import { scoreBoundary } from "./score";
import type { Asset, BoundaryEvent, Finding, ScoreReport } from "./types";

export type PreflightVerdict = "clear" | "caution" | "stop";

export type PreflightPlan = {
  amount: bigint;
  asset: Asset;
  /** Unix seconds the withdrawal would land. */
  at: number;
};

export type PreflightReport = {
  verdict: PreflightVerdict;
  headline: string;
  scoreBefore: number;
  scoreAfter: number;
  before: ScoreReport;
  after: ScoreReport;
  newFindings: Finding[];
  suggestions: string[];
};

const HYPOTHETICAL_SIGNATURE = "preflight";

export function preflight(
  address: string,
  events: BoundaryEvent[],
  plan: PreflightPlan,
): PreflightReport {
  const before = scoreBoundary(address, events);
  const hypothetical = hypotheticalWithdrawal(plan);
  const after = scoreBoundary(address, [...events, hypothetical]);
  const beforeIds = new Set(before.findings.map((finding) => finding.id));
  const newFindings = after.findings.filter((finding) => !beforeIds.has(finding.id));
  const verdict = verdictFor(newFindings);
  return {
    verdict,
    headline: headlineFor(verdict, plan, newFindings),
    scoreBefore: before.privacyScore,
    scoreAfter: after.privacyScore,
    before,
    after,
    newFindings,
    suggestions: suggestionsFor(events, plan, newFindings, verdict),
  };
}

function hypotheticalWithdrawal(plan: PreflightPlan): BoundaryEvent {
  return {
    id: `${HYPOTHETICAL_SIGNATURE}:withdrawal:${plan.asset.mint}:${plan.amount}`,
    signature: HYPOTHETICAL_SIGNATURE,
    slot: 0,
    blockTime: plan.at,
    kind: "withdrawal",
    role: "withdrawal_sender",
    asset: plan.asset,
    amount: plan.amount,
    counterparty: "self",
    instruction: "transact",
    decodedFrom: "instruction",
    hypothetical: true,
  };
}

function verdictFor(findings: Finding[]): PreflightVerdict {
  if (findings.some((finding) => finding.kind === "quick_roundtrip" || finding.weight >= 30)) {
    return "stop";
  }
  if (findings.some((finding) => finding.weight >= 8)) return "caution";
  return "clear";
}

function headlineFor(verdict: PreflightVerdict, plan: PreflightPlan, findings: Finding[]): string {
  const amount = formatAmount(plan.amount, plan.asset);
  if (verdict === "stop" && findings.some((finding) => finding.kind === "quick_roundtrip")) {
    return `Do not withdraw ${amount} this soon. It lines up with a deposit already on this address.`;
  }
  if (verdict === "stop") {
    return `Do not withdraw ${amount}. It matches a deposit already on this address.`;
  }
  if (verdict === "caution") {
    return `Withdrawing ${amount} adds a link. Change the size or wait longer.`;
  }
  return `Withdrawing ${amount} does not line up with a deposit on this address.`;
}

function suggestionsFor(
  events: BoundaryEvent[],
  plan: PreflightPlan,
  findings: Finding[],
  verdict: PreflightVerdict,
): string[] {
  const suggestions: string[] = [];
  const amount = formatAmount(plan.amount, plan.asset);
  const standard = isStandardAmount(plan.amount, plan.asset.decimals);
  if (findings.some((finding) => finding.kind === "quick_roundtrip")) {
    suggestions.push(
      "Wait. A withdrawal this soon after a similar deposit is the easiest pattern on the public edge. Give it at least a day, and several days if you can.",
    );
  } else if (findings.some((finding) => finding.kind === "amount_match" || finding.kind === "split_match")) {
    suggestions.push(
      "This plan still reconstructs an earlier deposit. Withdraw a different size, or split it so the pieces do not add back up to that deposit, and leave the rest in the ring.",
    );
  }
  if (!standard) {
    suggestions.push(
      `${amount} is not a standard denomination. Use 0.1, 0.5, 1, 2, 5, or 10 ${plan.asset.symbol} so the size is one many people already use.`,
    );
  }
  if (verdict === "clear" && events.length === 0) {
    suggestions.push(
      "This address has no public ring boundary in the history that was loaded. The size can still stand out to someone watching the whole ring, which this self-check does not do.",
    );
  }
  if (verdict === "clear" && standard) {
    suggestions.push(
      "Nothing in this address's own deposits matches the plan. A standard size and a wait still help, because this check never looks at other people's withdrawals.",
    );
  }
  if (suggestions.length === 0) {
    suggestions.push("Split the withdrawal into standard sizes and put time between them.");
  }
  return suggestions;
}
