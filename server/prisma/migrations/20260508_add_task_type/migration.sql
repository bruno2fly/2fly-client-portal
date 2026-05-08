-- Add taskType column to ProductionTask for distinguishing demands from briefs
ALTER TABLE "ProductionTask" ADD COLUMN "taskType" TEXT NOT NULL DEFAULT 'demand';
