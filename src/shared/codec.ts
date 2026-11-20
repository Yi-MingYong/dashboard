/** Payload encoding: JSON → gzip → base64, so the Worker only ever stores and returns opaque text. */

export function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export function fromBase64(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const body = new Blob([bytes as BlobPart]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(body).arrayBuffer());
}

export async function encodePayload(value: unknown): Promise<string> {
  return toBase64(await pipe(new TextEncoder().encode(JSON.stringify(value)), new CompressionStream('gzip')));
}

export async function decodePayload<T = unknown>(b64: string): Promise<T> {
  return JSON.parse(new TextDecoder().decode(await pipe(fromBase64(b64), new DecompressionStream('gzip')))) as T;
}

export function splitChunks(s: string, size: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < s.length; i += size) out.push(s.slice(i, i + size));
  return out.length ? out : [''];
}
