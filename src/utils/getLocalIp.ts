// Local IP: first non-internal IPv4 address of this host.
import os from "os";
import type { NetworkInterfaceInfo } from "os";

const getLocalIpAddress = (): string => {
  const nets = os.networkInterfaces();

  for (const addrs of Object.values(nets)) {
    if (!addrs) continue;
    for (const addr of addrs) {
      // Older Node versions report family as 4|6.
      const family = addr.family as unknown;
      if ((family === "IPv4" || family === 4) && !addr.internal) {
        return addr.address;
      }
    }
  }

  return "127.0.0.1";
}; 

export default getLocalIpAddress;
