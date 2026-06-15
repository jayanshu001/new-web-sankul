import "dotenv/config";
import mongoose from "mongoose";
import connectDB from "../src/config/db";
import * as svc from "../src/admin/package/package.service";
import { PackageCourseEbookPrice } from "../src/models/course/PackageCourseEbookPrice.model";

async function main(){
  await connectDB();
  const dead = await PackageCourseEbookPrice.findOne({ status:false, packageId: { $ne: null } }).lean() as any;
  if (!dead) { console.log("RESULT: no soft-detached package plan to test against"); await mongoose.disconnect(); return; }
  const pkgId = String(dead.packageId);
  const all = await PackageCourseEbookPrice.find({ packageId: pkgId }).select("name status").lean();
  const listed = await svc.listPackagePlans(pkgId) as any[];
  const leaked = listed.some((p:any)=>p.status===false);
  console.log("RESULT package:", pkgId);
  console.log("RESULT raw rows:", all.map((p:any)=>`${p.name}=${p.status}`).join(", "));
  console.log("RESULT listed   :", listed.map((p:any)=>`${p.name}=${p.status}`).join(", "));
  console.log("RESULT", leaked ? "FAIL status:false leaking" : "PASS status:false excluded");
  await mongoose.disconnect();
}
main().catch(e=>{console.error("RESULT ERR", e?.message??e);process.exit(1);});
