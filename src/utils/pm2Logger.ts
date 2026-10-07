export const pm2Ready = () => {
  if (process.send) {
    process.send("ready");
    if (process.env.ENV === "DEV") {
      console.log("pm2 ready signal sent.");
    }
  }
};
