const DEFAULT_NAV_LINKS = {
  home: "https://duetpalace.top",
  blog: "https://duetpalace.top/pages/blog.html/",
  tools: "https://duetpalace.top/pages/tools.html/",
};

function isDevelopmentEnvironment() {
  const host = window.location.hostname;
  return host === "localhost" || host === "127.0.0.1" || host === "0.0.0.0";
}

function normalizeUrl(url) {
  try {
    const normalized = new URL(url, window.location.origin);
    return normalized.href.replace(/\/$/, "");
  } catch {
    return String(url || "").replace(/\/$/, "");
  }
}

function resolveEnvironmentLinks(config = {}) {
  const production = config.production || {};
  const development = config.development || {};
  const envLinks = isDevelopmentEnvironment() ? development : production;

  return {
    home: envLinks.home || production.home || DEFAULT_NAV_LINKS.home,
    blog: envLinks.blog || production.blog || DEFAULT_NAV_LINKS.blog,
    tools: envLinks.tools || production.tools || DEFAULT_NAV_LINKS.tools,
  };
}

async function loadNavigationLinks() {
  try {
    const response = await fetch("/data/nav-links.json", { cache: "no-store" });
    if (!response.ok) {
      throw new Error("Failed to load nav links config");
    }
    const config = await response.json();
    return resolveEnvironmentLinks(config);
  } catch {
    return { ...DEFAULT_NAV_LINKS };
  }
}

function setActiveNavState(links, scope) {
  const current = normalizeUrl(window.location.href);
  scope.querySelectorAll("[data-nav-link-key]").forEach((anchor) => {
    const key = anchor.getAttribute("data-nav-link-key");
    if (!key || !(key in links)) {
      return;
    }
    if (normalizeUrl(links[key]) === current) {
      anchor.classList.add("is-active");
    }
  });
}

function renderTopNav(container, links) {
  container.innerHTML = `
    <a class="brand" href="/">DUET<small>visual notes</small></a>
    <div class="nav-links">
      <a data-nav-link-key="home" href="${links.home}">首页</a>
      <a data-nav-link-key="blog" href="${links.blog}">博客</a>
      <a data-nav-link-key="tools" href="${links.tools}">工具</a>
    </div>
  `;
  setActiveNavState(links, container);
}

function renderSideNav(container, links) {
  container.innerHTML = `
    <a data-nav-link-key="home" href="${links.home}">首页</a>
    <a data-nav-link-key="blog" href="${links.blog}">博客</a>
    <a data-nav-link-key="tools" href="${links.tools}">工具</a>
    <button type="button" class="side-nav-top" data-scroll-top aria-label="回到顶部">顶部</button>
  `;
  setActiveNavState(links, container);

  const scrollTopButton = container.querySelector("[data-scroll-top]");
  if (scrollTopButton) {
    scrollTopButton.addEventListener("click", () => {
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
  }
}

export async function initGlobalNavigation() {
  const links = await loadNavigationLinks();
  const topNav = document.querySelector("[data-global-top-nav]");
  const sideNav = document.querySelector("[data-global-side-nav]");

  if (topNav) {
    renderTopNav(topNav, links);
  }
  if (sideNav) {
    renderSideNav(sideNav, links);
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => {
    void initGlobalNavigation();
  }, { once: true });
} else {
  void initGlobalNavigation();
}
