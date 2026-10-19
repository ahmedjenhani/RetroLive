-- AlterTable
ALTER TABLE "User" ADD COLUMN     "isDemo" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "User_isDemo_createdAt_idx" ON "User"("isDemo", "createdAt");
