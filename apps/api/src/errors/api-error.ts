export type ErrorCode =
  | "VALIDATION_ERROR"
  | "AUTH_REQUIRED"
  | "AUTH_INVALID"
  | "INVALID_CREDENTIALS"
  | "ORIGIN_NOT_ALLOWED"
  | "NOT_FOUND"
  | "USERNAME_TAKEN"
  | "SURVEY_NOT_FOUND"
  | "VERSION_NOT_EDITABLE"
  | "DRAFT_CONFLICT"
  | "SURVEY_LIMIT_REACHED"
  | "QUESTION_NOT_FOUND"
  | "QUESTION_LIMIT_REACHED"
  | "QUESTION_REFERENCED"
  | "OPTION_REFERENCED"
  | "PUBLISH_BLOCKED"
  | "PUBLISH_WARNINGS_UNCONFIRMED"
  | "DRAFT_ALREADY_EXISTS"
  | "SURVEY_NOT_PUBLISHED"
  | "SOURCE_VERSION_NOT_CURRENT"
  | "PUBLIC_SURVEY_NOT_FOUND"
  | "SURVEY_CLOSED"
  | "SURVEY_EXPIRED"
  | "SESSION_NOT_FOUND"
  | "SESSION_EXPIRED"
  | "SESSION_LIMIT_REACHED"
  | "ALREADY_SUBMITTED"
  | "ANSWER_VALIDATION_FAILED"
  | "SURVEY_VERSION_INVALID"
  | "VERSION_NOT_PUBLISHED"
  | "STATISTICS_UNAVAILABLE"
  | "PAYLOAD_TOO_LARGE"
  | "UNSUPPORTED_MEDIA_TYPE"
  | "RATE_LIMITED"
  | "INTERNAL_ERROR";

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: ErrorCode,
    message: string,
    public readonly details?: Record<string, unknown>,
    public readonly headers?: Record<string, string>,
  ) {
    super(message);
  }
}

export const validationError = (
  field?: string,
  message = "请求参数不符合要求",
) =>
  new ApiError(
    400,
    "VALIDATION_ERROR",
    message,
    field ? { field, path: field } : undefined,
  );
