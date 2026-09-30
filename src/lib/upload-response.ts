export function uploadError(value: unknown, fallback: string): string {
  if (typeof value === 'object' && value !== null && 'error' in value && typeof value.error === 'string') {
    return value.error;
  }
  return fallback;
}

export function parseUploadResponse(value: unknown): { receiptId: string; imagePath: string } {
  if (
    typeof value !== 'object' ||
    value === null ||
    !('receiptId' in value) ||
    !('imagePath' in value) ||
    typeof value.receiptId !== 'string' ||
    typeof value.imagePath !== 'string'
  ) {
    throw new Error('Invalid upload response');
  }
  return { receiptId: value.receiptId, imagePath: value.imagePath };
}
