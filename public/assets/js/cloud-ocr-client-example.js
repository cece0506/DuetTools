// 前端调用 Cloudflare OCR 中间层示例
// 使用方式：
// import { recognizeByCloudOcr } from "/assets/js/cloud-ocr-client-example.js";

export async function recognizeByCloudOcr(file, endpoint = "https://your-worker.workers.dev/api/ocr") {
  if (!(file instanceof File)) {
    throw new Error("file 必须是 File 对象");
  }

  const formData = new FormData();
  formData.append("image", file, file.name);

  const response = await fetch(endpoint, {
    method: "POST",
    body: formData,
  });

  const data = await response.json();
  if (!response.ok || !data.ok) {
    throw new Error(data?.error || `OCR 请求失败: ${response.status}`);
  }

  return {
    provider: data.provider,
    parsedText: data.parsedText,
    lines: data.lines,
    raw: data.raw,
  };
}

// 页面内使用示例：
// const file = document.querySelector('#image-input').files[0];
// const result = await recognizeByCloudOcr(file, 'https://your-worker.workers.dev/api/ocr');
// console.log(result.parsedText);
