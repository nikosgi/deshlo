import type { ActionFailure, ActionResult, SourceInspectorErrorCode } from "./types";

export class SourceInspectorError extends Error {
  code: SourceInspectorErrorCode;

  constructor(code: SourceInspectorErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

export function toActionError(error: unknown): ActionFailure {
  if (error instanceof SourceInspectorError) {
    return {
      ok: false,
      code: error.code,
      message: error.message,
    };
  }

  const message = error instanceof Error ? error.message : "Unexpected provider error.";

  return {
    ok: false,
    code: "PROVIDER_ERROR",
    message,
  };
}

export function toActionSuccess<T>(data: T): ActionResult<T> {
  return {
    ok: true,
    data,
  };
}
