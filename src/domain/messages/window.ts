/** WhatsApp lets a business write freely for this long after the person last wrote to it. */
export const WINDOW_HOURS = 24;

/** Days a client's link stays open. */
export const LINK_DAYS = 14;

/**
 * True while free text may be sent to a person: they wrote within the last day. Outside that window
 * only a message template approved by Meta goes through.
 */
export function windowOpen(lastInbound: Date | null, now: Date): boolean {
  return !!lastInbound && now.getTime() - lastInbound.getTime() < WINDOW_HOURS * 3_600_000;
}
