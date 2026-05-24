# API scripts

One-shot maintenance scripts for the MAGNUS API.

All scripts read `MONGO_URL` (falling back to `MONGODB_URI`) for the database connection, matching the runtime.

## bootstrap-admin

Create an initial admin user.

```bash
BOOTSTRAP_ADMIN_USERNAME=admin BOOTSTRAP_ADMIN_PASSWORD=changeme \
  npx ts-node -r tsconfig-paths/register api/scripts/bootstrap-admin.ts
```

## migrate-hidden-id

One-shot migration for the `meta.id` → `meta.hiddenId` rename. Run **before** deploying the new app image, otherwise:

- old `meta.id` writes collide with the new `(campaignId, content.meta.hiddenId)` unique index, and
- reads surface `hiddenId: undefined` for unmigrated docs.

The script is idempotent: `$rename` is a no-op on already-renamed docs; the old index drop is wrapped in try/ignore-if-missing; the new index is created with `unique: true` plus `partialFilterExpression: { 'content.meta.hiddenId': { $type: 'string' } }`, so terminals without a `hiddenId` are excluded from the uniqueness constraint.

```bash
MONGO_URL=mongodb://localhost:27017/robco \
  npx ts-node -r tsconfig-paths/register api/scripts/migrate-hidden-id.ts
```

The script logs counts of `content.meta.id` and `content.meta.hiddenId` before and after, plus the `$rename` matched/modified counts.

**Rollback.** Revert the deployment, then run a reverse migration: `$rename` `hiddenId` → `id`, drop the new index, recreate the old one.
