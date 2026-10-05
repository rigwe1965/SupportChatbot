-- AlterTable
ALTER TABLE "Message" ADD COLUMN     "feedbackReviewedAt" TIMESTAMP(3);


-- Speeds up the admin review queue
CREATE INDEX "Message_feedback_feedbackAt_idx" ON "Message"("feedback", "feedbackAt");
