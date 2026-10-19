-- AlterTable
ALTER TABLE "User" ADD COLUMN "tokenVersion" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "User" ADD COLUMN "recoveryHash" TEXT;

-- AlterTable
ALTER TABLE "Deck" ADD COLUMN "cardLanguage" TEXT NOT NULL DEFAULT 'auto';
ALTER TABLE "Deck" ADD COLUMN "ocrLanguage" TEXT NOT NULL DEFAULT 'eng';
ALTER TABLE "Deck" ADD COLUMN "figures" TEXT;

-- AlterTable
ALTER TABLE "DeckChunk" ADD COLUMN "summary" TEXT;

-- AlterTable
ALTER TABLE "Card" ADD COLUMN "imageUrl" TEXT;

-- AlterTable
ALTER TABLE "UserSettings" ADD COLUMN "readAloud" BOOLEAN NOT NULL DEFAULT false;
