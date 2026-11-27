import { LIBRARY_PORT_META } from "@scholaraio-hub/shared";

/**
 * Keep the library port metadata for compatibility with older clients.
 * Current clients use /api/library on the page's origin, so remote HTTPS
 * deployments do not need a separately exposed library port.
 */
export function withLibraryPort(html: string, port: number): string {
  const meta = `<meta name="${LIBRARY_PORT_META}" content="${port}" />`;
  return html.includes("</head>") ? html.replace("</head>", `  ${meta}\n  </head>`) : meta + html;
}
