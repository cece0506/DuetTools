# React + Vite

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react/README.md) uses [Babel](https://babeljs.io/) for Fast Refresh
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react-swc) uses [SWC](https://swc.rs/) for Fast Refresh

## Cloudflare OCR Proxy (Serverless)

本仓库包含一个 Cloudflare Serverless OCR 中间层示例，用于保护云厂商 API 密钥不暴露到前端。

- Worker 代码：`cloudflare/worker.js`
- Wrangler 配置：`cloudflare/wrangler.toml`
- 前端调用示例：`public/assets/js/cloud-ocr-client-example.js`

### 1. 安装并登录 Wrangler

```bash
npm i -g wrangler
wrangler login
```

### 2. 配置密钥（不要写进前端）

在 `cloudflare` 目录执行：

```bash
wrangler secret put BAIDU_API_KEY
wrangler secret put BAIDU_SECRET_KEY
wrangler secret put TONGYI_API_KEY
```

### 3. 发布 Serverless API

```bash
cd cloudflare
wrangler deploy
```

部署后会得到地址，例如：

`https://group-order-ocr-proxy.<subdomain>.workers.dev/api/ocr`

### 4. 前端调用

```js
import { recognizeByCloudOcr } from "/assets/js/cloud-ocr-client-example.js";

const file = document.querySelector("#image-input").files[0];
const result = await recognizeByCloudOcr(
	file,
	"https://group-order-ocr-proxy.<subdomain>.workers.dev/api/ocr",
);

console.log(result.parsedText);
```

### 5. 切换 OCR 提供商

在 `cloudflare/wrangler.toml` 修改：

- `OCR_PROVIDER = "baidu"` 使用百度 OCR
- `OCR_PROVIDER = "tongyi"` 使用通义千问（多模态）

注意：通义返回是模型生成文本，格式稳定性会受提示词和图片质量影响。
