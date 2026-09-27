import { LIBRARY_PORT_META } from "@scholaraio-hub/shared";

/**
 * The page with the library service's port in it. The browser calls the
 * service directly, on the host it loaded the page from; the server does not
 * relay library requests. Development (Vite) and production (the build) both
 * serve the page through this.
 */
export function withLibraryPort(html: string, port: number): string {
  const meta = `<meta name="${LIBRARY_PORT_META}" content="${port}" />`;
  return html.includes("</head>") ? html.replace("</head>", `  ${meta}\n  </head>`) : meta + html;
}
