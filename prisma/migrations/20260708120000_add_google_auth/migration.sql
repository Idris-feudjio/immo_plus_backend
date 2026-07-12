-- AlterTable: make passwordHash nullable for Google-only accounts
ALTER TABLE "users" ALTER COLUMN "passwordHash" DROP NOT NULL;

-- AlterTable: add google_id column for Google OAuth linking
ALTER TABLE "users" ADD COLUMN "google_id" TEXT;

-- CreateIndex: unique constraint on google_id
CREATE UNIQUE INDEX "users_google_id_key" ON "users"("google_id");
