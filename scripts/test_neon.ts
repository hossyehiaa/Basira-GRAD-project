// Test Neon serverless driver connectivity + PostGIS from the sandbox.
// Tries the exact connection string first, then a stripped variant
// (sslmode/channel_binding are libpq params the HTTP driver may reject).
import { neon } from "@neondatabase/serverless";

const RAW =
  "postgresql://neondb_owner:npg_da8khTqzypf4@ep-delicate-thunder-beqnk3a0-pooler.c-9.us-east-2.aws.neon.tech/neondb?sslmode=require&channel_binding=require";

function stripParams(url: string): string {
  return url
    .replace(/[?&]channel_binding=[^&]*/g, "")
    .replace(/[?&]sslmode=[^&]*/g, "");
    // .replace("?&", "?") handled below
}

async function tryUrl(label: string, url: string) {
  try {
    const sql = neon(url);
    const r = await sql`SELECT version() AS v, current_database() AS db`;
    console.log(`[${label}] CONNECTED:`, r[0].db, "|", String(r[0].v).slice(0, 60));
    // PostGIS availability
    try {
      await sql`CREATE EXTENSION IF NOT EXISTS postgis`;
      const g = await sql`SELECT PostGIS_Version() AS v`;
      console.log(`[${label}] PostGIS:`, g[0].v);
    } catch (e) {
      console.log(`[${label}] PostGIS FAILED:`, String(e).slice(0, 160));
    }
    return true;
  } catch (e) {
    console.log(`[${label}] FAILED:`, String(e).slice(0, 200));
    return false;
  }
}

async function main() {
  const ok1 = await tryUrl("raw", RAW);
  if (!ok1) await tryUrl("stripped", stripParams(RAW));
}
main();
