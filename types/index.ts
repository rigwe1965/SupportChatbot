export type ApiResponse<T> = { data: T; error?: never } | { data?: never; error: string };

export type ChatRole = "user" | "assistant" | "system";

export interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  sources?: Source[];
  /** Set client-side when a reply failed or was cut off. */
  error?: string;
}

export interface Source {
  /** 1-based number the model uses to cite it, e.g. [1]. */
  n: number;
  articleId: string;
  title: string;
  category: string;
  snippet: string;
  similarity: number;
}

export interface ConversationSummary {
  id: string;
  title: string;
  updatedAt: string;
}

/** Newline-delimited JSON events streamed by POST /api/chat. */
export type ChatStreamEvent =
  | { type: "meta"; conversationId: string; sources: Source[] }
  | { type: "delta"; text: string }
  | { type: "done" }
  | { type: "error"; message: string };

export interface ArticleInput {
  title: string;
  content: string;
  category: string;
  tags: string[];
}

export interface RetrievedChunk {
  chunkId: string;
  articleId: string;
  title: string;
  category: string;
  content: string;
  /** Cosine similarity, 1 = identical. */
  similarity: number;
}
