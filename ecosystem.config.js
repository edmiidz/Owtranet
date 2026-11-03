// PM2 processes for one Owtranet instance:  sudo pm2 start ecosystem.config.js && sudo pm2 save
// Only `owtranet` is required; the rest are optional workers — delete the ones you don't use.
module.exports = {
  apps: [
    {
      name: 'owtranet',
      script: './server.js',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_memory_restart: '1G',
      env: {
        NODE_ENV: 'production',
        PORT: 3006
      },
      error_file: './logs/err.log',
      out_file: './logs/out.log',
      log_file: './logs/combined.log',
      time: true
    },
    {
      name: 'owtranet-email-processor',
      script: './email-receipt-processor.js',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_memory_restart: '256M',
      restart_delay: 5000,
      error_file: './logs/email-processor-err.log',
      out_file: './logs/email-processor-out.log',
      log_file: './logs/email-processor-combined.log',
      time: true
    },
    {
      name: 'owtranet-exchange-rates',
      script: './scripts/fetch-exchange-rates.js',
      cron_restart: '0 2 * * *', // Run at 2 AM daily
      autorestart: false, // Don't restart after completion
      instances: 1,
      exec_mode: 'fork',
      max_memory_restart: '128M',
      error_file: './logs/exchange-rates-err.log',
      out_file: './logs/exchange-rates-out.log',
      log_file: './logs/exchange-rates-combined.log',
      time: true
    },
    {
      name: 'owtranet-auto-approve',
      script: './server/cron/autoApproveDeliverables.js',
      args: '--apply',
      cron_restart: '0 3 * * *', // 3 AM daily — approve deliverables pending >= 6 weeks
      autorestart: false,
      instances: 1,
      exec_mode: 'fork',
      max_memory_restart: '128M',
      error_file: './logs/auto-approve-err.log',
      out_file: './logs/auto-approve-out.log',
      time: true
    },
    {
      // Corporate Radio Station — Layer 1: pre-generates TTS-friendly
      // summaries of intranet posts so the mobile app's feed is always ready.
      name: 'owtranet-radio-worker',
      script: './server/cron/radioWorker.js',
      args: '--apply --daemon',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      restart_delay: 10000,
      max_memory_restart: '256M',
      error_file: './logs/radio-worker-err.log',
      out_file: './logs/radio-worker-out.log',
      time: true
    },
    {
      // Mobile push dispatcher — tails notifications / DMs / group
      // messages and sends Expo push notifications to registered devices.
      name: 'owtranet-push-dispatcher',
      script: './server/cron/pushDispatcher.js',
      args: '--apply --daemon',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      restart_delay: 10000,
      max_memory_restart: '128M',
      error_file: './logs/push-dispatcher-err.log',
      out_file: './logs/push-dispatcher-out.log',
      time: true
    },
    {
      // GitHub doc sweep — mirrors markdown docs from the repos configured in
      // Admin → Search Adapters into `github_docs` so intranet search can find
      // them. Indexes title/excerpt/body text only; the documents themselves
      // stay in GitHub. Needs GITHUB_DOCS_TOKEN (or GITHUB_TOKEN) in .env.
      name: 'owtranet-doc-sweep',
      script: './server/cron/sweepGithubDocs.js',
      args: '--apply',
      cron_restart: '30 4 * * *', // 4:30 AM daily
      autorestart: false,
      instances: 1,
      exec_mode: 'fork',
      max_memory_restart: '256M',
      error_file: './logs/doc-sweep-err.log',
      out_file: './logs/doc-sweep-out.log',
      time: true
    },
    {
      // Hosted MCP (Streamable HTTP) exposing webmail read/search/draft tools to
      // ElevenLabs agents. nginx: https://intranet.example.com/mcp/webmail -> :3010.
      // Config lives in ./mcp-webmail/.env (not in git). See mcp-webmail/README.md.
      name: 'owtranet-webmail-mcp',
      script: './mcp-webmail/http.js',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      restart_delay: 5000,
      max_memory_restart: '128M',
      error_file: './logs/webmail-mcp-err.log',
      out_file: './logs/webmail-mcp-out.log',
      time: true
    },
    {
      // Scheduled webmail sends — polls scheduled_emails every 30 s
      // and sends rows whose time has come through the normal webmail SMTP path.
      // Needs server/migrations/add_scheduled_emails.sql applied first.
      name: 'owtranet-scheduled-mail',
      script: './server/cron/scheduledEmailSender.js',
      args: '--apply --daemon',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      restart_delay: 10000,
      max_memory_restart: '128M',
      error_file: './logs/scheduled-mail-err.log',
      out_file: './logs/scheduled-mail-out.log',
      time: true
    }
  ]
};
