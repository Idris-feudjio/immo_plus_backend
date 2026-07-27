/*
  Warnings:

  - Added the required column `gender` to the `applications` table without a default value. This is not possible if the table is not empty.
  - Added the required column `nationalIdNumber` to the `applications` table without a default value. This is not possible if the table is not empty.
  - Added the required column `userId` to the `applications` table without a default value. This is not possible if the table is not empty.
  - Made the column `phone` on table `applications` required. This step will fail if there are existing NULL values in that column.

*/
-- CreateEnum
CREATE TYPE "Gender" AS ENUM ('MALE', 'FEMALE');

-- AlterTable
ALTER TABLE "applications" ADD COLUMN     "attachments" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "gender" "Gender" NOT NULL,
ADD COLUMN     "nationalIdNumber" VARCHAR(50) NOT NULL,
ADD COLUMN     "userId" TEXT NOT NULL,
ALTER COLUMN "phone" SET NOT NULL;

-- CreateIndex
CREATE INDEX "applications_userId_propertyId_status_idx" ON "applications"("userId", "propertyId", "status");

-- AddForeignKey
ALTER TABLE "applications" ADD CONSTRAINT "applications_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
