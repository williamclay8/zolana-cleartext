/** Public boundary of one ring movement. Amounts are base units (lamports for SOL). */
export type Asset = {
  kind: "SOL" | "SPL";
  /** "SOL" or the mint address. */
  mint: string;
  symbol: string;
  decimals: number;
};

export type BoundaryKind = "deposit" | "withdrawal";

export type BoundaryRole =
  | "depositor"
  | "deposit_recipient"
  | "withdrawal_sender"
  | "withdrawal_recipient";

export type InstructionKind =
  | "deposit"
  | "ring_deposit"
  | "transact"
  | "ring_transact";

export type BoundaryEvent = {
  id: string;
  signature: string;
  slot: number;
  /** Unix seconds. */
  blockTime: number;
  kind: BoundaryKind;
  role: BoundaryRole;
  asset: Asset;
  amount: bigint;
  /**
   * "self" when the queried address is both the public signer and the
   * public counterparty. "other" means another address is already visible
   * in this same transaction. This tool does not load that address.
   */
  counterparty: "self" | "other";
  instruction: InstructionKind;
  /** Where the amount was read from. */
  decodedFrom: "instruction" | "vault_delta";
  /** True for a withdrawal the user has not sent yet. */
  hypothetical?: boolean;
};

export type FindingKind =
  | "quick_roundtrip"
  | "amount_match"
  | "split_match"
  | "unique_amount"
  | "open_deposit";

export type Severity = "info" | "low" | "medium" | "high";

export type Grade = "strong" | "fair" | "leaky" | "exposed";

export type Finding = {
  id: string;
  kind: FindingKind;
  severity: Severity;
  /** Points removed from a starting score of 100. */
  weight: number;
  title: string;
  explanation: string;
  fix: string;
  eventIds: string[];
};

export type MatchLink = {
  id: string;
  kind: "one_to_one" | "split";
  exact: boolean;
  depositIds: string[];
  withdrawalIds: string[];
  gapSeconds: number;
};

export type ScoreReport = {
  address: string;
  privacyScore: number;
  grade: Grade;
  summary: string;
  findings: Finding[];
  matches: MatchLink[];
  deposits: number;
  withdrawals: number;
};
