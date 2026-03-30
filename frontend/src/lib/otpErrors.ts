/**
 * Shared OTP error handler for verification and phone-link flows.
 * Maps API error codes to translated user-facing messages.
 */
import { captureError } from '@/lib/sentryHelpers';
import type { ApiError } from '@/lib/api-utils';

type TranslateFn = (key: string) => string;

export function handleOtpVerifyError(
    err: unknown,
    t: TranslateFn,
    setError: (msg: string) => void,
    context: string,
    tags: Record<string, string>,
) {
    const axiosErr = err as ApiError;
    const errCode = axiosErr.response?.data?.error;
    if (errCode === 'invalid_code') setError(t('invalidCode'));
    else if (errCode === 'code_expired') setError(t('codeExpired'));
    else if (errCode === 'too_many_attempts' || axiosErr.response?.status === 429) setError(t('tooManyAttempts'));
    else setError(t('loginError'));
    captureError(err, context, { tags });
}
