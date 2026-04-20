import './App.css'
import GlobalNavigation from './components/GlobalNavigation'
import { useEffect, useMemo, useState } from 'react'

function resolveToolHref(tool) {
  const raw = String(tool?.url || tool?.path || '').trim()
  if (!raw) {
    return '/'
  }
  if (/^https?:\/\//i.test(raw)) {
    return raw
  }
  return raw.startsWith('/') ? raw : `/${raw}`
}

function isExternalHref(href) {
  return /^https?:\/\//i.test(href)
}

function App() {
  const [toolItems, setToolItems] = useState([])
  const [errorText, setErrorText] = useState('')

  useEffect(() => {
    let mounted = true

    async function loadTools() {
      try {
        const response = await fetch('/data/tools.json')
        if (!response.ok) {
          throw new Error('工具清单读取失败')
        }
        const data = await response.json()
        if (!mounted) {
          return
        }
        setToolItems(Array.isArray(data) ? data : [])
        setErrorText('')
      } catch (error) {
        if (!mounted) {
          return
        }
        setToolItems([])
        setErrorText(error instanceof Error ? error.message : '工具清单暂不可用')
      }
    }

    void loadTools()
    return () => {
      mounted = false
    }
  }, [])

  const hasTools = useMemo(() => toolItems.length > 0, [toolItems])

  return (
    <div className="tools-shell">
      <GlobalNavigation />
      <main className="tools-home">
        <section className="tools-hero">
          <p className="tools-kicker">Tools Subdomain</p>
          <h1>独立工具站</h1>
          <p>这里承载从 blog 迁移出的工具页，支持独立部署与迭代。</p>
        </section>
        <section className="tools-grid">
          {hasTools
            ? toolItems.map((tool) => {
                const href = resolveToolHref(tool)
                const isExternal = isExternalHref(href)
                return (
                  <a
                    className="tool-card"
                    href={href}
                    key={`${tool.name}-${href}`}
                    target={isExternal ? '_blank' : undefined}
                    rel={isExternal ? 'noopener noreferrer' : undefined}
                  >
                    <h2>{tool.name}</h2>
                    <p>{tool.description || ''}</p>
                    <span>打开工具</span>
                  </a>
                )
              })
            : (
              <article className="tool-card tool-card-fallback" aria-live="polite">
                <h2>工具列表暂不可用</h2>
                <p>{errorText || '请稍后刷新重试。'}</p>
                <span>服务降级中</span>
              </article>
              )}
        </section>
        <footer className="tools-footer">
          <small>部署后可将 blog 的工具入口改为该子域名链接。</small>
        </footer>
      </main>
    </div>
  )
}
export default App
