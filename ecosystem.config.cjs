/**
 * PM2 process topology for production:
 *
 *   websankul-api    — HTTP + WebSockets; WORKER_ENABLED=false (no BullMQ in API replicas)
 *   websankul-worker — BullMQ workers only; HTTP_SERVER_ENABLED=false (no HTTP listener)
 *
 * Local single-process dev uses `yarn dev` (tsx). To run both PM2 apps locally:
 *   yarn build && pm2 start ecosystem.config.cjs
 *
 * Production:
 *   yarn deploy:prod
 *   # or: pm2 reload ecosystem.config.cjs --env production
 */
module.exports = {
  apps: [
    {
      name: process.env.PM2_API_NAME || "websankul-api",
      script: "dist/index.js",
      instances: Number(process.env.API_INSTANCES) || 2,
      exec_mode: "cluster",
      watch: false,
      max_memory_restart: process.env.API_MAX_MEMORY || "512M",
      wait_ready: true,
      listen_timeout: Number(process.env.PM2_LISTEN_TIMEOUT_MS) || 45_000,
      kill_timeout: Number(process.env.PM2_KILL_TIMEOUT_MS) || 40_000,
      env: {
        NODE_ENV: "development",
        WORKER_ENABLED: "false",
        HTTP_SERVER_ENABLED: "true",
        LOG_LEVEL: "debug",
        DEPLOY_PROFILE: "api",
      },
      env_staging: {
        NODE_ENV: "staging",
        WORKER_ENABLED: "false",
        HTTP_SERVER_ENABLED: "true",
        LOG_LEVEL: "info",
        DEPLOY_PROFILE: "api",
      },
      env_production: {
        NODE_ENV: "production",
        WORKER_ENABLED: "false",
        HTTP_SERVER_ENABLED: "true",
        LOG_LEVEL: "info",
        DEPLOY_PROFILE: "api",
      },
    },
    {
      name: process.env.PM2_WORKER_NAME || "websankul-worker",
      script: "dist/index.js",
      instances: 1,
      exec_mode: "fork",
      watch: false,
      max_memory_restart: process.env.WORKER_MAX_MEMORY || "768M",
      wait_ready: true,
      listen_timeout: Number(process.env.PM2_LISTEN_TIMEOUT_MS) || 45_000,
      kill_timeout: Number(process.env.PM2_KILL_TIMEOUT_MS) || 40_000,
      env: {
        NODE_ENV: "development",
        WORKER_ENABLED: "true",
        HTTP_SERVER_ENABLED: "false",
        LOG_LEVEL: "debug",
        DEPLOY_PROFILE: "worker",
      },
      env_staging: {
        NODE_ENV: "staging",
        WORKER_ENABLED: "true",
        HTTP_SERVER_ENABLED: "false",
        LOG_LEVEL: "info",
        DEPLOY_PROFILE: "worker",
      },
      env_production: {
        NODE_ENV: "production",
        WORKER_ENABLED: "true",
        HTTP_SERVER_ENABLED: "false",
        LOG_LEVEL: "info",
        DEPLOY_PROFILE: "worker",
      },
    },
  ],
};
