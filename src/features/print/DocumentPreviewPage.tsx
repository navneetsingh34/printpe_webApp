import { useLocation, useNavigate } from "react-router-dom";
import { BackButton } from "../../shared/ui/BackButton";

type PreviewLocationState = {
  fileUrl?: string;
  fileName?: string;
  mimeType?: string;
};

export function DocumentPreviewPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const state = location.state as PreviewLocationState | null;
  const fileUrl = state?.fileUrl ?? "";
  const fileName = state?.fileName ?? "Document preview";
  const mimeType = state?.mimeType ?? "";
  const canRenderInline =
    mimeType.includes("pdf") || mimeType.startsWith("image/");

  return (
    <section className="page-animate print-page document-preview-page">
      <div className="page-topbar">
        <BackButton fallbackPath="/print" label="Back" />
      </div>

      <div className="card document-preview-card animate-rise">
        <div className="print-header">
          <h2>Document Preview</h2>
          <p className="print-header-subtitle">
            Verify the file before continuing to payment.
          </p>
        </div>

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
                <p>
                  This file type cannot be previewed inline in the browser.
                </p>
                <a href={fileUrl} target="_blank" rel="noreferrer">
                  Open document in new tab
                </a>
              </div>
            )}
          </div>
        ) : (
          <div className="document-preview-fallback">
            <p>No document selected.</p>
            <button type="button" className="btn-primary" onClick={() => navigate("/print")}>
              Go to Print Flow
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
