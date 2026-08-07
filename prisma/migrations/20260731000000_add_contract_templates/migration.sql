-- CreateEnum
CREATE TYPE "ContractSection" AS ENUM ('PARTIES', 'PROPERTY', 'RENT', 'DURATION', 'SIGNATURE_DATE');

-- CreateTable
CREATE TABLE "contract_templates" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "lockedSections" "ContractSection"[] DEFAULT ARRAY[]::"ContractSection"[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contract_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contract_template_clauses" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "order" SMALLINT NOT NULL,

    CONSTRAINT "contract_template_clauses_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "contract_templates" ADD CONSTRAINT "contract_templates_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "agencies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_template_clauses" ADD CONSTRAINT "contract_template_clauses_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "contract_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;
