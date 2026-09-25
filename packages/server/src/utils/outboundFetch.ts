import { EnvHttpProxyAgent, type RequestInit, type Response, fetch } from "undici";

let agent: EnvHttpProxyAgent | undefined;

/**
 * `fetch` for requests that leave this machine, honouring `HTTP(S)_PROXY` and
 * `NO_PROXY`.
 *
 * Node's global fetch ignores those variables, so on a network that only
 * reaches api.anthropic.com through a proxy the request goes direct and is
 * refused (403) while the CLI, which does honour them, works fine. The agent
 * is made on first use, after `.env.local` has been loaded into the process.
 */
export function outboundFetch(url: string, init: RequestInit = {}): Promise<Response> {
  agent ??= new EnvHttpProxyAgent();
  return fetch(url, { ...init, dispatcher: agent });
}
