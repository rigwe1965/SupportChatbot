-- CreateEnum
CREATE TYPE "Feedback" AS ENUM ('UP', 'DOWN');

-- AlterTable
ALTER TABLE "Message" ADD COLUMN     "feedback" "Feedback",
ADD COLUMN     "feedbackAt" TIMESTAMP(3),
ADD COLUMN     "feedbackComment" TEXT;

