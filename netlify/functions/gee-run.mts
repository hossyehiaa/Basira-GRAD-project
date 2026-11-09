/**
 * Basira — background GEE job function (Netlify, up to 15 minutes).
 *
 * POST /gee-run  { jobId, kind: "run" | "compare", ...payload }
 *   -> 202 immediately; the job runs in the background and stores its
 *      result in the Netlify Blobs store "gee-results" under `jobId`.
 *      The client polls GET /api/gee/result/{jobId} until done.
 *
 * Cold Earth Engine computation graphs can take 30-120 s — far beyond the
 * 26 s synchronous function limit — so heavy jobs MUST run here.
 */
import type { Config } from "@netlify/functions";
import { getStore } from "@netlify/blobs";
import { runClassification, compareAll, GEEError } from "../../src/lib/gee/engine";

export default async (req: Request) => {
  const url = new URL(req.url);
  if (req.method !== "POST" || url.pathname.split("/").pop() !== "gee-run") {
    return new Response("Method not allowed", { status: 405 });
  }

  let jobId = "unknown";
  try {
    const body = await req.json();
    if (body.probe === true) {
      // health-check ping — do not launch anything
      return new Response(null, { status: 200 });
    }
    jobId = String(body.jobId || "");
    if (!/^[a-zA-Z0-9_-]{6,64}$/.test(jobId)) {
      return new Response("bad jobId", { status: 400 });
    }
    const store = getStore("gee-results");
    const shared = {
      season: body.season ?? "winter",
      year: body.year ? Number(body.year) : undefined,
      dateFrom: body.dateFrom,
      dateTo: body.dateTo,
      cloudMax: body.cloudMax ? Number(body.cloudMax) : 60,
      rfTrees: body.rfTrees ? Number(body.rfTrees) : 100,
      kClusters: body.kClusters ? Number(body.kClusters) : 8,
      samplePoints: Array.isArray(body.samplePoints) ? body.samplePoints : [],
    };

    let payload: unknown;
    if (body.kind === "compare") {
      const res = await compareAll(shared);
      payload = { kind: "compare", ...res };
    } else {
      const result = await runClassification({
        ...shared,
        algorithm: body.algorithm,
        kind: "run",
      });
      payload = { kind: "run", result };
    }
    await store.set(jobId, JSON.stringify({ status: "done", ...payload }));
  } catch (e) {
    const code = e instanceof GEEError ? e.code : "job_failed";
    const message = String((e as Error)?.message || e).slice(0, 300);
    console.error("gee-run job error:", code, message);
    try {
      const store = getStore("gee-results");
      await store.set(jobId, JSON.stringify({ status: "error", error: code, message }));
    } catch {
      /* blobs unavailable — nothing else we can do */
    }
  }
  // Background functions must not return a body (client already got 202).
  return new Response(null, { status: 200 });
};

export const config: Config = {
  background: true,
  path: "/gee-run",
};
