import { useState, useCallback } from "react";
import {
  uploadDocument,
  type UploadedFileResult,
  type FileUploadOptions,
} from "../api/filesApi";

export interface UseFileUploadState {
  files: UploadedFileResult[];
  loading: boolean;
  progress: number;
  error: string | null;
}

export interface UseFileUploadActions {
  uploadFile: (file: File, options?: FileUploadOptions) => Promise<void>;
  uploadMultiple: (files: File[], options?: FileUploadOptions) => Promise<void>;
  removeFile: (fileId: string) => void;
  clearError: () => void;
  reset: () => void;
}

/**
 * Hook for managing file uploads with progress tracking
 *
 * @example
 * const { files, loading, progress, error, uploadFile, removeFile } = useFileUpload();
 *
 * const handleFileSelect = async (file: File) => {
 *   await uploadFile(file, { onProgress: (p) => console.log(p) });
 * };
 *
 * return (
 *   <div>
 *     {loading && <p>Uploading {progress.toFixed(0)}%</p>}
 *     {error && <p className="text-red-600">{error}</p>}
 *     {files.map(f => (
 *       <div key={f.id}>
 *         {f.originalName} ({f.pageCount} pages)
 *         <button onClick={() => removeFile(f.id)}>Remove</button>
 *       </div>
 *     ))}
 *   </div>
 * );
 */
export function useFileUpload(): UseFileUploadState & UseFileUploadActions {
  const [files, setFiles] = useState<UploadedFileResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const uploadFile = useCallback(
    async (file: File, options?: FileUploadOptions) => {
      try {
        setLoading(true);
        setError(null);
        setProgress(0);

        const result = await uploadDocument(file, {
          ...options,
          onProgress: (p) => {
            setProgress(p);
            options?.onProgress?.(p);
          },
        });

        setFiles((prev) => [...prev, result]);
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Upload failed";
        setError(message);
        throw err;
      } finally {
        setLoading(false);
        setProgress(0);
      }
    },
    [],
  );

  const uploadMultiple = useCallback(
    async (filesToUpload: File[], options?: FileUploadOptions) => {
      try {
        setLoading(true);
        setError(null);
        setProgress(0);

        const results: UploadedFileResult[] = [];

        for (let i = 0; i < filesToUpload.length; i++) {
          const file = filesToUpload[i];
          const fileProgress = (i / filesToUpload.length) * 100;

          const result = await uploadDocument(file, {
            ...options,
            onProgress: (p) => {
              const totalProgress =
                fileProgress + (p / filesToUpload.length);
              setProgress(totalProgress);
              options?.onProgress?.(totalProgress);
            },
          });

          results.push(result);
        }

        setFiles((prev) => [...prev, ...results]);
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Upload failed";
        setError(message);
        throw err;
      } finally {
        setLoading(false);
        setProgress(0);
      }
    },
    [],
  );

  const removeFile = useCallback((fileId: string) => {
    setFiles((prev) => prev.filter((f) => f.id !== fileId));
  }, []);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  const reset = useCallback(() => {
    setFiles([]);
    setLoading(false);
    setProgress(0);
    setError(null);
  }, []);

  return {
    files,
    loading,
    progress,
    error,
    uploadFile,
    uploadMultiple,
    removeFile,
    clearError,
    reset,
  };
}
