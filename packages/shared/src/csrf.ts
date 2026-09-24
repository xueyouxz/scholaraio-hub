/**
 * The header the server requires on every mutating API request. Another origin
 * cannot send a custom header without a CORS preflight the server never grants,
 * so its presence shows the request came from the Hub's own page.
 */
export const CSRF_HEADER = { name: "ScholarAIO-Hub", value: "true" } as const;
