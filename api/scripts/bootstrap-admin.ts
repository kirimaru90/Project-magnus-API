import 'reflect-metadata';
import * as mongoose from 'mongoose';
import * as bcrypt from 'bcrypt';

const BCRYPT_ROUNDS = 12;

const UserSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  passwordHash: { type: String, required: true },
  role: { type: String, required: true },
  createdAt: { type: Date, default: Date.now },
});

async function run() {
  const mongoUrl = process.env.MONGO_URL ?? 'mongodb://localhost:27017/robco';
  const username = process.env.BOOTSTRAP_ADMIN_USERNAME;
  const password = process.env.BOOTSTRAP_ADMIN_PASSWORD;

  if (!username || !password) {
    console.error('BOOTSTRAP_ADMIN_USERNAME and BOOTSTRAP_ADMIN_PASSWORD must be set');
    process.exit(1);
  }

  await mongoose.connect(mongoUrl);
  const User = mongoose.model('User', UserSchema);

  const existing = await User.findOne({ username }).lean();
  if (existing) {
    console.log(`Admin user "${username}" already exists — skipping.`);
    await mongoose.disconnect();
    return;
  }

  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  await User.create({ username, passwordHash, role: 'admin' });
  console.log(`Admin user "${username}" created.`);
  await mongoose.disconnect();
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
