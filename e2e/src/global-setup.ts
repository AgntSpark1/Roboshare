import { startStack } from "./stack.ts";

/** Starts anvil, the API and the indexer for the whole run; returns the teardown. */
export default async function globalSetup() {
  const { stop } = await startStack();
  return stop;
}
