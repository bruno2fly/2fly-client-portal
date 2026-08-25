-- NOTE: `prisma migrate dev` also generated a drop/re-add of the unrelated
-- ProductionTask_clientId_fkey constraint. That is PRE-EXISTING drift between the
-- committed migrations and schema.prisma — not part of this feature. Both
-- statements were removed on purpose so this migration is purely additive and
-- cannot touch the legacy pipeline. Do not re-add them here.

-- AlterTable
ALTER TABLE "AutomatedContentPost" ADD COLUMN     "source" TEXT NOT NULL DEFAULT 'sheet';
