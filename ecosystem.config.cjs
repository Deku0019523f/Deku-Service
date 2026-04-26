// ecosystem.config.cjs
module.exports = {
  apps: [
    {
      name: 'wa-saas-bot',
      script: 'src/index.js',
      interpreter: 'node',
      interpreter_args: '--experimental-vm-modules',
      instances: 1,           // Single instance (WhatsApp sessions are in-memory)
      autorestart: true,
      watch: false,
      max_memory_restart: '512M',
      restart_delay: 5000,
      max_restarts: 10,

      env: {
        NODE_ENV: 'production',
        LOG_LEVEL: 'info',
      },

      env_development: {
        NODE_ENV: 'development',
        LOG_LEVEL: 'debug',
      },

      // Logging
      log_file: 'logs/combined.log',
      out_file: 'logs/out.log',
      error_file: 'logs/error.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      merge_logs: true,

      // Graceful shutdown
      kill_timeout: 10000,
      listen_timeout: 10000,

      // Cron restart at 4AM (optional, helps clear memory leaks)
      cron_restart: '0 4 * * *',
    },
  ],
};
