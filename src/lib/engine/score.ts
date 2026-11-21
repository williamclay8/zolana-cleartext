import {
  amountsClose,
  formatAmount,
  formatDelay,
  isStandardAmount,
  sameAsset,
} from "./amount";
import type {
  BoundaryEvent,
  Finding,
  Grade,
  MatchLink,
  ScoreReport,
  Severity,
} from "./types";

/**
 * Points removed from 100. See README "Heuristics" — these names are the
 * source of truth the tests lock in.
 *
 * A match is scored once. Timing is added onto that match, not a second
 * finding, so a fast round trip is not punished twice.
 */
export const WEIGHT = {
  exactUnique: 32,
  exactStandard: 14,
  nearUnique: 22,
  nearStandard: 10,
  split: 12,
  /** Gap from the earliest deposit in the match to the latest withdrawal. */
  within10Minutes: 24,
  within30Minutes: 16,
  within2Hours: 10,
  within24Hours: 5,
  within72Hours: 2,
  /** Extra when a unique amount also comes back out within 30 minutes. */
  quickUniqueBonus: 8,
  openUniqueDeposit: 3,
  openUniqueCap: 9,
  unmatchedUniqueWithdrawal: 4,
  unmatchedUniqueCap: 12,
} as const;

const TEN_MIN = 10 * 60;
const THIRTY_MIN = 30 * 60;
const TWO_HOURS = 2 * 3600;
const DAY = 24 * 3600;
const THREE_DAYS = 72 * 3600;

function timingWeight(gapSeconds: number): number {
  if (gapSeconds <= TEN_MIN) return WEIGHT.within10Minutes;
  if (gapSeconds <= THIRTY_MIN) return WEIGHT.within30Minutes;
  if (gapSeconds <= TWO_HOURS) return WEIGHT.within2Hours;
  if (gapSeconds <= DAY) return WEIGHT.within24Hours;
  if (gapSeconds <= THREE_DAYS) return WEIGHT.within72Hours;
  return 0;
}

function severityFor(weight: number): Severity {
  if (weight >= 24) return "high";
  if (weight >= 10) return "medium";
  if (weight >= 4) return "low";
  return "info";
}

function gradeFor(score: number): Grade {
  if (score >= 90) return "strong";
  if (score >= 70) return "fair";
  if (score >= 45) return "leaky";
  return "exposed";
}

function summaryFor(grade: Grade, deposits: number, withdrawals: number): string {
  if (deposits + withdrawals === 0) {
    return "No public ring deposits or withdrawals to score.";
  }
  switch (grade) {
    case "strong":
      return "Little in this address's own public history ties a deposit to a withdrawal.";
    case "fair":
      return "Some public deposits and withdrawals line up. The link is real, and it is not a clean dash in and out.";
    case "leaky":
      return "A deposit and a withdrawal can be read as the same funds crossing the ring.";
    case "exposed":
      return "The public edge of this history is easy to link. Amount, timing, or both give it away.";
  }
}

type Pair = {
  deposits: BoundaryEvent[];
  withdrawals: BoundaryEvent[];
  exact: boolean;
  split: boolean;
};

function absDiff(a: bigint, b: bigint): bigint {
  return a > b ? a - b : b - a;
}

function sum(events: BoundaryEvent[]): bigint {
  return events.reduce((total, event) => total + event.amount, 0n);
}

function gap(deposits: BoundaryEvent[], withdrawals: BoundaryEvent[]): number {
  const start = Math.min(...deposits.map((event) => event.blockTime));
  const end = Math.max(...withdrawals.map((event) => event.blockTime));
  return Math.max(0, end - start);
}

function standardGroup(events: BoundaryEvent[]): boolean {
  return events.every((event) => isStandardAmount(event.amount, event.asset.decimals));
}

/**
 * Score one address's own deposits and withdrawals.
 * Pass only that address's boundary. Do not pass other people's events.
 */
export function scoreBoundary(address: string, events: BoundaryEvent[]): ScoreReport {
  const ordered = [...events].sort((a, b) => a.blockTime - b.blockTime || a.id.localeCompare(b.id));
  const deposits = ordered.filter((event) => event.kind === "deposit");
  const withdrawals = ordered.filter((event) => event.kind === "withdrawal");

  const used = new Set<string>();
  const pairs: Pair[] = [];

  for (const withdrawal of withdrawals) {
    const candidates = deposits.filter(
      (deposit) =>
        !used.has(deposit.id) &&
        deposit.blockTime <= withdrawal.blockTime &&
        sameAsset(deposit.asset, withdrawal.asset) &&
        amountsClose(deposit.amount, withdrawal.amount, deposit.asset.decimals),
    );
    if (candidates.length === 0) continue;
    candidates.sort((a, b) => {
      const exactA = a.amount === withdrawal.amount ? 0 : 1;
      const exactB = b.amount === withdrawal.amount ? 0 : 1;
      if (exactA !== exactB) return exactA - exactB;
      const diff = absDiff(a.amount, withdrawal.amount) - absDiff(b.amount, withdrawal.amount);
      if (diff !== 0n) return diff < 0n ? -1 : 1;
      return Math.abs(withdrawal.blockTime - a.blockTime) - Math.abs(withdrawal.blockTime - b.blockTime);
    });
    const deposit = candidates[0]!;
    used.add(deposit.id);
    used.add(withdrawal.id);
    pairs.push({
      deposits: [deposit],
      withdrawals: [withdrawal],
      exact: deposit.amount === withdrawal.amount,
      split: false,
    });
  }

  // A withdrawal that equals two or three earlier deposits, or a deposit that
  // equals two or three later withdrawals. Capped at the eight nearest parts
  // so a long history stays cheap.
  const matchSplit = (
    target: BoundaryEvent,
    parts: BoundaryEvent[],
    targetIsWithdrawal: boolean,
  ) => {
    const pool = parts
      .filter(
        (part) =>
          !used.has(part.id) &&
          sameAsset(part.asset, target.asset) &&
          (targetIsWithdrawal
            ? part.blockTime <= target.blockTime
            : part.blockTime >= target.blockTime) &&
          !amountsClose(part.amount, target.amount, part.asset.decimals),
      )
      .sort((a, b) => Math.abs(target.blockTime - a.blockTime) - Math.abs(target.blockTime - b.blockTime))
      .slice(0, 8);
    let best: BoundaryEvent[] | null = null;
    let bestDiff = -1n;
    const consider = (group: BoundaryEvent[]) => {
      const total = sum(group);
      if (!amountsClose(total, target.amount, target.asset.decimals)) return;
      const diff = absDiff(total, target.amount);
      if (
        best === null ||
        diff < bestDiff ||
        (diff === bestDiff && group.length < best.length)
      ) {
        best = group;
        bestDiff = diff;
      }
    };
    for (let i = 0; i < pool.length; i++) {
      for (let j = i + 1; j < pool.length; j++) {
        consider([pool[i]!, pool[j]!]);
        for (let k = j + 1; k < pool.length; k++) {
          consider([pool[i]!, pool[j]!, pool[k]!]);
        }
      }
    }
    if (!best) return;
    const group: BoundaryEvent[] = best;
    for (const part of group) used.add(part.id);
    used.add(target.id);
    const exact = sum(group) === target.amount;
    if (targetIsWithdrawal) {
      pairs.push({ deposits: group, withdrawals: [target], exact, split: true });
    } else {
      pairs.push({ deposits: [target], withdrawals: group, exact, split: true });
    }
  };

  for (const withdrawal of withdrawals) {
    if (used.has(withdrawal.id)) continue;
    matchSplit(withdrawal, deposits, true);
  }
  for (const deposit of deposits) {
    if (used.has(deposit.id)) continue;
    matchSplit(deposit, withdrawals, false);
  }

  const findings: Finding[] = [];
  const matches: MatchLink[] = [];

  for (const pair of pairs) {
    const seconds = gap(pair.deposits, pair.withdrawals);
    const standard = standardGroup([...pair.deposits, ...pair.withdrawals]);
    const quick = seconds <= THIRTY_MIN;
    let weight = pair.split
      ? WEIGHT.split
      : pair.exact
        ? standard
          ? WEIGHT.exactStandard
          : WEIGHT.exactUnique
        : standard
          ? WEIGHT.nearStandard
          : WEIGHT.nearUnique;
    weight += timingWeight(seconds);
    if (quick && !standard && !pair.split) weight += WEIGHT.quickUniqueBonus;

    const ids = [...pair.deposits, ...pair.withdrawals].map((event) => event.id);
    const kind = quick && !pair.split ? "quick_roundtrip" : pair.split ? "split_match" : "amount_match";
    const depositText = pair.deposits.map((event) => formatAmount(event.amount, event.asset)).join(" + ");
    const withdrawalText = pair.withdrawals
      .map((event) => formatAmount(event.amount, event.asset))
      .join(" + ");
    const delay = formatDelay(seconds);
    const id = `${kind}:${pair.deposits.map((event) => event.id).join("+")}:${pair.withdrawals
      .map((event) => event.id)
      .join("+")}`;

    const { title, explanation, fix } = describeMatch({
      kind,
      split: pair.split,
      exact: pair.exact,
      standard,
      depositText,
      withdrawalText,
      delay,
      quick,
    });

    findings.push({
      id,
      kind,
      severity: severityFor(weight),
      weight,
      title,
      explanation,
      fix,
      eventIds: ids,
    });
    matches.push({
      id,
      kind: pair.split ? "split" : "one_to_one",
      exact: pair.exact,
      depositIds: pair.deposits.map((event) => event.id),
      withdrawalIds: pair.withdrawals.map((event) => event.id),
      gapSeconds: seconds,
    });
  }

  let openUnique = 0;
  for (const deposit of deposits) {
    if (used.has(deposit.id)) continue;
    const unique = !isStandardAmount(deposit.amount, deposit.asset.decimals);
    let weight = 0;
    if (unique && openUnique < WEIGHT.openUniqueCap) {
      weight = Math.min(WEIGHT.openUniqueDeposit, WEIGHT.openUniqueCap - openUnique);
      openUnique += weight;
    }
    const amount = formatAmount(deposit.amount, deposit.asset);
    findings.push({
      id: `open:${deposit.id}`,
      kind: "open_deposit",
      severity: weight >= 4 ? "low" : "info",
      weight,
      title: unique ? `${amount} is still inside, and the size is unusual` : `${amount} is still inside the ring`,
      explanation: unique
        ? `This deposit has not been matched to a withdrawal on this address. The odd size is a fingerprint: a later withdrawal of ${amount} would be easy to connect to it.`
        : `This deposit is still on the private side of the ring, as far as this address's public withdrawals show. Withdrawing this same ${amount} later would line the two events up.`,
      fix: unique
        ? "When you withdraw, use a standard size (0.1, 0.5, 1, 2, 5, or 10) instead of this one, and do not withdraw the whole deposit at once."
        : "A standard size helps. Withdrawing a different standard size, or splitting so the pieces do not add back up to this deposit, helps more.",
      eventIds: [deposit.id],
    });
  }

  let uniqueWithdrawals = 0;
  for (const withdrawal of withdrawals) {
    if (used.has(withdrawal.id)) continue;
    if (isStandardAmount(withdrawal.amount, withdrawal.asset.decimals)) continue;
    const weight =
      uniqueWithdrawals >= WEIGHT.unmatchedUniqueCap
        ? 0
        : Math.min(
            WEIGHT.unmatchedUniqueWithdrawal,
            WEIGHT.unmatchedUniqueCap - uniqueWithdrawals,
          );
    uniqueWithdrawals += weight;
    const amount = formatAmount(withdrawal.amount, withdrawal.asset);
    findings.push({
      id: `unique:${withdrawal.id}`,
      kind: "unique_amount",
      severity: severityFor(weight),
      weight,
      title: `${amount} is an unusual public size`,
      explanation: `This withdrawal does not match a deposit on this address, but the amount is not a common denomination. Unusual sizes stand out in the public record of the ring.`,
      fix: "Prefer a standard amount such as 0.1, 0.5, 1, 2, 5, or 10 SOL so the size is one many people use.",
      eventIds: [withdrawal.id],
    });
  }

  const penalty = findings.reduce((total, finding) => total + finding.weight, 0);
  const privacyScore = Math.max(0, Math.min(100, 100 - penalty));
  const grade = gradeFor(privacyScore);
  findings.sort((a, b) => b.weight - a.weight || a.title.localeCompare(b.title));

  return {
    address,
    privacyScore,
    grade,
    summary: summaryFor(grade, deposits.length, withdrawals.length),
    findings,
    matches,
    deposits: deposits.length,
    withdrawals: withdrawals.length,
  };
}

function describeMatch(input: {
  kind: Finding["kind"];
  split: boolean;
  exact: boolean;
  standard: boolean;
  depositText: string;
  withdrawalText: string;
  delay: string;
  quick: boolean;
}): { title: string; explanation: string; fix: string } {
  const { split, exact, standard, depositText, withdrawalText, delay, quick } = input;
  if (quick && !split) {
    return {
      title: `In and out in ${delay}`,
      explanation: `A deposit of ${depositText} was followed ${delay} later by a withdrawal of ${withdrawalText}. That short gap is public. An observer does not need anything from inside the ring to treat them as the same funds.`,
      fix: "Wait. A day is a minimum, and several days is safer. Also change the size: split into standard amounts such as 0.1, 0.5, or 1 SOL that do not add back up to the deposit.",
    };
  }
  if (split) {
    return {
      title: exact
        ? `Split withdrawals still add up to ${depositText}`
        : `Split amounts still come out near ${depositText}`,
      explanation: `No single withdrawal copies a deposit, which helps. Together, ${withdrawalText} still ${exact ? "equals" : "comes within half a percent of"} the earlier ${depositText}, ${delay} after the deposit. The total can reconnect them.`,
      fix: "Leave part of the deposit in the ring, or withdraw sizes that do not add back up to it. Space the withdrawals out by days, not hours.",
    };
  }
  const closeness = exact ? "matches" : "is about the same size as";
  return {
    title: exact ? `Withdrawal matches a deposit of ${depositText}` : `Withdrawal is close to a deposit of ${depositText}`,
    explanation: standard
      ? `The withdrawal of ${withdrawalText} ${closeness} the deposit of ${depositText}. The size is a common denomination, which helps it blend, and the two events are still ${delay} apart on this address alone.`
      : `The withdrawal of ${withdrawalText} ${closeness} the deposit of ${depositText}. That size is not a common denomination, so the amount itself ties the public events together. They are ${delay} apart.`,
    fix: standard
      ? "Withdraw a different standard size, or split the withdrawal so the pieces do not reconstruct this deposit. Waiting longer still reduces the timing link."
      : "Use a standard amount (0.1, 0.5, 1, 2, 5, or 10 SOL), or split into standard pieces that do not add up to this deposit, and leave the rest in the ring.",
  };
}
