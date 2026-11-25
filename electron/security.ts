function absoluteUrl(value: string): URL | null {
  if (/[\u0000-\u001f\u007f]/.test(value)) return null
  try { return new URL(value) } catch { return null }
}

export function developmentUrl(value: string): string | null {
  const url = absoluteUrl(value)
  return url?.protocol === 'http:' && url.hostname === '127.0.0.1' && url.port &&
    url.pathname === '/' && !url.search && !url.hash && !url.username && !url.password ? url.href : null
}

export function externalUrl(value: string): string | null {
  const url = absoluteUrl(value)
  if (!url || url.username || url.password) return null
  return ['http:', 'https:', 'mailto:'].includes(url.protocol) ? url.href : null
}

export function isAppDocument(target: string, appUrl: string): boolean {
  const requested = absoluteUrl(target)
  if (!requested) return false
  requested.hash = ''
  return requested.href === appUrl
}

export type NavigationDecision =
  | { readonly kind: 'allow' }
  | { readonly kind: 'external'; readonly url: string }
  | { readonly kind: 'deny' }

export function decideNavigation(target: string, appUrl: string): NavigationDecision {
  if (isAppDocument(target, appUrl)) return { kind: 'allow' }
  const url = externalUrl(target)
  return url ? { kind: 'external', url } : { kind: 'deny' }
}
