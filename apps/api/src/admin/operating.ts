/** Today's date in Beijing (YYYY-MM-DD); daily operating data is kept by Beijing calendar day. */
export function beijingToday(now = new Date()): string {
  return new Date(now.getTime() + 8 * 3600_000).toISOString().slice(0, 10);
}
