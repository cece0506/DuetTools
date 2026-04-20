const DEFAULT_NAV_LINKS = {
  home: "https://duetpalace.top",
  blog: "https://duetpalace.top/pages/blog.html/",
  tools: "https://duetpalace.top/pages/tools.html/",
};

function mergeLinks(production = {}, development = {}) {
  return {
    home: development.home || production.home || DEFAULT_NAV_LINKS.home,
    blog: development.blog || production.blog || DEFAULT_NAV_LINKS.blog,
    tools: development.tools || production.tools || DEFAULT_NAV_LINKS.tools,
  };
}

export async function loadNavigationLinks() {
  try {
    const response = await fetch("/data/nav-links.json", { cache: "no-store" });
    if (!response.ok) {
      throw new Error("Failed to load nav links");
    }
    const config = await response.json();
    const production = config.production || {};
    const development = config.development || {};
    if (import.meta.env.DEV) {
      return mergeLinks(production, development);
    }
    return mergeLinks(production, production);
  } catch {
    return { ...DEFAULT_NAV_LINKS };
  }
}

export function normalizeUrl(url) {
  try {
    const normalized = new URL(url, window.location.origin);
    return normalized.href.replace(/\/$/, "");
  } catch {
    return String(url || "").replace(/\/$/, "");
  }
}
