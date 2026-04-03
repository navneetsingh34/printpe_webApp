import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { BackButton } from "../../shared/ui/BackButton";

type PreviewLocationState = {
  fileUrl?: string;
  fileName?: string;
  mimeType?: string;
  files?: File[];
  selectedIndex?: number;
};

export function DocumentPreviewPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const state = location.state as PreviewLocationState | null;
  const previewFiles = state?.files ?? [];
  const [activeIndex, setActiveIndex] = useState(state?.selectedIndex ?? 0);
  const activeFile = previewFiles[activeIndex] ?? previewFiles[0] ?? null;

  useEffect(() => {
    if (previewFiles.length === 0) {
      return;
    }

    if (activeIndex >= previewFiles.length) {
      setActiveIndex(0);
    }
  }, [activeIndex, previewFiles.length]);

  const [previewUrl, setPreviewUrl] = useState("");

  useEffect(() => {
    if (!activeFile) {
      setPreviewUrl("");
      return;
    }

    const nextUrl = URL.createObjectURL(activeFile);
    setPreviewUrl(nextUrl);

    return () => {
      URL.revokeObjectURL(nextUrl);
    };
  }, [activeFile]);

  const fileUrl = previewFiles.length > 0 ? previewUrl : (state?.fileUrl ?? "");
  const fileName = activeFile?.name ?? state?.fileName ?? "Document preview";
  const mimeType = activeFile?.type ?? state?.mimeType ?? "";
  const canRenderInline =
    mimeType.includes("pdf") || mimeType.startsWith("image/");

  return (
    <section className="page-animate print-page document-preview-page">
      <div className="page-topbar">
        <BackButton
          fallbackPath="/print"
          label="Back"
          onClick={() =>
            navigate("/print", {
              replace: true,
              state: {
                resumeFromPreview: true,
                files: previewFiles,
                previewIndex: activeIndex,
              },
            })
          }
        />
      </div>

      <div className="card document-preview-card animate-rise">
        <div className="print-header">
          <h2>Document Preview</h2>
          <p className="print-header-subtitle">
            Verify the file before continuing to payment.
          </p>
        </div>

        {previewFiles.length > 1 ? (
          <div className="selected-files-list">
            <p className="selected-files-title">Selected files</p>
            <p className="selected-files-help">
              Choose a file to preview it before you continue.
            </p>
            <ul>
              {previewFiles.map((item, index) => (
                <li key={`${item.name}-${item.size}-${index}`}>
                  <button
                    type="button"
                    className={`selected-file-chip ${index === activeIndex ? "active" : ""}`}
                    onClick={() => setActiveIndex(index)}
                  >
                    <span className="selected-file-name">{item.name}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {fileUrl ? (
          <div className="document-preview-shell">
            {canRenderInline ? (
              <iframe
                title={fileName}
                src={fileUrl}
                className="document-preview-frame"
              />
            ) : (
              <div className="document-preview-fallback">
                <p>This file type cannot be previewed inline in the browser.</p>
                <a href={fileUrl} target="_blank" rel="noreferrer">
                  Open document in new tab
                </a>
              </div>
            )}
          </div>
        ) : (
          <div className="document-preview-fallback">
            <p>No document selected.</p>
            <button
              type="button"
              className="btn-primary"
              onClick={() => navigate("/print")}
            >
              Go to Print Flow
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
