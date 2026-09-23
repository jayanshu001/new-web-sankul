import { exec } from "child_process";
import os from "os";

// Load env vars
import dotenv from "dotenv";
dotenv.config();

const appName = process.env.PM2_APP_NAME || "websankul-prod-apis";
const minInstances = parseInt(process.env.MIN_INSTANCES || "2", 10);
const maxInstances = parseInt(process.env.MAX_INSTANCES || String(os.cpus().length * 2), 10);

setInterval(() => {
  const load = os.loadavg()[0]; // 1 minute load average
  const cpuCount = os.cpus().length;

  if (load > cpuCount * 0.8) {
    // Current load is high, consider scaling up
    exec(`pm2 info ${appName}`, (err, stdout) => {
      if (err) return;
      
      // Calculate active instances across standard PM2 output
      const activeInstances = (stdout.match(/online/g) || []).length;
      
      if (activeInstances < maxInstances) {
        exec(`pm2 scale ${appName} +1`, () => console.log(`[AutoScale] Scaled up by 1. Total: ${activeInstances + 1}`));
      }
    });
  } else if (load < cpuCount * 0.3) {
    // Current load is low, consider scaling down
    exec(`pm2 info ${appName}`, (err, stdout) => {
      if (err) return;

      const activeInstances = (stdout.match(/online/g) || []).length;
      
      if (activeInstances > minInstances) {
        exec(`pm2 scale ${appName} -1`, () => console.log(`[AutoScale] Scaled down by 1. Total: ${activeInstances - 1}`));
      }
    });
  }
}, 10000);
