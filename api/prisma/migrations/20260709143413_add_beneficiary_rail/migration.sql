-- CreateEnum
CREATE TYPE "beneficiary_rail" AS ENUM ('bank', 'mobile_money');

-- AlterTable
ALTER TABLE "beneficiaries" ADD COLUMN     "rail" "beneficiary_rail" NOT NULL DEFAULT 'bank';
