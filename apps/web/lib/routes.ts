import type { Route } from 'next';

/**
 * typedRoutes can't verify an interpolated path, so dynamic links are built here and
 * nowhere else — one place to get wrong instead of a cast at every call site.
 */
export function locationHref(id: string, tab?: 'users' | 'sessions' | 'business' | 'timeline' | 'notes'): Route {
  return (tab ? `/agency/locations/${id}/${tab}` : `/agency/locations/${id}`) as Route;
}
