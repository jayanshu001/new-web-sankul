import { prisma } from "../src/config/prisma";
import { materialMediaToken } from "../src/modules/client-material/client-material.service";
import { resolveMediaToken } from "../src/modules/client-media/client-media.service";
(async () => {
  // a free material with a file, and a paid one, to exercise both paths
  const free: any[] = await prisma.$queryRawUnsafe("SELECT id, is_paid, LEFT(file,80) f, LEFT(direct_link,80) dl FROM ws_material WHERE status=1 AND is_paid=0 AND ((file IS NOT NULL AND file<>'') OR (direct_link IS NOT NULL AND direct_link<>'')) LIMIT 1");
  const paid: any[] = await prisma.$queryRawUnsafe("SELECT id, is_paid FROM ws_material WHERE status=1 AND is_paid=1 LIMIT 1");
  const CUST = 472335; // staging test customer (memory)
  for (const [label, row] of [["FREE", free[0]], ["PAID", paid[0]]] as any[]) {
    if (!row) { console.log(label, "— none found"); continue; }
    const tok = materialMediaToken(row.id, true, !!row.is_paid, CUST);
    console.log(`\n${label} material #${row.id} is_paid=${row.is_paid}`);
    console.log("  token:", tok ? tok.slice(0, 32) + "..." : null);
    if (tok) {
      const r = await resolveMediaToken(tok, CUST);
      console.log("  resolve:", r.ok ? `OK kind=${r.kind} media=${JSON.stringify(r.media).slice(0,120)}` : `FAIL ${r.status} ${r.message}`);
    }
  }
  await prisma.$disconnect();
})().catch(async e => { console.error(e); await prisma.$disconnect(); process.exit(1); });
