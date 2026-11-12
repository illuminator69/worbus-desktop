/**
 * What may be logged of an error from a request that carried credentials: its message, its
 * code and the HTTP status. Never the object itself: an AxiosError keeps the request's `config`
 * (the `x-nd-authorization` Bearer header, a login POST's body with the password) and the
 * response. Pure and import-free (`session-refused.harness.ts`).
 */
export interface ErrorSummary {
    code?: string;
    message: string;
    status?: number;
}

export const errorSummary = (error: unknown): ErrorSummary => {
    if (!error || typeof error !== 'object') return { message: String(error) };
    const e = error as { code?: unknown; message?: unknown; response?: { status?: unknown } };
    const summary: ErrorSummary = {
        message: typeof e.message === 'string' ? e.message : 'unknown error',
    };
    if (typeof e.code === 'string') summary.code = e.code;
    if (typeof e.response?.status === 'number') summary.status = e.response.status;
    return summary;
};
