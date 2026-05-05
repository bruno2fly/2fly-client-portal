-- AlterTable: make clientId and designerId optional on ProductionTask
ALTER TABLE "ProductionTask" ALTER COLUMN "clientId" DROP NOT NULL;
ALTER TABLE "ProductionTask" ALTER COLUMN "designerId" SET DEFAULT '';
ALTER TABLE "ProductionTask" ALTER COLUMN "designerId" DROP NOT NULL;
