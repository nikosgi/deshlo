export type AnnotationProviderErrorCode =
  | "AUTH_REQUIRED"
  | "UNMAPPED_HOST"
  | "BASE_BRANCH_NOT_FOUND"
  | "THREAD_NOT_FOUND"
  | "UNKNOWN_COMMIT"
  | "PROVIDER_ERROR";

export class AnnotationProviderError extends Error {
  code: AnnotationProviderErrorCode;

  constructor(code: AnnotationProviderErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}
