import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import type { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';
import { fileTypeFromBuffer } from 'file-type';
import { AppError } from './errors.js';

export type UploadPurpose = 'material' | 'submission';

const DOCS: Record<string, string> = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  png: 'image/png',
  jpg: 'image/jpeg',
  webp: 'image/webp',
};
const MEDIA: Record<string, string> = { mp4: 'video/mp4', mp3: 'audio/mpeg' };
const TEXT: Record<string, string> = { txt: 'text/plain', md: 'text/markdown', csv: 'text/csv' };

export const ALLOWED_EXTENSIONS: Record<UploadPurpose, string[]> = {
  submission: [...Object.keys(DOCS), ...Object.keys(TEXT)],
  material: [...Object.keys(DOCS), ...Object.keys(TEXT), ...Object.keys(MEDIA)],
};

export interface StoredFile {
  storageKey: string;
  sizeBytes: number;
  sha256: string;
  mimeType: string;
  originalName: string;
}

/** Strips paths and control characters; keeps a readable, bounded display name. */
export function sanitizeFilename(name: string): string {
  const base = path.basename(name.replace(/\\/g, '/'));
  // eslint-disable-next-line no-control-regex -- stripping control characters is the point
  const cleaned = base.replace(/[\u0000-\u001f\u007f<>:"|?*]/g, '_').trim().slice(0, 200);
  return cleaned || 'upload';
}

function looksLikeUtf8Text(sample: Buffer): boolean {
  if (sample.includes(0)) return false;
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(sample.subarray(0, Math.min(sample.length, 4096)));
    return true;
  } catch {
    // a multi-byte character may be cut at the sample boundary; retry slightly shorter
    try {
      new TextDecoder('utf-8', { fatal: true }).decode(sample.subarray(0, Math.max(0, Math.min(sample.length, 4096) - 3)));
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * Local-disk storage. Files live outside the web root under random keys; the database row
 * (with RLS) is the only way to locate and authorize access to a file.
 */
export class FileStore {
  constructor(private readonly root: string, private readonly maxBytes: number) {}

  private full(key: string) {
    if (!/^[a-f0-9]{2}\/[a-f0-9-]{36}$/.test(key)) throw new Error('invalid storage key');
    return path.join(this.root, key);
  }

  async save(stream: Readable, originalName: string, purpose: UploadPurpose): Promise<StoredFile> {
    const id = randomUUID();
    const key = `${id.replace(/-/g, '').slice(0, 2)}/${id}`;
    const dir = path.join(this.root, key.slice(0, 2));
    await mkdir(dir, { recursive: true });
    const tmp = path.join(dir, `.${id}.part`);
    const hasher = createHash('sha256');
    let size = 0;
    const head: Buffer[] = [];
    let headLen = 0;
    const max = this.maxBytes;

    const meter = new Transform({
      transform(chunk: Buffer, _enc, cb) {
        size += chunk.length;
        if (size > max) return cb(new AppError(413, 'payload_too_large', `Files must be ${Math.round(max / 1048576)} MB or smaller`));
        hasher.update(chunk);
        if (headLen < 4100) {
          head.push(chunk);
          headLen += chunk.length;
        }
        cb(null, chunk);
      },
    });

    try {
      await pipeline(stream, meter, createWriteStream(tmp, { flags: 'wx', mode: 0o640 }));
      if ((stream as Readable & { truncated?: boolean }).truncated) {
        throw new AppError(413, 'payload_too_large', `Files must be ${Math.round(max / 1048576)} MB or smaller`);
      }
      if (size === 0) throw new AppError(422, 'unprocessable', 'The file is empty');

      const safeName = sanitizeFilename(originalName);
      const ext = path.extname(safeName).slice(1).toLowerCase();
      const allowed = ALLOWED_EXTENSIONS[purpose];
      const sample = Buffer.concat(head);
      const detected = await fileTypeFromBuffer(sample);
      let mime: string | undefined;

      if (detected) {
        const normalizedExt = detected.ext === 'jpg' ? 'jpg' : detected.ext;
        const extOk = normalizedExt === ext || (normalizedExt === 'jpg' && ext === 'jpeg');
        if (allowed.includes(normalizedExt) && extOk) mime = DOCS[normalizedExt] ?? MEDIA[normalizedExt];
      } else if (TEXT[ext] && allowed.includes(ext) && looksLikeUtf8Text(sample)) {
        mime = TEXT[ext];
      }
      if (!mime) {
        throw new AppError(415, 'unsupported_media_type',
          `This file type is not accepted. Allowed: ${allowed.map((e) => '.' + e).join(', ')}`);
      }

      await rename(tmp, path.join(this.root, key));
      return { storageKey: key, sizeBytes: size, sha256: hasher.digest('hex'), mimeType: mime, originalName: safeName };
    } catch (err) {
      await rm(tmp, { force: true });
      throw err;
    }
  }

  async open(key: string): Promise<{ stream: Readable; size: number }> {
    const p = this.full(key);
    const s = await stat(p);
    return { stream: createReadStream(p), size: s.size };
  }

  async remove(key: string) {
    await rm(this.full(key), { force: true });
  }
}
