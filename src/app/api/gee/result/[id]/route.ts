// Basira — poll a background GEE job result from Netlify Blobs.
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  if (!id || !/^[a-zA-Z0-9_-]{6,64}$/.test(id)) {
    return NextResponse.json({ error: "bad_id" }, { status: 400 });
  }
  try {
    // Netlify Blobs is available on the deployed site; locally this route is
    // never polled (dev uses the sync /api/gee/run route).
    const { getStore } = await import("@netlify/blobs");
    const store = getStore("gee-results");
    const raw = await store.get(id);
    if (!raw) return NextResponse.json({ status: "pending" });
    const data = JSON.parse(raw);
    if (data.status === "error") {
      return NextResponse.json({ status: "error", error: data.error, message: data.message });
    }
    return NextResponse.json({ status: "done", ...data });
  } catch (e) {
    // Blobs unavailable (e.g. local dev) — treat as pending so the client
    // can fall back to the sync path.
    return NextResponse.json({ status: "pending", unavailable: true });
  }
}
