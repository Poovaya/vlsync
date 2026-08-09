import type { LibraryResponse } from "../shared/types.ts";

export class ApiUnavailableError extends Error {
  constructor(cause?: unknown) {
    super("The media server is not reachable.");
    this.name = "ApiUnavailableError";
    this.cause = cause;
  }
}

/**
 * Fetch the library. A missing server is an expected state (you can still drag
 * a file in), so it surfaces as a typed error the launcher can render calmly.
 */
export async function fetchLibrary(options: { refresh?: boolean } = {}): Promise<LibraryResponse> {
  const url = options.refresh ? "/api/library?refresh=1" : "/api/library";

  let response: Response;
  try {
    response = await fetch(url, { headers: { accept: "application/json" } });
  } catch (err) {
    throw new ApiUnavailableError(err);
  }

  if (!response.ok) {
    throw new Error(`Library request failed with ${response.status}`);
  }

  return (await response.json()) as LibraryResponse;
}
