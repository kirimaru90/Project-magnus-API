// Prevent BootstrapService from auto-creating admin during e2e tests.
// Must run before ConfigModule.forRoot reads the .env file; dotenv
// does not override env vars that are already set in process.env.
process.env.BOOTSTRAP_ADMIN_USERNAME = '';
process.env.BOOTSTRAP_ADMIN_PASSWORD = '';
