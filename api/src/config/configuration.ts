export default () => ({
  port: parseInt(process.env.PORT ?? '3000', 10),
  mongoUrl: process.env.MONGO_URL ?? 'mongodb://localhost:27017/robco',
  jwtSecret: process.env.JWT_SECRET ?? 'change-me-in-production',
  corsAllowedOrigins: (process.env.CORS_ALLOWED_ORIGINS ?? '')
    .split(',')
    .filter(Boolean),
  bootstrap: {
    adminUsername: process.env.BOOTSTRAP_ADMIN_USERNAME,
    adminPassword: process.env.BOOTSTRAP_ADMIN_PASSWORD,
  },
  terminals: {
    countAdminViews: process.env.TERMINAL_COUNT_ADMIN_VIEWS === 'true',
  },
});
