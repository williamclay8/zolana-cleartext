import type { Asset } from "./types";

export const LAMPORTS_PER_SOL = 1_000_000_000n;

export const SOL_ASSET: Asset = {
  kind: "SOL",
  mint: "SOL",
  symbol: "SOL",
  decimals: 9,
};

/**
 * Human amounts that blend into a crowd of similar deposits.
 * Thousandths of one whole token: 1 = 0.001, 1000 = 1.
 * Any whole token from 1 through 1000 is also standard.
 */
const STANDARD_MILLI = [
  1n,
  10n,
  50n,
  100n,
  250n,
  500n,
  1000n,
  2000n,
  5000n,
  10000n,
  25000n,
  50000n,
  100000n,
];

export function isStandardAmount(amount: bigint, decimals: number): boolean {
  if (amount <= 0n) return false;
  const scale = 10n ** BigInt(decimals);
  if ((amount * 1000n) % scale !== 0n) return false;
  const milli = (amount * 1000n) / scale;
  if (STANDARD_MILLI.includes(milli)) return true;
  if (milli % 1000n === 0n) {
    const whole = milli / 1000n;
    return whole >= 1n && whole <= 1000n;
  }
  return false;
}

/**
 * Two public amounts are "about" the same when they are equal, or the gap
 * is at most half a percent of the larger amount. A dust floor of 0.0001
 * tokens keeps tiny SOL differences from counting, without treating
 * 0.02 of an SPL token as noise.
 */
export function amountsClose(a: bigint, b: bigint, decimals = 9): boolean {
  if (a === b) return true;
  const diff = a > b ? a - b : b - a;
  const larger = a > b ? a : b;
  const relative = larger / 200n;
  const dust = 10n ** BigInt(Math.max(0, decimals - 4));
  const limit = relative > dust ? relative : dust;
  return diff <= limit;
}

export function formatAmount(amount: bigint, asset: Asset): string {
  const scale = 10n ** BigInt(asset.decimals);
  const negative = amount < 0n;
  const abs = negative ? -amount : amount;
  const whole = abs / scale;
  const frac = abs % scale;
  let fracText = frac.toString().padStart(asset.decimals, "0").replace(/0+$/, "");
  if (asset.decimals === 0) fracText = "";
  const body = fracText ? `${whole}.${fracText}` : `${whole}`;
  const signed = `${negative ? "-" : ""}${body}`;
  if (asset.kind === "SPL" && asset.mint !== "unknown-spl") {
    const hint = `${asset.mint.slice(0, 4)}…${asset.mint.slice(-4)}`;
    return `${signed} SPL (${hint})`;
  }
  return `${signed} ${asset.symbol}`;
}

export function formatDelay(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  if (s < 90) return s === 1 ? "1 second" : `${s} seconds`;
  const minutes = Math.round(s / 60);
  if (minutes < 90) return minutes === 1 ? "1 minute" : `${minutes} minutes`;
  const hours = Math.round(s / 3600);
  if (hours < 36) return hours === 1 ? "1 hour" : `${hours} hours`;
  const days = Math.round(s / 86400);
  return days === 1 ? "1 day" : `${days} days`;
}

/** Parse a positive decimal string into base units. Rejects extra precision. */
export function parseHumanAmount(text: string, decimals: number): bigint | null {
  const trimmed = text.trim();
  if (!/^\d+(\.\d+)?$/.test(trimmed)) return null;
  const [whole, frac = ""] = trimmed.split(".");
  if (frac.length > decimals) return null;
  const padded = frac.padEnd(decimals, "0");
  try {
    return BigInt(whole) * 10n ** BigInt(decimals) + BigInt(padded || "0");
  } catch {
    return null;
  }
}

export function sameAsset(a: Asset, b: Asset): boolean {
  return a.kind === b.kind && a.mint === b.mint;
}
