# File Upload Implementation - Multer & Presigned URLs

## Overview

The PrintPe webapp now supports **both** file upload methods:

1. **Multer Upload** - Backend processes the upload
   - Best for: Smaller files, when you want backend to validate
   - Process: Client → Backend (FormData) → S3
   - Pros: Easier validation, backend control
   - Cons: More bandwidth, slower for large files

2. **Presigned URL Upload** - Direct S3 upload
   - Best for: Larger files, better performance
   - Process: Client → S3 directly (presigned URL)
   - Pros: Faster, less backend load, upload progress
   - Cons: Need to finalize with backend for page count

## Usage in React Components

### Basic Usage (Auto-selects best method)

```typescript
import { uploadDocument } from "@/services/api/filesApi";

// Simple upload - defaults to presigned URL with fallback to multer
const result = await uploadDocument(file);
console.log(result.id, result.pageCount);
```

### Force Multer Method

```typescript
import { uploadDocumentViaMulter } from "@/services/api/filesApi";

// Always use multer
const result = await uploadDocumentViaMulter(file);
```

### With Progress Tracking

```typescript
const result = await uploadDocument(file, {
  onProgress: (percent) => {
    console.log(`Upload progress: ${percent}%`);
    setUploadProgress(percent);
  },
});
```

### Force Presigned Method

```typescript
const result = await uploadDocument(file, {
  method: "presigned",
  onProgress: (percent) => setUploadProgress(percent),
});
```

### Two-Step Presigned Upload (Advanced)

```typescript
import {
  getPresignedUploadUrl,
  uploadFileToS3,
  finalizePresignedUpload,
} from "@/services/api/filesApi";

// Step 1: Get presigned URL
const presignedData = await getPresignedUploadUrl(
  file.name,
  file.type,
  shopId,
);

// Step 2: Upload directly to S3
await uploadFileToS3(
  presignedData.presignedUrl,
  file,
  file.type,
  (progress) => console.log(progress),
);

// Step 3: Finalize with backend (page count, conversion)
const finalResult = await finalizePresignedUpload(
  presignedData.fileId,
  file,
);
```

## Backend API Endpoints

### POST /files/upload
Upload file via Multer (multipart form data)

**Request:**
```bash
POST /api/v1/files/upload HTTP/1.1
Content-Type: multipart/form-data
Authorization: Bearer <token>

--boundary
Content-Disposition: form-data; name="file"; filename="document.pdf"
<file binary data>
--boundary--
```

**Response:**
```json
{
  "id": "uuid",
  "originalName": "document.pdf",
  "mimeType": "application/pdf",
  "size": 1024000,
  "pageCount": 5
}
```

### POST /files/presigned
Get presigned URL for direct S3 upload

**Request:**
```json
{
  "filename": "document.pdf",
  "mimeType": "application/pdf",
  "shopId": "shop-uuid"
}
```

**Response:**
```json
{
  "presignedUrl": "https://s3.amazonaws.com/bucket/...",
  "s3Key": "uploads/user-id/uuid.pdf",
  "fileId": "file-uuid"
}
```

**Usage:**
```bash
# Client puts file directly to S3 using presignedUrl
curl -X PUT \
  --data-binary @document.pdf \
  -H "Content-Type: application/pdf" \
  "https://s3.amazonaws.com/bucket/..."
```

### PATCH /files/:id/finalize
Finalize presigned upload - extracts page count and processes conversions

**Request:**
```bash
PATCH /api/v1/files/file-uuid/finalize HTTP/1.1
Content-Type: multipart/form-data
Authorization: Bearer <token>

--boundary
Content-Disposition: form-data; name="file"; filename="document.pdf"
<file binary data>
--boundary--
```

**Response:**
```json
{
  "id": "file-uuid",
  "originalName": "document.pdf",
  "mimeType": "application/pdf",
  "size": 1024000,
  "pageCount": 5
}
```

### GET /files/page-count
Detect page count for a file (without storing)

**Request:**
```bash
POST /api/v1/files/page-count HTTP/1.1
Content-Type: multipart/form-data
Authorization: Bearer <token>

--boundary
Content-Disposition: form-data; name="file"; filename="document.pdf"
<file binary data>
--boundary--
```

**Response:**
```json
{
  "pageCount": 5
}
```

### GET /files/:id/download-url
Get presigned download URL

**Request:**
```bash
GET /api/v1/files/file-uuid/download-url HTTP/1.1
Authorization: Bearer <token>
```

**Response:**
```json
{
  "url": "https://s3.amazonaws.com/bucket/..."
}
```

### GET /files/my-uploads
Get recent uploaded files (not expired)

**Request:**
```bash
GET /api/v1/files/my-uploads HTTP/1.1
Authorization: Bearer <token>
```

**Response:**
```json
[
  {
    "id": "file-uuid-1",
    "originalName": "document.pdf",
    "mimeType": "application/pdf",
    "size": 1024000,
    "pageCount": 5
  },
  ...
]
```

### DELETE /files/:id
Delete a file

**Request:**
```bash
DELETE /api/v1/files/file-uuid HTTP/1.1
Authorization: Bearer <token>
```

**Response:**
```json
{
  "message": "File deleted successfully"
}
```

## Configuration

### Backend (.env)
```
AWS_REGION=ap-south-1
AWS_ACCESS_KEY_ID=your-key
AWS_SECRET_ACCESS_KEY=your-secret
S3_BUCKET_NAME=printpe-documents
S3_PRESIGNED_URL_EXPIRY=3600
SOFFICE_BIN=/path/to/soffice (optional, for DOC/DOCX conversion)
```

### Frontend (.env)
```
API_BASE_URL=http://localhost:3000/api/v1
WS_BASE_URL=http://localhost:3000
AUTH_ACCESS_TOKEN_KEY=printpe_access_token
AUTH_REFRESH_TOKEN_KEY=printpe_refresh_token
```

## Supported File Types

- **Documents:** PDF, DOC, DOCX
- **Images:** JPG, JPEG, PNG, WebP, GIF, BMP, HEIC, HEIF, AVIF
- **Max Size:** 50MB per file
- **Auto-expiry:** 5 days (S3 lifecycle policy)

## Features

### Page Count Detection
- PDF: Accurate using pdf-parse
- DOCX: Extracted from document.xml
- DOC: Estimated (word count / 450)
- Images: Always 1 page

### Document Conversion
- DOC/DOCX → PDF: Uses LibreOffice (soffice) if available
- Falls back to original format if conversion unavailable

### Upload Flow in PrintPage.tsx

```
SelectFile → UploadDocument(presigned with fallback)
  ├─ Success: Show page count, proceed to config
  └─ Fail: Retry or use multer fallback
  
After S3 upload:
  ├─ Finalize with backend (extract pages)
  ├─ Convert DOC/DOCX to PDF if needed
  └─ Return complete metadata
  
CreatePrintJob:
  ├─ Use fileId from upload
  ├─ Send printOptions
  └─ Payment flow
```

## Error Handling

```typescript
try {
  const result = await uploadDocument(file);
} catch (error) {
  if (error.status === 401) {
    // Redirect to login
  } else if (error.status === 413) {
    // File too large
    console.error("File exceeds 50MB limit");
  } else {
    // Network error or S3 error
    console.error("Upload failed:", error.message);
  }
}
```

## Performance Tips

1. **Use presigned URLs for files > 5MB** - Direct S3 upload is faster
2. **Show upload progress** - Improves UX for large files
3. **Batch multiple files** - Use Promise.all() carefully to avoid overloading
4. **Lazy detect page count** - Optional, can be skipped for preview

## Example: Full Upload Component

```typescript
import { useState } from "react";
import { uploadDocument } from "@/services/api/filesApi";
import type { UploadedFileResult } from "@/services/api/filesApi";

export function FileUploader() {
  const [files, setFiles] = useState<UploadedFileResult[]>([]);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const handleFile = async (file: File) => {
    try {
      setUploading(true);
      setError(null);
      setProgress(0);

      const result = await uploadDocument(file, {
        onProgress: setProgress,
      });

      setFiles((prev) => [...prev, result]);
      console.log(
        `${result.originalName}: ${result.pageCount} pages uploaded`,
      );
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setUploading(false);
      setProgress(0);
    }
  };

  return (
    <div className="p-4">
      <input
        type="file"
        onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
        disabled={uploading}
        accept=".pdf,.doc,.docx,image/*"
      />

      {uploading && <p>Uploading... {progress.toFixed(0)}%</p>}
      {error && <p className="text-red-600">{error}</p>}

      <ul>
        {files.map((f) => (
          <li key={f.id}>
            {f.originalName} - {f.pageCount} pages ({f.size} bytes)
          </li>
        ))}
      </ul>
    </div>
  );
}
```

## Security

- **Authorization:** JWT token required for all endpoints
- **Ownership:** Files can only be accessed/deleted by owner (userId)
- **S3 ACL:** Private bucket with presigned URLs (time-limited)
- **Content-Type:** Validated on upload
- **File Size:** Limited to 50MB
- **Auto-cleanup:** Files expire after 5 days via S3 lifecycle
