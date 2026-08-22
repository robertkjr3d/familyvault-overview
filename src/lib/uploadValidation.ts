// Client-side pre-upload validation — shared by every place in the app that
// uploads to Supabase Storage (DocumentsList, OnboardingWizard, inventory.tsx).
//
// IMPORTANT: this is a UX layer only, NOT the real security boundary. The
// actual enforcement lives server-side on the Supabase buckets themselves
// (file_size_limit + allowed_mime_types on storage.buckets), which cannot be
// bypassed even by someone calling the Storage API directly instead of using
// this app. This file exists purely so a real user gets an instant, plain-
// language message instead of waiting through a failed upload and seeing a
// raw Supabase error. If these numbers ever change, they MUST be updated to
// match the live bucket config (Supabase SQL Editor:
// select id, file_size_limit, allowed_mime_types from storage.buckets;)
// — this file has no way to read that config automatically.

export const VAULT_DOC_MAX_BYTES = 10 * 1024 * 1024; // 10MB — matches live vault-docs bucket
export const VAULT_DOC_ALLOWED_MIME = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
] as const;

export const INVENTORY_PHOTO_MAX_BYTES = 5 * 1024 * 1024; // 5MB — matches live inventory-photos bucket
export const INVENTORY_PHOTO_ALLOWED_MIME = [
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;

export function humanSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)}KB`;
  return `${bytes} bytes`;
}

function friendlyTypeList(mimeTypes: readonly string[]): string {
  const labels: Record<string, string> = {
    "image/jpeg": "JPEG",
    "image/png": "PNG",
    "image/webp": "WebP",
    "application/pdf": "PDF",
  };
  return mimeTypes.map((m) => labels[m] ?? m).join(", ");
}

export type FileValidationResult = { ok: true } | { ok: false; message: string };

/**
 * Checks a file against a max size and an allowed MIME type list, returning
 * a plain-language message on failure. Call this BEFORE starting any upload
 * (or, for inventory photos, again on the compressed output right before the
 * actual upload call — see note in the inventory/onboarding call sites about
 * why both checks matter).
 */
export function validateFile(
  file: File,
  opts: { maxBytes: number; allowedMime: readonly string[]; label?: string },
): FileValidationResult {
  const label = opts.label ?? "That file";
  if (opts.allowedMime.length > 0 && !opts.allowedMime.includes(file.type)) {
    return {
      ok: false,
      message: `${label} isn't a supported file type. Allowed: ${friendlyTypeList(opts.allowedMime)}.`,
    };
  }
  if (file.size > opts.maxBytes) {
    return {
      ok: false,
      message: `${label} is too large (${humanSize(file.size)}). Max size is ${humanSize(opts.maxBytes)}.`,
    };
  }
  return { ok: true };
}

export function validateVaultDoc(file: File): FileValidationResult {
  return validateFile(file, {
    maxBytes: VAULT_DOC_MAX_BYTES,
    allowedMime: VAULT_DOC_ALLOWED_MIME,
    label: "This document",
  });
}

export function validateInventoryPhoto(file: File): FileValidationResult {
  return validateFile(file, {
    maxBytes: INVENTORY_PHOTO_MAX_BYTES,
    allowedMime: INVENTORY_PHOTO_ALLOWED_MIME,
    label: "This photo",
  });
}
