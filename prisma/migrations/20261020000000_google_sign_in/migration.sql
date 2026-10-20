-- Sign in with Google: link a local account to a Google account id.
ALTER TABLE "User" ADD COLUMN "googleSub" TEXT;

CREATE UNIQUE INDEX "User_googleSub_key" ON "User"("googleSub");
