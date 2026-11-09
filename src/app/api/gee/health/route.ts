// Basira — GEE health/status: is live mode available and which job mode?
import { NextRequest, NextResponse } from "next/server";
import { getEE, isGEEConfigured } from "@/lib/gee/engine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (!isGEEConfigured()) {
    return NextResponse.json({ ok: false, mode: "demo" });
  }
  try {
    await getEE();
    // The background function /gee-run answers 202 to any request when it is
    // deployed (Netlify accepts the job and returns immediately). Probing it
    // is more reliable than checking process.env, which the Next runtime
    // does not always expose.
    let jobs: "background" | "sync" = "sync";
    try {
      const proto = req.headers.get("x-forwarded-proto") ?? "https";
      const host = req.headers.get("host");
      if (host) {
        // Background functions answer 202 to POST only; the probe flag makes
        // the invoked function no-op instead of launching a real GEE job.
        const r = await fetch(`${proto}://${host}/gee-run`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ jobId: "healthprobe0", probe: true }),
          redirect: "manual",
        });
        if (r.status === 202) jobs = "background";
      }
    } catch {
      /* probe failed — stay on the synchronous path */
    }
    return NextResponse.json({ ok: true, mode: "live", jobs });
  } catch (e) {
    return NextResponse.json({
      ok: false,
      mode: "demo",
      error: String((e as Error)?.message || e).slice(0, 300),
    });
  }
}
