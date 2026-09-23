import os from "os";
import type { NetworkInterfaceInfo } from "os";

const getLocalIpAddress = (): string => {
  const nets = os.networkInterfaces();

  for (const addrs of Object.values(nets)) {
    if (!addrs) continue; // value can be undefined
    for (const addr of addrs) {
      // In some Node type defs family is 'IPv4'|'IPv6', in older it's 4|6
      const family = addr.family as unknown;
      if ((family === "IPv4" || family === 4) && !addr.internal) {
        return addr.address;
      }
    }
  }

  // Fallback if no external IPv4 found
  return "127.0.0.1";
}; 

export default getLocalIpAddress;
