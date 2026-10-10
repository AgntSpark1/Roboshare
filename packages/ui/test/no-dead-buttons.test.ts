// Phase 4 exit criterion "no buttons without handlers": every <button> in both sites and the shared UI either has an
// onClick, submits a form (type="submit"), or is the trigger of a <details>/<summary>. Links are <a>/<Link>, not buttons.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(import.meta.dirname, "../../..");
const DIRS = ["apps/web/app", "apps/web/src", "apps/admin/app", "apps/admin/src", "packages/ui/src"];

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : /\.tsx$/.test(p) ? [p] : [];
  });
}

/** Opening JSX tags of <button ...>, attributes included, across lines and nested braces. */
export function buttonTags(src: string): string[] {
  const out: string[] = [];
  let i = 0;
  while ((i = src.indexOf("<button", i)) !== -1) {
    let depth = 0;
    let j = i + 7;
    for (; j < src.length; j++) {
      const c = src[j];
      if (c === "{") depth++;
      else if (c === "}") depth--;
      else if (c === ">" && depth === 0 && src[j - 1] !== "=") break;
    }
    out.push(src.slice(i, j + 1));
    i = j;
  }
  return out;
}

describe("no dead buttons", () => {
  it("parses multi-line tags with arrow functions", () => {
    const tags = buttonTags(`<button type="button" onClick={() => go(a > b)}>x</button><button disabled>y</button>`);
    expect(tags).toHaveLength(2);
    expect(tags[0]).toContain("onClick");
  });

  it("every button has a handler or submits a form", () => {
    const dead: string[] = [];
    let count = 0;
    for (const d of DIRS) {
      for (const f of files(join(ROOT, d))) {
        for (const tag of buttonTags(readFileSync(f, "utf8"))) {
          count++;
          if (!/\bonClick=/.test(tag) && !/type="submit"/.test(tag)) dead.push(`${relative(ROOT, f)}: ${tag.slice(0, 80)}`);
        }
      }
    }
    expect(count).toBeGreaterThan(20);
    expect(dead).toEqual([]);
  });
});
