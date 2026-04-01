import { ApiError } from './httpClient';

describe('ApiError', () => {
  it('stores status and message', () => {
    const err = new ApiError('boom', 500);
    expect(err.message).toBe('boom');
    expect(err.status).toBe(500);
  });
});
