-- AlterTable
ALTER TABLE "Conversation" ADD COLUMN     "title" TEXT NOT NULL DEFAULT 'New conversation',
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "Message" ADD COLUMN     "sources" JSONB;

