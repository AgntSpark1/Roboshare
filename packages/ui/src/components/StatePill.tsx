import { stateLabel } from "../format";

export function StatePill({ state }: { state: string }) {
  return <span className={`pill s-${state}`}>{stateLabel(state)}</span>;
}
