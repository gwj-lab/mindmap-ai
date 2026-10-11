import { z } from 'zod';

export const s3ConfigSchema = z.object({
  endpoint: z.string().max(2048).transform((value, ctx) => {
    if (!value.trim()) return '';
    try {
      const url = new URL(value.trim());
      if (url.username || url.password || url.search || url.hash || (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)))) throw new Error();
      return url.href.replace(/\/$/u, '');
    } catch { ctx.addIssue({ code: 'custom', message: 'S3 地址必须使用 HTTPS（本机 localhost 可用 HTTP），且不含凭据或查询参数' }); return z.NEVER; }
  }),
  region: z.string().trim().min(1).max(64).regex(/^[a-z0-9-]+$/u),
  bucket: z.string().trim().min(3).max(63).regex(/^[a-z0-9][a-z0-9.-]+[a-z0-9]$/u),
  prefix: z.string().trim().min(1).max(256).refine((value) => !value.includes('\\') && [...value].every((char) => char.charCodeAt(0) >= 32) && value.split('/').every((part) => part && part !== '.' && part !== '..'), '同步目录不能包含空段、反斜杠或 ..'),
  forcePathStyle: z.boolean()
});
export type S3Config = z.infer<typeof s3ConfigSchema>;
export type PublicS3Settings = S3Config & { hasCredentials: boolean };
export const s3SettingsInputSchema = z.object({
  config: s3ConfigSchema,
  credentials: z.object({ accessKeyId: z.string().trim().min(1).max(256).regex(/^[^\s]+$/u), secretAccessKey: z.string().trim().min(1).max(1024).regex(/^[^\s]+$/u), sessionToken: z.string().trim().max(4096).optional() }).optional()
});
export type S3SettingsInput = z.infer<typeof s3SettingsInputSchema>;
export interface S3TransferResult { message: string; fileCount: number; bytes: number; }
