export const pm2Ready = () => {
  if (process.send) {
    // Send pm2 ready signal specifically in cluster mode
    process.send("ready");
    if (process.env.ENV === "DEV") {
      console.log("pm2 ready signal sent.");
    }
  }
};
