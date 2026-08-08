export interface SendEmailJob {
  to: string;
  subject: string;
  template: string;
  data: Record<string, unknown>;
  // BullMQ/Redis job payloads are JSON-serialized, so a raw Buffer can't
  // survive the queue — the caller must base64-encode the attachment first.
  attachment?: {
    filename: string;
    contentBase64: string;
    contentType: string;
  };
}
