export interface SendEmailJob {
  to: string;
  subject: string;
  template: string;
  data: Record<string, unknown>;
}
