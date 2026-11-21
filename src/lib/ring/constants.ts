/** Deployed Solana Privacy Program. Same address on devnet and mainnet. */
export const RING_PROGRAM_ID = "ring1GaLCuJnkUMVkX2JeZLTTX17wKsV4fZmPVzXANW";

/** Native SOL interface PDA. Public SOL enters and leaves the ring here. */
export const SOL_INTERFACE = "CiNmas621VuyofiDSrEPfTXHKrdZuB6jMKECyNiMpLXE";

/**
 * First-byte discriminators from privacy-rings `program-libs/event/src/tag.rs`
 * on main (checked 2026-11-20). Live devnet transactions use these values:
 * a deposit starts with 15, a transact (transfer or withdraw) starts with 16.
 * An older spec revision used 11 and 12. This parser follows the deployed tags.
 */
export const TAG = {
  EMIT_EVENT: 14,
  DEPOSIT: 15,
  TRANSACT: 16,
  MERGE: 17,
  RING_DEPOSIT: 18,
  RING_TRANSACT: 19,
  RING_MERGE: 20,
  RING_AUTHORITY: 21,
} as const;

export type Cluster = "devnet" | "mainnet";

export const MAX_SIGNATURES = 60;
