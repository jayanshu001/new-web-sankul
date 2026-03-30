import os from "os";
import { exec } from "child_process";

// Load env vars
import dotenv from "dotenv";
dotenv.config();

const appName = process.env.PM2_APP_NAME || "websankul-prod-apis";
const cpuThreshold = 80; // %
const checkInterval = 10000; // 10 seconds

function getAverageCPU(): number {
  const cpus = os.cpus();
  let totalIdle = 0, totalTick = 0;
  
  cpus.forEach((core) => {
    for (const type in core.times) {
      totalTick += (core.times as any)[type];
    }
    totalIdle += core.times.idle;
  });
  
  const idle = totalIdle / cpus.length;
  const total = totalTick / cpus.length;
  return 100 - (100 * idle) / total;
}

setInterval(() => {
  const cpuLoad = getAverageCPU();
  
  if (cpuLoad > cpuThreshold) {
    console.log(`[CPU Monitor] CPU load ${cpuLoad.toFixed(1)}% > ${cpuThreshold}%. Restarting ${appName}...`);
    exec(`pm2 restart ${appName}`, (err) => {
      if (err) console.error("[PM2] restart error:", err.message);
    });
  } else {
    if (process.env.ENV === "DEV") {
      console.log(`[CPU Monitor] OK: ${cpuLoad.toFixed(1)}%`);
    }
  }
}, checkInterval);
