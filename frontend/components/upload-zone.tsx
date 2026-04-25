"use client";

import { useRef, useState } from "react";

const MAX_BYTES = 50 * 1024 * 1024;
const ACCEPTED = [".pdf", ".docx"];

type Props = {
  onFile: (file: File) => void;
  progress?: number | null;
  busy?: boolean;
};

export function UploadZone({ onFile, progress = null, busy = false }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragActive, setDragActive] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);

  function validate(file: File): string | null {
    const dot = file.name.lastIndexOf(".");
    const ext = dot >= 0 ? file.name.slice(dot).toLowerCase() : "";
    if (!ACCEPTED.includes(ext)) {
      return "Only PDF and DOCX files are accepted.";
    }
    if (file.size > MAX_BYTES) {
      const mb = (file.size / 1024 / 1024).toFixed(1);
      return `File exceeds the 50MB limit (${mb}MB).`;
    }
    return null;
  }

  function pick(file: File) {
    const err = validate(file);
    if (err) {
      setValidationError(err);
      return;
    }
    setValidationError(null);
    onFile(file);
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragActive(false);
    if (busy) return;
    const file = e.dataTransfer.files?.[0];
    if (file) pick(file);
  }

  function onChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) pick(file);
    e.target.value = "";
  }

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => !busy && inputRef.current?.click()}
      onKeyDown={(e) => {
        if ((e.key === "Enter" || e.key === " ") && !busy) {
          e.preventDefault();
          inputRef.current?.click();
        }
      }}
      onDrop={onDrop}
      onDragOver={(e) => {
        e.preventDefault();
        if (!busy) setDragActive(true);
      }}
      onDragLeave={() => setDragActive(false)}
      className={`relative cursor-pointer rounded-lg border-2 border-dashed p-8 text-center transition-colors ${
        dragActive
          ? "border-blue-500 bg-blue-50"
          : "border-neutral-300 bg-white hover:border-neutral-400"
      } ${busy ? "pointer-events-none opacity-60" : ""}`}
    >
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPTED.join(",")}
        onChange={onChange}
        className="hidden"
      />
      <p className="text-sm text-neutral-600">
        {dragActive
          ? "Drop to upload"
          : "Drag a PDF or DOCX here, or click to choose"}
      </p>
      <p className="mt-1 text-xs text-neutral-500">Up to 50MB</p>

      {progress !== null && (
        <div className="mt-4">
          <div className="h-2 w-full rounded-full bg-neutral-200">
            <div
              className="h-2 rounded-full bg-blue-500 transition-all"
              style={{ width: `${progress}%` }}
            />
          </div>
          <p className="mt-1 text-xs text-neutral-500">{progress}%</p>
        </div>
      )}

      {validationError && (
        <p className="mt-3 text-xs text-red-600">{validationError}</p>
      )}
    </div>
  );
}
