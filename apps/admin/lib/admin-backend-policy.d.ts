export function adminApiBaseUrl(env?: NodeJS.ProcessEnv): string;
export function adminApiTimeoutMs(env?: NodeJS.ProcessEnv): number;
export function adminApiMaxResponseBytes(env?: NodeJS.ProcessEnv): number;
export function adminBackendUrl(path: string, env?: NodeJS.ProcessEnv): string;
export function adminBackendFetch(
  path: string,
  init?: RequestInit,
  env?: NodeJS.ProcessEnv,
  fetchImpl?: typeof fetch,
): Promise<Response>;
export function readBoundedAdminBackendText(response: Response, env?: NodeJS.ProcessEnv): Promise<string>;
