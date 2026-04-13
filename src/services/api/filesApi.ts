import { apiRequest, ApiError } from "./httpClient";
import { getTokenBundle } from "../storage/tokenStorage";

export type UploadedFileResult = {
  id: string;
  originalName: string;
  mimeType: string;
  size: number;
  pageCount?: number | null;
  processingStatus?: "uploading" | "processing" | "converted" | "failed";
  processingError?: string | null;
};

export type PresignedUrlResponse = {
  presignedUrl: string;
  s3Key: string;
  fileId: string;
};

export type DetectPageCountResult = {
  pageCount: number;
};

export type UploadMethod = "multer" | "presigned";

export type FileUploadOptions = {
  method?: UploadMethod;
  onProgress?: (progress: number) => void;
};

/**
 * Upload file using Multer (backend processes the upload)
 * Best for smaller files or when you want backend validation
 */
export async function uploadDocumentViaMulter(
  file: File,
): Promise<UploadedFileResult> {
  const tokens = await getTokenBundle();
  if (!tokens?.accessToken) {
    throw new ApiError("Please sign in before uploading documents.", 401);
  }

  const body = new FormData();
  body.append("file", file);

  return apiRequest<UploadedFileResult>(
    "/files/upload",
    {
      method: "POST",
      body,
    },
    { auth: true },
  );
}

/**
 * Get presigned URL for direct S3 upload
 * Returns a presigned URL that the client can use to PUT the file directly to S3
 */
export async function getPresignedUploadUrl(
  filename: string,
  mimeType: string,
  shopId: string,
): Promise<PresignedUrlResponse> {
  const tokens = await getTokenBundle();
  if (!tokens?.accessToken) {
    throw new ApiError("Please sign in before uploading documents.", 401);
  }

  return apiRequest<PresignedUrlResponse>(
    "/files/presigned",
    {
      method: "POST",
      body: JSON.stringify({
        filename,
        mimeType,
        shopId,
      }),
    },
    { auth: true },
  );
}

/**
 * Upload file directly to S3 using presigned URL
 * This bypasses the backend and uploads directly to AWS S3
 */
export async function uploadFileToS3(
  presignedUrl: string,
  file: File,
  mimeType: string,
  onProgress?: (progress: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();

    if (onProgress) {
      xhr.upload.addEventListener("progress", (event) => {
        if (event.lengthComputable) {
          const percentComplete = (event.loaded / event.total) * 100;
          onProgress(percentComplete);
        }
      });
    }

    xhr.addEventListener("load", () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve();
      } else {
        reject(
          new Error(
            `S3 upload failed with status ${xhr.status}: ${xhr.statusText}`,
          ),
        );
      }
    });

    xhr.addEventListener("error", () => {
      reject(new Error("Network error during S3 upload"));
    });

    xhr.addEventListener("abort", () => {
      reject(new Error("S3 upload was aborted"));
    });

    xhr.open("PUT", presignedUrl, true);
    xhr.setRequestHeader("Content-Type", mimeType);
    xhr.send(file);
  });
}

/**
 * Detect page count for a file using backend analysis
 * Useful for preview before upload
 */
export async function detectPageCount(file: File): Promise<number> {
  const tokens = await getTokenBundle();
  if (!tokens?.accessToken) {
    throw new ApiError("Please sign in before uploading documents.", 401);
  }

  const body = new FormData();
  body.append("file", file);

  const response = await apiRequest<DetectPageCountResult>(
    "/files/page-count",
    {
      method: "POST",
      body,
    },
    { auth: true },
  );

  return response.pageCount || 1;
}

/**
 * Combined upload function that handles both methods
 * - Uses presigned URL for better performance (direct to S3)
 * - Falls back to multer if presigned URL fails
 */
export async function uploadDocument(
  file: File,
  options: FileUploadOptions = {},
): Promise<UploadedFileResult> {
  const { method = "presigned", onProgress } = options;

  if (method === "multer") {
    return uploadDocumentViaMulter(file);
  }

  // Try presigned URL approach
  try {
    const tokens = await getTokenBundle();
    if (!tokens?.accessToken) {
      throw new ApiError("Please sign in before uploading documents.", 401);
    }

    const presignedData = await getPresignedUploadUrl(
      file.name,
      file.type || "application/octet-stream",
      "", // shopId can be added from context if needed
    );

    // Upload directly to S3
    await uploadFileToS3(
      presignedData.presignedUrl,
      file,
      file.type || "application/octet-stream",
      onProgress,
    );

    // Finalize the upload with backend to extract page count and process conversions
    const finalizeResponse = await finalizePresignedUpload(
      presignedData.fileId,
    );

    return finalizeResponse;
  } catch (error) {
    // Fallback to multer if presigned URL fails
    console.warn("Presigned URL upload failed, falling back to multer:", error);
    return uploadDocumentViaMulter(file);
  }
}

/**
 * Finalize presigned upload and trigger async backend processing
 */
export async function finalizePresignedUpload(
  fileId: string,
): Promise<UploadedFileResult> {
  const tokens = await getTokenBundle();
  if (!tokens?.accessToken) {
    throw new ApiError("Please sign in to finalize uploads.", 401);
  }

  return apiRequest<UploadedFileResult>(
    `/files/${fileId}/finalize`,
    {
      method: "PATCH",
    },
    { auth: true },
  );
}

/**
 * Get download URL for a file
 */
export async function getFileDownloadUrl(fileId: string): Promise<string> {
  const tokens = await getTokenBundle();
  if (!tokens?.accessToken) {
    throw new ApiError("Please sign in to download files.", 401);
  }

  const response = await apiRequest<{ url: string }>(
    `/files/${fileId}/download-url`,
    { method: "GET" },
    { auth: true },
  );

  return response.url;
}

/**
 * Get user's uploaded files
 */
export async function getMyUploadedFiles(): Promise<UploadedFileResult[]> {
  const tokens = await getTokenBundle();
  if (!tokens?.accessToken) {
    throw new ApiError("Please sign in to view files.", 401);
  }

  return apiRequest<UploadedFileResult[]>(
    "/files/my-uploads",
    { method: "GET" },
    { auth: true },
  );
}

/**
 * Delete an uploaded file
 */
export async function deleteFile(fileId: string): Promise<void> {
  const tokens = await getTokenBundle();
  if (!tokens?.accessToken) {
    throw new ApiError("Please sign in to delete files.", 401);
  }

  await apiRequest<{ message: string }>(
    `/files/${fileId}`,
    { method: "DELETE" },
    { auth: true },
  );
}
