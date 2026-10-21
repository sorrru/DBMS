export interface MutableTextState {
  value: string;
}

export function resetFeedbackAfterSignOut(
  message: MutableTextState,
  publishError: MutableTextState,
): void {
  message.value = "";
  publishError.value = "";
}
