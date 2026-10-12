import type { ProjectTerm } from "@roboshare/ui";

export interface TermStrings {
  days: (n: number) => string;
  remaining: (n: number) => string;
  monthly: string;
  capitalBack: string;
}

/** The one-line operating-term summary for a project, or null when it has no term. Remaining days show only once operations have started. */
export function termLine(term: ProjectTerm | null | undefined, s: TermStrings): string | null {
  if (!term) return null;
  const parts = [s.days(term.termDays)];
  if (term.startedAt && term.remainingDays != null) parts.push(s.remaining(term.remainingDays));
  parts.push(s.monthly, s.capitalBack);
  return parts.join(" · ");
}
