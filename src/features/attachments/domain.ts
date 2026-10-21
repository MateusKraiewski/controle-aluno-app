// Pure attachment rules: limits, content type detection from magic bytes, display
// name sanitising and the stored (UUID) file names. No React, no Expo, no SQLite.
import type { Result } from '../lessons/domain';

export const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;
export const MAX_ATTACHMENTS_PER_LESSON = 10;
/** Display names are at most this many characters (code points), extension included. */
export const MAX_ATTACHMENT_NAME = 120;
/** Bytes read from the start of a file to detect its type. */
export const SNIFF_BYTES = 4096;

export const ATTACHMENT_MIMES = ['application/pdf', 'image/png', 'image/jpeg', 'image/webp', 'text/plain'] as const;
export type AttachmentMime = (typeof ATTACHMENT_MIMES)[number];

/** Accepted extensions per type; the first one is canonical (used for stored and fixed names). */
const EXTENSIONS: Record<AttachmentMime, readonly string[]> = {
  'application/pdf': ['pdf'],
  'image/png': ['png'],
  'image/jpeg': ['jpg', 'jpeg'],
  'image/webp': ['webp'],
  'text/plain': ['txt', 'text', 'md', 'csv'],
};

export function isAttachmentMime(value: unknown): value is AttachmentMime {
  return typeof value === 'string' && (ATTACHMENT_MIMES as readonly string[]).includes(value);
}

export function canonicalExtension(mime: AttachmentMime): string {
  return EXTENSIONS[mime][0];
}

function startsWith(bytes: Uint8Array, prefix: readonly number[], offset = 0): boolean {
  if (bytes.length < offset + prefix.length) return false;
  return prefix.every((value, index) => bytes[offset + index] === value);
}

/**
 * True when the sample is UTF-8 text without NUL or control characters other than
 * tab, line feed, form feed and carriage return. `complete` says the sample is the
 * whole file; otherwise a multi-byte sequence cut at the end of the sample is accepted.
 */
function isUtf8Text(bytes: Uint8Array, complete: boolean): boolean {
  let index = startsWith(bytes, [0xef, 0xbb, 0xbf]) ? 3 : 0;
  if (index >= bytes.length) return false;
  while (index < bytes.length) {
    const byte = bytes[index];
    if (byte < 0x80) {
      if ((byte < 0x20 && byte !== 0x09 && byte !== 0x0a && byte !== 0x0c && byte !== 0x0d) || byte === 0x7f) return false;
      index += 1;
      continue;
    }
    let length: number;
    let min = 0x80;
    let max = 0xbf;
    if (byte >= 0xc2 && byte <= 0xdf) length = 2;
    else if (byte >= 0xe0 && byte <= 0xef) {
      length = 3;
      if (byte === 0xe0) min = 0xa0; // overlong
      if (byte === 0xed) max = 0x9f; // UTF-16 surrogates
    } else if (byte >= 0xf0 && byte <= 0xf4) {
      length = 4;
      if (byte === 0xf0) min = 0x90; // overlong
      if (byte === 0xf4) max = 0x8f; // above U+10FFFF
    } else return false;
    for (let offset = 1; offset < length; offset += 1) {
      const position = index + offset;
      if (position >= bytes.length) return !complete;
      const next = bytes[position];
      if (offset === 1 ? next < min || next > max : next < 0x80 || next > 0xbf) return false;
    }
    index += length;
  }
  return true;
}

/**
 * Content type from the first bytes of the file (never from its name or the type the
 * picker reports): PDF, PNG, JPEG, WebP, or UTF-8 plain text. Null for anything else.
 */
export function detectMime(head: Uint8Array, complete: boolean): AttachmentMime | null {
  if (head.length === 0) return null;
  if (startsWith(head, [0x25, 0x50, 0x44, 0x46, 0x2d])) return 'application/pdf'; // %PDF-
  if (startsWith(head, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  if (startsWith(head, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (startsWith(head, [0x52, 0x49, 0x46, 0x46]) && startsWith(head, [0x57, 0x45, 0x42, 0x50], 8)) return 'image/webp'; // RIFF....WEBP
  return isUtf8Text(head, complete) ? 'text/plain' : null;
}

export type AttachmentCheckError = 'empty' | 'tooLarge' | 'unsupportedType';

/** Size limit and content type of a candidate file, from its size and first bytes. */
export function checkAttachment(sizeBytes: number, head: Uint8Array): Result<AttachmentMime, AttachmentCheckError> {
  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) return { ok: false, error: 'empty' };
  if (sizeBytes > MAX_ATTACHMENT_BYTES) return { ok: false, error: 'tooLarge' };
  const mime = detectMime(head, sizeBytes <= head.length);
  return mime ? { ok: true, value: mime } : { ok: false, error: 'unsupportedType' };
}

const RESERVED_WINDOWS_NAMES = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i;

/**
 * Display name kept in SQLite and used when sharing: last path segment only, no
 * control, bidirectional-override or zero-width characters, no characters reserved
 * on common file systems, whitespace collapsed, no leading/trailing dots or spaces,
 * at most 120 characters, and an extension that matches the detected type (the
 * canonical one is appended when missing or different). Empty results use `fallback`.
 */
export function sanitizeFileName(input: string, mime: AttachmentMime, fallback = 'anexo'): string {
  let name = typeof input === 'string' ? input : '';
  try { name = name.normalize('NFC'); } catch { /* keep as is */ }
  name = name.split(/[\\/]/).pop() ?? '';
  name = name
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, '')
    .replace(/[​-‏‪-‮⁠-⁩﻿]/g, '')
    .replace(/[<>:"|?*]/g, '_')
    .replace(/\s+/g, ' ')
    .replace(/^[\s.]+|[\s.]+$/g, '');
  const dot = name.lastIndexOf('.');
  const extension = dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
  let stem = name;
  let suffix = canonicalExtension(mime);
  if (dot > 0 && EXTENSIONS[mime].includes(extension)) {
    stem = name.slice(0, dot);
    suffix = extension;
  }
  stem = stem.replace(/[\s.]+$/, '');
  if (!stem) stem = fallback;
  if (RESERVED_WINDOWS_NAMES.test(stem)) stem = `_${stem}`;
  const room = MAX_ATTACHMENT_NAME - suffix.length - 1;
  const points = Array.from(stem);
  if (points.length > room) stem = points.slice(0, room).join('').replace(/[\s.]+$/, '') || fallback;
  return `${stem}.${suffix}`;
}

const STORED_NAME = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(pdf|png|jpg|webp|txt)$/;

/** Only names the app generated can be opened or deleted inside the attachment folder. */
export function isStoredFileName(name: unknown): name is string {
  return typeof name === 'string' && STORED_NAME.test(name);
}

export type RandomBytes = (length: number) => Uint8Array;

/** Uses the platform CSPRNG when present; names only need to be unique, not secret. */
export const defaultRandomBytes: RandomBytes = (length) => {
  const bytes = new Uint8Array(length);
  const crypto = (globalThis as { crypto?: { getRandomValues?: (array: Uint8Array) => Uint8Array } }).crypto;
  if (crypto?.getRandomValues) return crypto.getRandomValues(bytes);
  for (let index = 0; index < length; index += 1) bytes[index] = Math.floor(Math.random() * 256);
  return bytes;
};

/** A fresh UUID v4 file name with the type's canonical extension (e.g. `…-….pdf`). */
export function newStoredFileName(mime: AttachmentMime, random: RandomBytes = defaultRandomBytes): string {
  const bytes = random(16);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}.${canonicalExtension(mime)}`;
}

/** Files in the attachment folder that the app created but no row references (e.g. after a crash mid-add). */
export function findOrphans(fileNames: readonly string[], referenced: ReadonlySet<string>): string[] {
  return fileNames.filter((name) => isStoredFileName(name) && !referenced.has(name));
}

/** "820 B", "34 KB", "1.2 MB" with the language's decimal separator. */
export function formatBytes(size: number, language: string): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  const megabytes = Math.round((size / (1024 * 1024)) * 10) / 10;
  let text = String(megabytes);
  try { text = megabytes.toLocaleString(language, { maximumFractionDigits: 1 }); } catch { /* plain number */ }
  return `${text} MB`;
}
