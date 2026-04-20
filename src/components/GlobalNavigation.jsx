import { useEffect, useMemo, useState } from 'react'
import { loadNavigationLinks, normalizeUrl } from '../config/navigationLinks'

function linkClass(current, target) {
  return current === normalizeUrl(target) ? 'is-active' : ''
}

function GlobalNavigation() {
  const [links, setLinks] = useState({ home: '#', blog: '#', tools: '#' })
  const currentUrl = useMemo(() => normalizeUrl(window.location.href), [])

  useEffect(() => {
    let mounted = true
    void loadNavigationLinks().then((resolvedLinks) => {
      if (!mounted) {
        return
      }
      setLinks(resolvedLinks)
    })
    return () => {
      mounted = false
    }
  }, [])

  return (
    <>
      <nav className="top-nav" data-global-top-nav>
        <a className="brand" href="/">
          DUET<small>visual notes</small>
        </a>
        <div className="nav-links">
          <a className={linkClass(currentUrl, links.home)} href={links.home}>
            首页
          </a>
          <a className={linkClass(currentUrl, links.blog)} href={links.blog}>
            博客
          </a>
          <a className={linkClass(currentUrl, links.tools)} href={links.tools}>
            工具
          </a>
        </div>
      </nav>

      <aside className="side-nav" aria-label="侧边导航" data-global-side-nav>
        <a className={linkClass(currentUrl, links.home)} href={links.home}>
          首页
        </a>
        <a className={linkClass(currentUrl, links.blog)} href={links.blog}>
          博客
        </a>
        <a className={linkClass(currentUrl, links.tools)} href={links.tools}>
          工具
        </a>
        <button
          type="button"
          className="side-nav-top"
          aria-label="回到顶部"
          onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
        >
          顶部
        </button>
      </aside>
    </>
  )
}

export default GlobalNavigation
