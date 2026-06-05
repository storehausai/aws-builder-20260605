"use client";

import {
  useRef,
  useState,
  useCallback,
  useEffect,
  forwardRef,
  useImperativeHandle,
} from "react";
import { Send, Paperclip, X, Square } from "lucide-react";

const ACCEPTED_IMAGE_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
];
const MAX_IMAGE_SIZE = 20 * 1024 * 1024;
const MAX_IMAGES = 5;

export interface ChatInputHandle {
  setValueAndFocus: (value: string) => void;
}

interface ChatInputProps {
  onSend: (text: string, attachments?: File[]) => void;
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
    const fileInputRef = useRef<HTMLInputElement>(null);
    const dropZoneRef = useRef<HTMLDivElement>(null);

    const [input, setInput] = useState("");
    const [attachedImages, setAttachedImages] = useState<
      { file: File; preview: string }[]
    >([]);
    const [dragOver, setDragOver] = useState(false);

    useImperativeHandle(ref, () => ({
      setValueAndFocus(value: string) {
        setInput(value);
        requestAnimationFrame(() => textareaRef.current?.focus());
      },
    }));

    useEffect(() => {
      const el = textareaRef.current;
      if (!el) return;
      // Empty input: skip scrollHeight measure — composer mounts at width≈0 mid-animation, reads inflate.
      if (input === "") {
        el.style.height = "";
        return;
      }
      el.style.height = "auto";
      el.style.height = Math.min(el.scrollHeight, 120) + "px";
    }, [input]);

    const addImages = useCallback((files: FileList | File[]) => {
      let added = false;
      for (const file of Array.from(files)) {
        if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) continue;
        if (file.size > MAX_IMAGE_SIZE) continue;
        const preview = URL.createObjectURL(file);
        setAttachedImages((prev) =>
          prev.length >= MAX_IMAGES ? prev : [...prev, { file, preview }],
        );
        added = true;
      }
      if (added) {
        requestAnimationFrame(() => textareaRef.current?.focus());
      }
    }, []);

    const removeImage = useCallback((index: number) => {
      setAttachedImages((prev) => {
        URL.revokeObjectURL(prev[index]!.preview);
        return prev.filter((_, i) => i !== index);
      });
    }, []);

    // Ref avoids stale closure on unmount cleanup of preview URLs.
    const attachedImagesRef = useRef(attachedImages);
    attachedImagesRef.current = attachedImages;
    useEffect(() => {
      return () => {
        attachedImagesRef.current.forEach((img) =>
          URL.revokeObjectURL(img.preview),
        );
      };
    }, []);

    const handleDragOver = useCallback((e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setDragOver(true);
    }, []);

    const handleDragLeave = useCallback((e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (
        dropZoneRef.current &&
        !dropZoneRef.current.contains(e.relatedTarget as Node)
      ) {
        setDragOver(false);
      }
    }, []);

    const handleDrop = useCallback(
      (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setDragOver(false);
        if (e.dataTransfer.files.length > 0) {
          addImages(e.dataTransfer.files);
        }
      },
      [addImages],
    );

    const handlePaste = useCallback(
      (e: React.ClipboardEvent) => {
        const items = e.clipboardData?.items;
        if (!items) return;
        const imageFiles: File[] = [];
        for (const item of Array.from(items)) {
          if (item.type.startsWith("image/")) {
            const file = item.getAsFile();
            if (file) imageFiles.push(file);
          }
        }
        if (imageFiles.length > 0) {
          addImages(imageFiles);
        }
      },
      [addImages],
    );

    const handleSend = useCallback(() => {
      const trimmed = input.trim();
      if (!trimmed && attachedImages.length === 0) return;
      if (isLoading || disabled) return;

      const files =
        attachedImages.length > 0
          ? attachedImages.map((img) => img.file)
          : undefined;

      onSend(trimmed, files);

      setInput("");
      setAttachedImages([]);
      requestAnimationFrame(() => textareaRef.current?.focus());
    }, [input, attachedImages, isLoading, disabled, onSend]);

    const handleKeyDown = useCallback(
      (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        // Skip IME composition Enter to prevent Korean/CJK double-input.
        if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
          e.preventDefault();
          handleSend();
        }
      },
      [handleSend],
    );

    const hasContent = input.trim().length > 0 || attachedImages.length > 0;
    const canSend = !isLoading && !disabled && hasContent;

    return (
      <div className="px-4 pb-4 pt-2">
        <div className="relative">
          <div
            ref={dropZoneRef}
            className={`bg-white border rounded-2xl shadow-sm overflow-hidden transition-colors ${
              dragOver ? "border-ink/40 ring-2 ring-ink/20" : "border-border"
            }`}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
          >
            {attachedImages.length > 0 && (
              <div className="flex gap-2 px-3.5 pt-3 flex-wrap">
                {attachedImages.map((img, i) => (
                  <div key={img.preview} className="relative group">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={img.preview}
                      alt=""
                      className="w-14 h-14 object-cover rounded-lg border border-border"
                    />
                    <button
                      type="button"
                      onClick={() => removeImage(i)}
                      className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-foreground text-white rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                      aria-label="Remove image"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div className="px-3.5 pt-3 pb-2">
              <textarea
                ref={textareaRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                onPaste={handlePaste}
                placeholder={resolvedPlaceholder}
                autoFocus
                rows={1}
                // 16px (text-base) prevents iOS zoom-on-focus.
                className="w-full text-base outline-none bg-transparent text-foreground placeholder:text-text-disabled resize-none max-h-[120px] leading-relaxed"
                disabled={disabled}
                aria-label="Chat input"
              />
            </div>

            <div className="flex items-center justify-between px-3 pb-2.5">
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="p-1.5 rounded-lg text-foreground hover:text-ink hover:bg-muted transition-colors"
                  aria-label="Attach image"
                >
                  <Paperclip className="h-4 w-4" strokeWidth={2.25} />
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  multiple
                  className="hidden"
                  onChange={(e) => {
                    if (e.target.files) addImages(e.target.files);
                    e.target.value = "";
                  }}
                />
              </div>
              {isLoading ? (
                <button
                  type="button"
                  onClick={onCancel}
                  className="p-1.5 rounded-lg text-foreground hover:text-ink hover:bg-muted transition-colors"
                  aria-label="Stop generating"
                >
                  <Square className="h-3.5 w-3.5 fill-current" strokeWidth={2.25} />
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleSend}
                  disabled={!canSend}
                  className="p-1.5 rounded-lg text-foreground hover:text-ink hover:bg-accent transition-colors disabled:opacity-40 disabled:text-text-disabled disabled:hover:bg-transparent disabled:hover:text-text-disabled"
                  aria-label="Send message"
                >
                  <Send className="h-4 w-4" strokeWidth={2.25} />
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  },
);
