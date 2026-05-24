import 'reflect-metadata';
import 'dotenv/config';
import * as mongoose from 'mongoose';

const OLD_INDEX_NAME = 'campaignId_1_content.meta.id_1';
const NEW_INDEX_SPEC = { campaignId: 1, 'content.meta.hiddenId': 1 } as const;

async function run() {
  const mongoUrl = process.env.MONGO_URL ?? process.env.MONGODB_URI ?? 'mongodb://localhost:27017/robco';

  try {
  await mongoose.connect(mongoUrl);
  } catch (e) {
    const err = e as { message?: string };
    console.error(`[connect] failed to connect to Mongo: ${err.message}`);
    throw e;
  }
  const db = mongoose.connection.db;
  if (!db) throw new Error('Mongo connection has no db handle');

  const terminals = db.collection('terminals');

  const totalBefore = await terminals.countDocuments({});
  const withOldFieldBefore = await terminals.countDocuments({ 'content.meta.id': { $exists: true } });
  const withNewFieldBefore = await terminals.countDocuments({ 'content.meta.hiddenId': { $exists: true } });
  console.log(`[before] total=${totalBefore} content.meta.id=${withOldFieldBefore} content.meta.hiddenId=${withNewFieldBefore}`);

  const renameRes = await terminals.updateMany({}, { $rename: { 'content.meta.id': 'content.meta.hiddenId' } });
  console.log(`[$rename] matched=${renameRes.matchedCount} modified=${renameRes.modifiedCount}`);

  try {
    await terminals.dropIndex(OLD_INDEX_NAME);
    console.log(`[index] dropped ${OLD_INDEX_NAME}`);
  } catch (e) {
    const err = e as { codeName?: string; message?: string };
    if (err.codeName === 'IndexNotFound') {
      console.log(`[index] ${OLD_INDEX_NAME} not present — skipped`);
    } else {
      throw e;
    }
  }

  try {
    await terminals.createIndex(NEW_INDEX_SPEC, {
      unique: true,
      partialFilterExpression: { 'content.meta.hiddenId': { $type: 'string' } },
    });
    console.log('[index] ensured (campaignId, content.meta.hiddenId) unique (partial: hiddenId is string)');
  } catch (e) {
    const err = e as { message?: string };
    console.error(`[index] failed to create new unique index: ${err.message}`);
    throw e;
  }

  const totalAfter = await terminals.countDocuments({});
  const withOldFieldAfter = await terminals.countDocuments({ 'content.meta.id': { $exists: true } });
  const withNewFieldAfter = await terminals.countDocuments({ 'content.meta.hiddenId': { $exists: true } });
  console.log(`[after] total=${totalAfter} content.meta.id=${withOldFieldAfter} content.meta.hiddenId=${withNewFieldAfter}`);

  await mongoose.disconnect();
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
