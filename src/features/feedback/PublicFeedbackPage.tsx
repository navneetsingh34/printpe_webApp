import { FormEvent, useMemo, useRef, useState } from 'react';
import { submitPublicFeedback } from '../../services/api/feedbackApi';

const MAX_PHOTO_COUNT = 5;
const MAX_PHOTO_SIZE = 5 * 1024 * 1024;

function formatFileSize(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

export function PublicFeedbackPage() {
  const photosInputRef = useRef<HTMLInputElement | null>(null);
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');
  const [photos, setPhotos] = useState<File[]>([]);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const photoSummary = useMemo(() => {
    if (photos.length === 0) return 'No photos selected';
    return `${photos.length} photo${photos.length > 1 ? 's' : ''} selected`;
  }, [photos]);

  const onPhotoChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const selected = Array.from(event.target.files ?? []);
    if (selected.length > MAX_PHOTO_COUNT) {
      setError(`You can upload up to ${MAX_PHOTO_COUNT} photos.`);
      return;
    }

    const oversize = selected.find((file) => file.size > MAX_PHOTO_SIZE);
    if (oversize) {
      setError('Each photo must be 5MB or smaller.');
      return;
    }

    setError('');
    setPhotos(selected);
  };

  const resetForm = () => {
    setEmail('');
    setMessage('');
    setPhotos([]);
    if (photosInputRef.current) {
      photosInputRef.current.value = '';
    }
  };

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError('');

    if (!email.trim() || !message.trim()) {
      setError('Please enter your email and feedback message.');
      return;
    }

    if (message.trim().length < 5) {
      setError('Feedback message should be at least 5 characters long.');
      return;
    }

    setSubmitting(true);
    try {
      await submitPublicFeedback({
        email: email.trim().toLowerCase(),
        message: message.trim(),
        photos,
      });

      setSubmitted(true);
      resetForm();
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : 'Could not submit feedback right now. Please try again.',
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className={`feedback-public-page page-animate ${submitted ? 'feedback-public-page--submitted' : ''}`}>
      <div className="feedback-backdrop" aria-hidden="true" />

      {submitted ? (
        <section className="feedback-thanks-only">
          <h1>Thanks for your feedback</h1>
          <p>Your response has been submitted successfully.</p>
          <button type="button" className="btn-secondary" onClick={() => setSubmitted(false)}>
            Submit another response
          </button>
        </section>
      ) : (
        <>
          <section className="feedback-hero">
            <p className="feedback-kicker">PrintPe Feedback</p>
            <h1>Tell us what to improve.</h1>
            <p>
              This page is open to everyone. No login required. Share your thoughts,
              bugs, or ideas and optionally attach photos.
            </p>
          </section>

          <section className="feedback-card">
            <form className="form feedback-form" onSubmit={onSubmit} noValidate>
              <label htmlFor="feedback-email">Email</label>
              <input
                id="feedback-email"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="you@example.com"
                autoComplete="email"
                required
              />

              <label htmlFor="feedback-message">Feedback</label>
              <textarea
                id="feedback-message"
                value={message}
                onChange={(event) => setMessage(event.target.value)}
                placeholder="Share your experience, issues, or suggestions..."
                rows={6}
                maxLength={5000}
                required
              />

              <label htmlFor="feedback-photos">Photos (optional)</label>
              <div className="feedback-file-picker">
                <input
                  id="feedback-photos"
                  ref={photosInputRef}
                  className="feedback-file-input"
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/gif"
                  multiple
                  onChange={onPhotoChange}
                />
                <div className="feedback-file-actions">
                  <button
                    type="button"
                    className="btn-secondary feedback-file-button"
                    onClick={() => photosInputRef.current?.click()}
                  >
                    Choose files
                  </button>
                  {photos.length > 0 ? (
                    <button
                      type="button"
                      className="feedback-file-clear"
                      onClick={() => {
                        setPhotos([]);
                        if (photosInputRef.current) {
                          photosInputRef.current.value = '';
                        }
                      }}
                    >
                      Clear
                    </button>
                  ) : null}
                </div>
                <ul className="feedback-file-list" aria-live="polite">
                  {photos.length > 0 ? (
                    photos.map((file) => (
                      <li key={`${file.name}-${file.lastModified}`} className="feedback-file-chip">
                        <span>{file.name}</span>
                        <strong>{formatFileSize(file.size)}</strong>
                      </li>
                    ))
                  ) : (
                    <li className="feedback-file-empty">No files chosen yet.</li>
                  )}
                </ul>
              </div>
              <p className="feedback-help-text">{photoSummary}. Max 5 photos, 5MB each.</p>

              {error ? <p className="error">{error}</p> : null}

              <button type="submit" className="btn-primary" disabled={submitting}>
                {submitting ? 'Submitting...' : 'Submit Feedback'}
              </button>
            </form>
          </section>
        </>
      )}
    </main>
  );
}
