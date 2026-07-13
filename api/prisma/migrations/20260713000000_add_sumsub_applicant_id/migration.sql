-- AlterTable
ALTER TABLE "kyc_profiles" ADD COLUMN "sumsubApplicantId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "kyc_profiles_sumsubApplicantId_key" ON "kyc_profiles"("sumsubApplicantId");
