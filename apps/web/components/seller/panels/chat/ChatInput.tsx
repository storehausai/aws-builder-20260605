"use client";

import {
  useRef,
  useState,
  useEffect,
  forwardRef,
  useImperativeHandle,
} from "react";
import { Send, Square } from "lucide-react";
import { cn } from "@/lib/utils";

export interface ChatInputHandle {
  setValueAndFocus: (value: string) => void;
}

interface ChatInputProps {
  onSend: (text: string) => void;
  onCancel?: () => void;
  isLoading: boolean;
  placeholder?: string;
  disabled?: boolean;
}

export const ChatInput = forwardRef<ChatInputHandle, ChatInputProps>(
  function ChatInput(
    { onSend, onCancel, isLoading, placeholder, disabled },
    ref,
  ) {
    const resolvedPlaceholder = placeholder ?? "Ask pebble to find creators…";
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const [input, setInput] = useState("");

    useImperativeHandle(ref, () => ({
      setValueAndFocus(value: string) {
        setInput(value);
        requestAnimationFrame(() => textareaRef.current?.focus());
      },
    }));

    useEffect(() => {
      const el = textareaRef.current;
      if (!el) return;
      if (input === "") {
        el.style.height = "";
        return;
      }
      el.style.height = "auto";
      el.style.height = Math.min(el.scrollHeight, 120) + "px";
    }, [input]);

    function submit() {
      const text = input.trim();
      if (!text || isLoading || disabled) return;
      onSend(text);
      setInput("");
    }

    return (
      <div className="px-3 pb-3 sm:px-4 sm:pb-4">
        <div
          className={cn(
            "mx-auto flex w-full max-w-3xl items-end gap-2 rounded-2xl border border-border bg-surface-raised px-3 py-2.5 shadow-sm transition-colors",
            "focus-within:border-input-focus",
          )}
        >
          <textarea
            ref={textareaRef}
            value={input}
            disabled={disabled}
            placeholder={resolvedPlaceholder}
            rows={1}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
            className="max-h-[120px] flex-1 resize-none bg-transparent text-sm leading-relaxed text-foreground placeholder:text-text-disabled outline-none"
          />
          {isLoading ? (
            <button
              type="button"
              aria-label="Stop"
              onClick={onCancel}
              className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-foreground text-text-inverse transition-colors hover:bg-foreground-hover"
            >
              <Square className="h-3.5 w-3.5 fill-current" />
            </button>
          ) : (
            <button
              type="button"
              aria-label="Send"
              disabled={!input.trim() || disabled}
              onClick={submit}
              className={cn(
                "flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full transition-colors",
                input.trim() && !disabled
                  ? "bg-foreground text-text-inverse hover:bg-foreground-hover"
                  : "bg-muted text-text-disabled",
              )}
            >
              <Send className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>
    );
  },
);
