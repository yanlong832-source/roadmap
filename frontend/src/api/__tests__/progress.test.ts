import { afterEach, describe, expect, it, vi } from "vitest";

import { fetchProgress, setProgress } from "../progress";

/* ------------------------------------------------------------------ */
/* fetchProgress                                                       */
/* ------------------------------------------------------------------ */

describe("fetchProgress", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("GETs /api/progress/{encoded keyword} and returns the statuses map", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          statuses: { "fccf4d91a6cd": "done", "596405d2b10d": "in_progress" },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchProgress("rag");
    expect(result).toEqual({
      "fccf4d91a6cd": "done",
      "596405d2b10d": "in_progress",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const calledUrl = fetchMock.mock.calls[0][0] as string;
    expect(calledUrl).toBe("/api/progress/rag");
  });

  it("encodes a multi-word keyword in the URL", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ statuses: {} }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await fetchProgress("machine learning");
    const calledUrl = fetchMock.mock.calls[0][0] as string;
    expect(calledUrl).toBe(
      "/api/progress/" + encodeURIComponent("machine learning"),
    );
  });

  it("returns {} on a non-200 response (non-throwing)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: "boom" }), { status: 500 }),
      ),
    );
    expect(await fetchProgress("rag")).toEqual({});
  });

  it("returns {} when the network call throws (non-throwing)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("network down")),
    );
    expect(await fetchProgress("rag")).toEqual({});
  });

  it("returns {} immediately for an empty keyword (no fetch)", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect(await fetchProgress("")).toEqual({});
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

/* ------------------------------------------------------------------ */
/* setProgress                                                         */
/* ------------------------------------------------------------------ */

describe("setProgress", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("POSTs { updates } to /api/progress/{encoded keyword}", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await setProgress("rag", { "fccf4d91a6cd": "done" });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/progress/rag");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({
      updates: { "fccf4d91a6cd": "done" },
    });
    expect((init.headers as Record<string, string>)["Content-Type"]).toBe(
      "application/json",
    );
  });

  it("is a silent no-op (resolves) when the POST fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("network down")),
    );
    await expect(setProgress("rag", { a1: "done" })).resolves.toBeUndefined();
  });

  it("skips the request entirely for an empty updates map", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await setProgress("rag", {});
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("skips the request entirely for an empty keyword", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await setProgress("", { a1: "done" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
