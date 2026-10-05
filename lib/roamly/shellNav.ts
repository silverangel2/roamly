/** One primary nav item is current. Trip pages belong to Trips, never also to Alerts. */

export function primaryNavActiveHref(pathname: string, hrefs: readonly string[]) {
  const path = (pathname || "/").split(/[?#]/)[0] || "/";
  let bestHref = "";
  let bestScore = -1;
  for (const href of hrefs) {
    if (!href || href.startsWith("#")) continue;
    let score = -1;
    if (href === "/dashboard" && (path === "/dashboard" || path.startsWith("/trip/"))) score = 80;
    else if (href === "/") score = path === "/" ? 100 : -1;
    else if (path === href) score = 200 + href.length;
    else if (href.length > 1 && path.startsWith(`${href}/`)) score = href.length;
    if (score > bestScore) {
      bestScore = score;
      bestHref = href;
    }
  }
  return bestHref;
}
