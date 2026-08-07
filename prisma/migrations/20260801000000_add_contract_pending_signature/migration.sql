-- AlterEnum
ALTER TYPE "ContractStatus" ADD VALUE 'PENDING_SIGNATURE';

-- AlterTable
ALTER TABLE "contracts" ADD COLUMN     "signatureToken" TEXT,
ADD COLUMN     "signatureTokenExpiresAt" TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX "contracts_signatureToken_key" ON "contracts"("signatureToken");
