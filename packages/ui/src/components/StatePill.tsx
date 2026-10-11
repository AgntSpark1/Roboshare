"use client";
import { stateLabel } from "../format";
import { useUiStrings } from "../i18n";

export function StatePill({ state }: { state: string }) {
  return <span className={`pill s-${state}`}>{stateLabel(state, useUiStrings().states)}</span>;
}
