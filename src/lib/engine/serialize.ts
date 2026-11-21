import type { BoundaryEvent } from "./types";

export type SerializedEvent = Omit<BoundaryEvent, "amount"> & { amount: string };

export function serializeEvent(event: BoundaryEvent): SerializedEvent {
  return { ...event, amount: event.amount.toString() };
}

export function reviveEvent(event: SerializedEvent): BoundaryEvent {
  return { ...event, amount: BigInt(event.amount) };
}
