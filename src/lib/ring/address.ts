import bs58 from "bs58";

export function isSolanaAddress(value: string): boolean {
  try {
    return bs58.decode(value.trim()).length === 32;
  } catch {
    return false;
  }
}
