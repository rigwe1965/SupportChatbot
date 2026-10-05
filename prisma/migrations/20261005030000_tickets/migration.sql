-- CreateEnum
CREATE TYPE "TicketStatus" AS ENUM ('OPEN', 'RESOLVED');

-- CreateEnum
CREATE TYPE "EscalationReason" AS ENUM ('HUMAN_REQUESTED', 'LOW_CONFIDENCE', 'REPEATED_FAILURES');

-- AlterTable
ALTER TABLE "Message" ADD COLUMN     "lowConfidence" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "Ticket" (
    "id" TEXT NOT NULL,
    "status" "TicketStatus" NOT NULL DEFAULT 'OPEN',
    "reason" "EscalationReason" NOT NULL,
    "question" TEXT NOT NULL,
    "lastAnswer" TEXT,
    "transcript" JSONB NOT NULL,
    "userId" TEXT,
    "userName" TEXT,
    "userEmail" TEXT,
    "conversationId" TEXT,
    "slackPostedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "Ticket_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Ticket_status_createdAt_idx" ON "Ticket"("status", "createdAt");

-- CreateIndex
CREATE INDEX "Ticket_conversationId_idx" ON "Ticket"("conversationId");

-- AddForeignKey
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- At most one open ticket per conversation (also guards against concurrent escalations)
CREATE UNIQUE INDEX "Ticket_conversationId_open_key" ON "Ticket"("conversationId") WHERE "status" = 'OPEN';
