export type ApiResponse<T> = { data: T; error?: never } | { data?: never; error: string };

export type ChatRole = "user" | "assistant" | "system";

export interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  createdAt: string;
}
