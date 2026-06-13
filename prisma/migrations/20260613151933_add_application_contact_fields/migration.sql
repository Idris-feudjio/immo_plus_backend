/*
  Warnings:

  - Added the required column `email` to the `applications` table without a default value. This is not possible if the table is not empty.
  - Added the required column `firstName` to the `applications` table without a default value. This is not possible if the table is not empty.
  - Added the required column `lastName` to the `applications` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "applications" ADD COLUMN     "email" VARCHAR(255) NOT NULL,
ADD COLUMN     "firstName" VARCHAR(100) NOT NULL,
ADD COLUMN     "lastName" VARCHAR(100) NOT NULL,
ADD COLUMN     "phone" VARCHAR(20);
