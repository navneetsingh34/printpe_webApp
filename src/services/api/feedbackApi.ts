import { apiRequest } from './httpClient';

export type PublicFeedbackInput = {
  email: string;
  message: string;
  photos?: File[];
};

export type PublicFeedbackResult = {
  id: string;
  email: string;
  message: string;
  photoCount: number;
  createdAt: string;
};

export async function submitPublicFeedback(
  input: PublicFeedbackInput,
): Promise<PublicFeedbackResult> {
  const body = new FormData();
  body.append('email', input.email.trim());
  body.append('message', input.message.trim());

  for (const photo of input.photos ?? []) {
    body.append('photos', photo);
  }

  return apiRequest<PublicFeedbackResult>(
    '/feedback',
    {
      method: 'POST',
      body,
    },
    { auth: false },
  );
}
