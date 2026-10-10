import { Buffer } from "node:buffer";

// Buffer's codec is native, which matters under the free plan's 10 ms CPU cap:
// a JS loop over a multi-megabyte image would eat most of it.
export const fromBase64 = (b64: string): Uint8Array => new Uint8Array(Buffer.from(b64, "base64"));
export const toBase64 = (bytes: Uint8Array): string => Buffer.from(bytes).toString("base64");
