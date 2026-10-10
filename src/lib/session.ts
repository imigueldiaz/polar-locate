import { toByteArray } from 'base64-js';
import { Directory, File, Paths } from 'expo-file-system';

import { jpegWithComment } from './trace';

let dir: Directory | null = null;

function sessionDir(): Directory {
  if (!dir) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    dir = new Directory(Paths.document, 'detections', stamp);
    dir.create({ intermediates: true, idempotent: true });
  }
  return dir;
}

export function saveFrame(base64: string, comment: string): string | null {
  try {
    const jpg = jpegWithComment(toByteArray(base64), comment);
    const file = new File(sessionDir(), `${Date.now()}.jpg`);
    file.write(jpg);
    return file.uri;
  } catch {
    return null;
  }
}

export function appendTrace(obj: unknown): void {
  try {
    new File(sessionDir(), 'trace.jsonl').write(`${JSON.stringify(obj)}\n`, { append: true });
  } catch {
    return;
  }
}

export function traceUri(): string {
  return new File(sessionDir(), 'trace.jsonl').uri;
}
