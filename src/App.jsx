import './App.css'

function App() {
  const toolItems = [
    {
      name: '波点图案生成器',
      description: '按厘米尺寸、DPI 与多图层参数生成可下载 PNG。',
      href: '/polka-dot-generator.html',
    },
    {
      name: 'Rain Clock',
      description: '全屏雨滴与磨砂玻璃时钟。',
      href: '/rain-clock.html',
    },
  ]

  return (
    <main className="tools-home">
      <section className="tools-hero">
        <p className="tools-kicker">Tools Subdomain</p>
        <h1>独立工具站</h1>
        <p>这里承载从 blog 迁移出的工具页，支持独立部署与迭代。</p>
      </section>
      <section className="tools-grid">
        {toolItems.map((tool) => (
          <a className="tool-card" href={tool.href} key={tool.href}>
            <h2>{tool.name}</h2>
            <p>{tool.description}</p>
            <span>打开工具</span>
          </a>
        ))}
      </section>
      <footer className="tools-footer">
        <small>部署后可将 blog 的工具入口改为该子域名链接。</small>
      </footer>
    </main>
  )
}
export default App
