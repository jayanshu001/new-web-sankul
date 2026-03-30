module.exports = {
  apps: [
    {
      name: process.env.PM2_APP_NAME || "websankul-prod-apis",
      script: "dist/index.js",
      instances: process.env.MIN_INSTANCES || 2,
      exec_mode: "cluster",
      watch: false,
      max_memory_restart: "300M",
      wait_ready: true,
      listen_timeout: 10000,
      env: {
        NODE_ENV: "development",
      },
      env_production: {
        NODE_ENV: "production",
      },
      env_staging: {
        NODE_ENV: "staging",
      },
    },
  ],
};
