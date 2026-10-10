import { afterEach, describe, expect, it, vi } from "vitest";
import { api, ApiError, contractOf } from "../src/api";

afterEach(() => vi.unstubAllGlobals());

function stubFetch(status: number, body: unknown) {
  const f = vi.fn(async () => new Response(body === undefined ? null : JSON.stringify(body), { status }));
  vi.stubGlobal("fetch", f);
  return f;
}

describe("api client", () => {
  it("sends cookies and JSON to the proxied API", async () => {
    const f = stubFetch(201, { ok: true });
    await expect(api.post("/x", { a: 1 }, { idempotencyKey: "k1" })).resolves.toEqual({ ok: true });
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/v1/x");
    expect(init.credentials).toBe("include");
    expect(init.headers).toMatchObject({ "content-type": "application/json", "idempotency-key": "k1" });
  });

  it("turns the documented error shape into ApiError", async () => {
    stubFetch(409, { error: { code: "OFFERING_CLOSED", message: "offering is not open", details: { a: 1 } } });
    const e = await api.get("/y").catch((x) => x);
    expect(e).toBeInstanceOf(ApiError);
    expect(e).toMatchObject({ status: 409, code: "OFFERING_CLOSED", message: "offering is not open", details: { a: 1 } });
  });

  it("finds platform contracts but not per-project ones", () => {
    const c = {
      chainId: 31337,
      items: [
        { kind: "SUBSCRIPTION_ROUTER", address: "0x1" as const, projectId: null, deployedBlock: "0" },
        { kind: "TOKEN", address: "0x2" as const, projectId: "0xp", deployedBlock: "0" },
      ],
    };
    expect(contractOf(c, "SUBSCRIPTION_ROUTER")).toBe("0x1");
    expect(contractOf(c, "TOKEN")).toBeUndefined();
  });
});
