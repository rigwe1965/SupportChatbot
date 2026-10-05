import FeedbackButtons from "./FeedbackButtons";
import type { ChatMessage } from "@/types";

export function TypingIndicator() {
  return (
    <span className="inline-flex items-center gap-1 py-1" role="status" aria-label="Assistant is typing">
      {[0, 150, 300].map((delay) => (
        <span
          key={delay}
          className="h-2 w-2 animate-bounce rounded-full bg-muted"
          style={{ animationDelay: `${delay}ms` }}
        />
      ))}
    </span>
  );
}

export default function MessageItem({
  message,
  pending,
  onRetry,
}: {
  message: ChatMessage;
  pending?: boolean;
  onRetry?: () => void;
}) {
  const isUser = message.role === "user";

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div className={`max-w-[85%] space-y-2 sm:max-w-[75%] ${isUser ? "items-end" : ""}`}>
        {(message.content || pending) && (
          <div
            className={`whitespace-pre-wrap break-words rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
              isUser
                ? "rounded-br-sm bg-brand text-brand-foreground"
                : "rounded-bl-sm border border-border bg-foreground/[0.03]"
            }`}
          >
            {message.content || <TypingIndicator />}
          </div>
        )}

        {message.error && (
          <div
            role="alert"
            className="flex items-center gap-3 rounded-lg border border-border bg-foreground/5 px-3 py-2 text-xs"
          >
            <span>{message.error}</span>
            {onRetry && (
              <button type="button" onClick={onRetry} className="font-medium text-brand hover:underline">
                Retry
              </button>
            )}
          </div>
        )}

        {!isUser && message.dbId && message.rateable && message.content && !pending && !message.error && (
          <FeedbackButtons
            messageId={message.dbId}
            initialRating={message.feedback}
            initialComment={message.feedbackComment}
          />
        )}

        {!isUser && message.sources && message.sources.length > 0 && (
          <div className="space-y-1.5">
            <p className="text-xs font-medium text-muted">Sources</p>
            <ul className="space-y-1">
              {message.sources.map((s) => (
                <li key={s.n}>
                  <details className="group rounded-lg border border-border text-xs">
                    <summary className="flex cursor-pointer list-none items-center gap-2 px-2.5 py-1.5">
                      <span className="font-mono text-brand">[{s.n}]</span>
                      <span className="truncate font-medium">{s.title}</span>
                      <span className="shrink-0 text-muted">· {s.category}</span>
                    </summary>
                    <p className="whitespace-pre-wrap border-t border-border px-2.5 py-2 text-muted">
                      {s.snippet}
                    </p>
                  </details>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
