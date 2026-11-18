// PM2 (VPS sem container): pm2 start ecosystem.config.cjs --env production
// Requer `npm ci` em packages/contracts e apps/api e `npm run db:setup` já executado.
// As variáveis vêm do .env.prod da raiz do repositório via --env-file do Node (fora do git; modelo em .env.prod.example).
module.exports = {
  apps: [
    {
      name: 'vizinhohub-api',
      cwd: './apps/api',
      script: 'src/server.ts',
      interpreter: 'node',
      // tsx como loader do Node (a API roda TypeScript direto) + variáveis do arquivo de produção.
      node_args: ['--import', 'tsx', '--env-file=../../.env.prod'],
      env_production: { NODE_ENV: 'production', TZ: 'America/Fortaleza' },
      autorestart: true,
      max_restarts: 10,
      restart_delay: 3000,
      kill_timeout: 10000, // a API fecha conexões e o pool no SIGTERM
      time: true,
      out_file: './logs/api.out.log',
      error_file: './logs/api.err.log',
      merge_logs: true,
    },
  ],
}
