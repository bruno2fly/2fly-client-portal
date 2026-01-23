import React, { useRef, useState } from "react";
import { AssetType } from "../../lib/contentStore";

interface UploadBoxProps {
  onUpload: (files: File[], type: AssetType, tags: string[], notes?: string) => Promise<void>;
}

export const UploadBox: React.FC<UploadBoxProps> = ({ onUpload }) => {
  const [dragging, setDragging] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [type, setType] = useState<AssetType>("photo");
  const [tags, setTags] = useState<string>("");
  const [notes, setNotes] = useState<string>("");
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(true);
  };

  const handleDragLeave = () => {
    setDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const droppedFiles = Array.from(e.dataTransfer.files);
    setFiles((prev) => [...prev, ...droppedFiles]);
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const selectedFiles = Array.from(e.target.files);
      setFiles((prev) => [...prev, ...selectedFiles]);
    }
  };

  const removeFile = (index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSubmit = async () => {
    if (files.length === 0) return;
    setUploading(true);
    try {
      const tagArray = tags
        .split(",")
        .map((t) => t.trim())
        .filter((t) => t.length > 0);
      await onUpload(files, type, tagArray, notes || undefined);
      setFiles([]);
      setTags("");
      setNotes("");
    } catch (error) {
      console.error("Upload failed:", error);
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="space-y-4">
      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={`border-2 border-dashed rounded-[14px] p-8 text-center transition-colors ${
          dragging
            ? "border-[var(--accent)] bg-[rgba(124,92,255,.05)]"
            : "border-[var(--stroke)] bg-[var(--surface-2)]"
        }`}
      >
        <div className="text-4xl mb-4">📤</div>
        <div className="text-lg font-semibold text-[var(--text)] mb-2">
          Drag & drop files here
        </div>
        <div className="text-sm text-[var(--muted)] mb-4">
          or click to browse
        </div>
        <button
          onClick={() => fileInputRef.current?.click()}
          className="px-4 py-2 rounded-lg bg-[var(--accent)] text-white font-medium hover:opacity-90 transition-opacity"
        >
          Select Files
        </button>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          onChange={handleFileSelect}
          className="hidden"
        />
      </div>

      {files.length > 0 && (
        <div className="space-y-4 p-4 rounded-[14px] border border-[var(--stroke)] bg-[var(--surface)]">
          <div className="font-semibold text-[var(--text)]">
            {files.length} file{files.length !== 1 ? "s" : ""} selected
          </div>
          <div className="space-y-2 max-h-48 overflow-y-auto">
            {files.map((file, index) => (
              <div
                key={index}
                className="flex items-center justify-between p-2 rounded-lg bg-[var(--surface-2)]"
              >
                <span className="text-sm text-[var(--text)] truncate flex-1">
                  {file.name}
                </span>
                <span className="text-xs text-[var(--muted)] mx-2">
                  {(file.size / 1024 / 1024).toFixed(2)} MB
                </span>
                <button
                  onClick={() => removeFile(index)}
                  className="text-[var(--bad)] hover:opacity-80"
                >
                  ×
                </button>
              </div>
            ))}
          </div>

          <div className="space-y-3">
            <div>
              <label className="block text-sm font-medium text-[var(--text)] mb-2">
                Type (applies to all)
              </label>
              <select
                value={type}
                onChange={(e) => setType(e.target.value as AssetType)}
                className="w-full px-4 py-2 rounded-lg border border-[var(--stroke)] bg-[var(--surface-2)] text-[var(--text)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
              >
                <option value="photo">Photo</option>
                <option value="video">Video</option>
                <option value="logo">Logo</option>
                <option value="doc">Doc</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-[var(--text)] mb-2">
                Tags (comma-separated)
              </label>
              <input
                type="text"
                value={tags}
                onChange={(e) => setTags(e.target.value)}
                placeholder="menu, food, ambience"
                className="w-full px-4 py-2 rounded-lg border border-[var(--stroke)] bg-[var(--surface-2)] text-[var(--text)] placeholder:text-[var(--muted)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-[var(--text)] mb-2">
                Notes (optional)
              </label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Add any notes about these files..."
                rows={3}
                className="w-full px-4 py-2 rounded-lg border border-[var(--stroke)] bg-[var(--surface-2)] text-[var(--text)] placeholder:text-[var(--muted)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
              />
            </div>

            <button
              onClick={handleSubmit}
              disabled={uploading}
              className="w-full px-4 py-2 rounded-lg bg-[var(--accent)] text-white font-medium hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {uploading ? "Uploading..." : "Upload Files"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

