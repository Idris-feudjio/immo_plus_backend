-- Normalize all existing user emails to lowercase (idempotent: only updates mixed-case rows)
UPDATE "users" SET email = LOWER(email) WHERE email != LOWER(email);
