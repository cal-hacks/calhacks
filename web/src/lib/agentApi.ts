import { forgetIngestToken, ingestToken } from "./live";

// Calls to the agent service (agent/) as the signed-in friend. Requests carry
// the friend's ingest token; the service only stores its hash.

/** Default: port 8000 on the host that served this page (phones use the Mac's LAN address). */
export const AGENT_URL: string =
  (import.meta.env.VITE_AGENT_API_URL as string | undefined) || `http://${location.hostname}:8000`;

export class AgentError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

/**
 * POST JSON as this friend. A 401 means the service doesn't know our token
 * (e.g. after reset_demo), so make a new one and try once more.
 */
export async function agentPost<T = unknown>(path: string, body: unknown): Promise<T> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const token = await ingestToken();
    if (!token) throw new AgentError("Still joining your group. Try again in a moment.", 0);
    let r: Response;
    try {
      r = await fetch(`${AGENT_URL}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      });
    } catch {
      throw new AgentError(`Can't reach the agent service at ${AGENT_URL}.`, 0);
    }
    if (r.status === 401) {
      forgetIngestToken();
      continue;
    }
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new AgentError(typeof data.detail === "string" ? data.detail : `Agent service error ${r.status}`, r.status);
    return data as T;
  }
  throw new AgentError("The agent service didn't accept this device. Try signing out and in.", 401);
}

/** A File as { media_type, data } with base64 data (no data: prefix). */
export function fileToBase64(file: File): Promise<{ media_type: string; data: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const url = String(reader.result);
      resolve({ media_type: file.type, data: url.slice(url.indexOf(",") + 1) });
    };
    reader.onerror = () => reject(reader.error ?? new Error("Couldn't read that file."));
    reader.readAsDataURL(file);
  });
}
