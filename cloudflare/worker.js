const TOKEN_CACHE = {
  accessToken: "",
  expiresAt: 0,
};

function corsHeaders(origin = "*") {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
  };
}

function jsonResponse(data, status = 200, origin = "*") {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...corsHeaders(origin),
    },
  });
}

function errorResponse(message, status = 400, origin = "*") {
  return jsonResponse(
    {
      ok: false,
      error: message,
    },
    status,
    origin,
  );
}

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

async function parseImageFromRequest(request) {
  const contentType = request.headers.get("content-type") || "";

  if (contentType.includes("multipart/form-data")) {
    const formData = await request.formData();
    const imageFile = formData.get("image");
    if (!(imageFile instanceof File)) {
      throw new Error("表单中缺少 image 文件字段");
    }

    const buffer = await imageFile.arrayBuffer();
    return {
      imageBase64: arrayBufferToBase64(buffer),
      mimeType: imageFile.type || "image/png",
      fileName: imageFile.name || "upload.png",
    };
  }

  if (contentType.includes("application/json")) {
    const body = await request.json();
    if (typeof body.imageBase64 !== "string" || !body.imageBase64.trim()) {
      throw new Error("JSON body 缺少 imageBase64");
    }

    const cleaned = body.imageBase64.replace(/^data:image\/[a-zA-Z+]+;base64,/, "").trim();
    return {
      imageBase64: cleaned,
      mimeType: typeof body.mimeType === "string" ? body.mimeType : "image/png",
      fileName: typeof body.fileName === "string" ? body.fileName : "upload.png",
    };
  }

  throw new Error("不支持的 Content-Type，请使用 multipart/form-data 或 application/json");
}

async function getBaiduAccessToken(env) {
  if (!env.BAIDU_API_KEY || !env.BAIDU_SECRET_KEY) {
    throw new Error("缺少 BAIDU_API_KEY 或 BAIDU_SECRET_KEY");
  }

  const now = Date.now();
  if (TOKEN_CACHE.accessToken && TOKEN_CACHE.expiresAt > now + 60 * 1000) {
    return TOKEN_CACHE.accessToken;
  }

  const tokenUrl =
    "https://aip.baidubce.com/oauth/2.0/token" +
    `?grant_type=client_credentials&client_id=${encodeURIComponent(env.BAIDU_API_KEY)}` +
    `&client_secret=${encodeURIComponent(env.BAIDU_SECRET_KEY)}`;

  const tokenResponse = await fetch(tokenUrl, {
    method: "POST",
  });

  if (!tokenResponse.ok) {
    const text = await tokenResponse.text();
    throw new Error(`百度鉴权失败: ${tokenResponse.status} ${text}`);
  }

  const tokenData = await tokenResponse.json();
  if (!tokenData.access_token) {
    throw new Error("百度鉴权响应中不存在 access_token");
  }

  TOKEN_CACHE.accessToken = tokenData.access_token;
  TOKEN_CACHE.expiresAt = now + Number(tokenData.expires_in || 0) * 1000;
  return TOKEN_CACHE.accessToken;
}

async function callBaiduOcr(imageBase64, env) {
  const accessToken = await getBaiduAccessToken(env);
  const endpoint =
    `https://aip.baidubce.com/rest/2.0/ocr/v1/accurate_basic?access_token=${encodeURIComponent(accessToken)}`;

  const form = new URLSearchParams();
  form.set("image", imageBase64);
  form.set("language_type", "CHN_ENG");

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: form.toString(),
  });

  const data = await response.json();
  if (!response.ok || data.error_code) {
    throw new Error(`百度 OCR 调用失败: ${data.error_msg || response.statusText}`);
  }

  const lines = Array.isArray(data.words_result)
    ? data.words_result.map((item) => item.words).filter(Boolean)
    : [];

  return {
    provider: "baidu",
    parsedText: lines.join("\n"),
    lines,
    raw: data,
  };
}

function normalizeTongyiContent(content) {
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (!part) {
          return "";
        }
        if (typeof part.text === "string") {
          return part.text;
        }
        if (typeof part === "string") {
          return part;
        }
        return "";
      })
      .filter(Boolean)
      .join("\n");
  }
  return "";
}

async function callTongyiOcr(imageBase64, mimeType, env) {
  if (!env.TONGYI_API_KEY) {
    throw new Error("缺少 TONGYI_API_KEY");
  }

  const endpoint = "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions";
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.TONGYI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: env.TONGYI_MODEL || "qwen-vl-max-latest",
      temperature: 0,
      messages: [
        {
          role: "system",
          content: "你是 OCR 引擎。只输出提取的纯文本，按原顺序分行，不要解释。",
        },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: "请识别这张订单截图中的所有可读文本。",
            },
            {
              type: "image_url",
              image_url: {
                url: `data:${mimeType};base64,${imageBase64}`,
              },
            },
          ],
        },
      ],
    }),
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(`通义 OCR 调用失败: ${response.status} ${JSON.stringify(data)}`);
  }

  const content = data?.choices?.[0]?.message?.content;
  const parsedText = normalizeTongyiContent(content);

  return {
    provider: "tongyi",
    parsedText,
    lines: parsedText.split(/\r?\n/).map((line) => line.trim()).filter(Boolean),
    raw: data,
  };
}

export default {
  async fetch(request, env) {
    const allowOrigin = env.CORS_ORIGIN || "*";

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders(allowOrigin),
      });
    }

    const { pathname } = new URL(request.url);
    if (pathname !== "/api/ocr") {
      return errorResponse("Not Found", 404, allowOrigin);
    }

    if (request.method !== "POST") {
      return errorResponse("Method Not Allowed", 405, allowOrigin);
    }

    try {
      const { imageBase64, mimeType, fileName } = await parseImageFromRequest(request);
      const provider = (env.OCR_PROVIDER || "baidu").toLowerCase();

      let result;
      if (provider === "tongyi") {
        result = await callTongyiOcr(imageBase64, mimeType, env);
      } else {
        result = await callBaiduOcr(imageBase64, env);
      }

      return jsonResponse(
        {
          ok: true,
          provider: result.provider,
          fileName,
          parsedText: result.parsedText,
          lines: result.lines,
          raw: result.raw,
        },
        200,
        allowOrigin,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      return errorResponse(message, 500, allowOrigin);
    }
  },
};
