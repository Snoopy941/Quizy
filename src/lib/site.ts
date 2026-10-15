/**
 * Canonical public URL of Quizy. Used for metadata, Open Graph tags and
 * share links so they always point at the production domain.
 * Override with NEXT_PUBLIC_SITE_URL for local/preview deployments.
 */
export const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://quizy.study";

export const SITE_NAME = "Quizy";

/** Join a path onto the canonical site URL. */
export function siteUrl(path = ""): string {
  return `${SITE_URL}${path.startsWith("/") ? path : `/${path}`}`;
}
