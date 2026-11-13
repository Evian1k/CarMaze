/**
 * Server-side validation for uploaded-file URL references.
 * Every entity that stores an upload reference (chat attachments, incident
 * evidence, POD photos, custody photos, dispute evidence…) validates against
 * this shape so arbitrary external URLs (or /api/files references that were
 * never uploaded through /api/upload) can never be smuggled in.
 */
export const UPLOAD_URL_SHAPE =
  /^\/api\/(media|files)\/[A-Za-z0-9_-]+\.[a-f0-9]{16}\.(jpg|png|webp|pdf)$/

/** zod-compatible refine: value must reference a file uploaded through /api/upload. */
export function isUploadUrl(v: string): boolean {
  return UPLOAD_URL_SHAPE.test(v)
}
