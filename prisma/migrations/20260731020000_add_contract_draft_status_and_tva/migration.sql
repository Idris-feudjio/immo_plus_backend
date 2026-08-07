-- AlterEnum
ALTER TYPE "ContractStatus" ADD VALUE 'DRAFT';

-- AlterTable
ALTER TABLE "contracts" ADD COLUMN     "tvaRate" DOUBLE PRECISION NOT NULL DEFAULT 19.25,
ADD COLUMN     "tvaAmount" INTEGER NOT NULL DEFAULT 0;

-- Backfill: rows created before this migration get tvaAmount = 0 from the column default,
-- which getPdfUrl() now trusts as-is (it used to recompute from rent on every call).
-- Without this, PDF (re)generation for any pre-existing contract would silently understate
-- rentTTC by the full TVA amount.
UPDATE "contracts" SET "tvaAmount" = ROUND("rent" * 19.25 / 100)::integer WHERE "tvaAmount" = 0;
