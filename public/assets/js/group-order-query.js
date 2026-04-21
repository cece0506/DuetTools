/* global Tesseract, XLSX, ExcelJS, echarts, FilePond */

const state = {
  stores: [],
  nextId: 1,
  allExpanded: true,
  clipboardFiles: [],
  imagePond: null,
  excelPond: null,
};

const ui = {
  importMode: document.getElementById("import-mode"),
  imageInput: document.getElementById("image-input"),
  imageInputUi: document.getElementById("image-input-ui"),
  parseImages: document.getElementById("parse-images"),
  excelInput: document.getElementById("excel-input"),
  excelInputUi: document.getElementById("excel-input-ui"),
  importExcel: document.getElementById("import-excel"),
  exportExcel: document.getElementById("export-excel"),
  pasteTrigger: document.getElementById("paste-trigger"),
  clipboardPanel: document.getElementById("clipboard-panel"),
  storeSelector: document.getElementById("store-selector"),
  statusSelector: document.getElementById("status-selector"),
  applyStatus: document.getElementById("apply-status"),
  toggleAll: document.getElementById("toggle-all"),
  clearData: document.getElementById("clear-data"),
  statusText: document.getElementById("status-text"),
  progress: document.getElementById("ocr-progress"),
  tableBody: document.getElementById("order-table-body"),
  dataSummary: document.getElementById("data-summary"),
  chartStoreStatus: document.getElementById("chart-store-status"),
  chartOrderStatus: document.getElementById("chart-order-status"),
};

const storeChart = echarts.init(ui.chartStoreStatus);
const orderChart = echarts.init(ui.chartOrderStatus);

function setStatus(text) {
  ui.statusText.textContent = text;
}

function fileFingerprint(file) {
  return `${file.name}-${file.size}-${file.type}-${file.lastModified}`;
}

function isImageFile(file) {
  return file && typeof file.type === "string" && file.type.startsWith("image/");
}

function collectImageFiles() {
  const merged = [];
  const seen = new Set();

  if (state.imagePond) {
    state.imagePond.getFiles().forEach((item) => {
      if (!item || !item.file || !isImageFile(item.file)) {
        return;
      }
      const key = fileFingerprint(item.file);
      if (!seen.has(key)) {
        seen.add(key);
        merged.push(item.file);
      }
    });
  }

  state.clipboardFiles.forEach((file) => {
    const key = fileFingerprint(file);
    if (!seen.has(key)) {
      seen.add(key);
      merged.push(file);
    }
  });

  Array.from(ui.imageInput.files || []).forEach((file) => {
    if (!isImageFile(file)) {
      return;
    }
    const key = fileFingerprint(file);
    if (!seen.has(key)) {
      seen.add(key);
      merged.push(file);
    }
  });

  return merged;
}

function getSelectedExcelFile() {
  if (state.excelPond) {
    const pondFile = state.excelPond.getFiles()[0];
    if (pondFile && pondFile.file) {
      return pondFile.file;
    }
  }
  return ui.excelInput.files && ui.excelInput.files[0];
}

function syncNativeInputFromPond(pond, targetInput) {
  if (!pond || !targetInput || typeof DataTransfer === "undefined") {
    return;
  }
  const transfer = new DataTransfer();
  pond.getFiles().forEach((item) => {
    if (item && item.file) {
      transfer.items.add(item.file);
    }
  });
  targetInput.files = transfer.files;
}

function initUploadWidgets() {
  if (!window.FilePond) {
    return;
  }

  state.imagePond = FilePond.create(ui.imageInputUi, {
    allowMultiple: true,
    instantUpload: false,
    labelIdle: "拖拽图片到此处或 <span class=\"filepond--label-action\">点击上传</span>",
    acceptedFileTypes: ["image/*"],
  });

  state.excelPond = FilePond.create(ui.excelInputUi, {
    allowMultiple: false,
    instantUpload: false,
    labelIdle: "拖拽 Excel 到此处或 <span class=\"filepond--label-action\">点击上传</span>",
    acceptedFileTypes: [
      "application/vnd.ms-excel",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      ".xls",
      ".xlsx",
    ],
  });

  state.imagePond.on("updatefiles", () => {
    syncNativeInputFromPond(state.imagePond, ui.imageInput);
  });
  state.excelPond.on("updatefiles", () => {
    syncNativeInputFromPond(state.excelPond, ui.excelInput);
  });
}

function sanitizeOcrLines(rawText) {
  return String(rawText || "")
    .split(/\r?\n/)
    .map((line) => normalizeSpace(line))
    .filter((line) => {
      if (!line || line.length < 2) {
        return false;
      }
      if (/^[\W_]+$/.test(line)) {
        return false;
      }

      const usefulMatches = line.match(/[\u4e00-\u9fa5a-zA-Z0-9¥￥xX%:：>》›]/g) || [];
      const usefulRatio = usefulMatches.length / Math.max(line.length, 1);

      if (usefulRatio < 0.45) {
        return false;
      }
      if (/^[A-Za-z0-9]{1,3}$/.test(line)) {
        return false;
      }
      return true;
    });
}

function logOcrText(fileName, rawText) {
  const lines = sanitizeOcrLines(rawText);
  // 只输出可读文本行，忽略被识别成图片噪声的乱码。
  console.group(`[OCR] ${fileName}`);
  console.log(lines.join("\n"));
  console.groupEnd();
}

function loadImageElement(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const objectUrl = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("图片读取失败"));
    };
    img.src = objectUrl;
  });
}

async function preprocessImageForOcr(file) {
  const img = await loadImageElement(file);
  const scale = 2;
  const width = Math.max(1, Math.floor(img.naturalWidth * scale));
  const height = Math.max(1, Math.floor(img.naturalHeight * scale));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) {
    return file;
  }

  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(img, 0, 0, width, height);

  const imageData = ctx.getImageData(0, 0, width, height);
  const data = imageData.data;

  for (let i = 0; i < data.length; i += 4) {
    const gray = Math.round(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]);
    const binary = gray > 160 ? 255 : 0;
    data[i] = binary;
    data[i + 1] = binary;
    data[i + 2] = binary;
  }

  ctx.putImageData(imageData, 0, 0);

  const blob = await new Promise((resolve) => {
    canvas.toBlob((output) => resolve(output), "image/png", 1);
  });

  if (!blob) {
    return file;
  }

  return new File([blob], `${file.name.replace(/\.[^.]+$/, "")}-ocr.png`, {
    type: "image/png",
    lastModified: Date.now(),
  });
}

function normalizeSpace(text) {
  return String(text || "")
    .replace(/\s+/g, " ")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .trim();
}

function moneyFrom(text, fallback = 0) {
  const match = String(text || "").match(/(\d+(?:\.\d+)?)/);
  if (!match) {
    return fallback;
  }
  return Number(match[1]);
}

function parsePriceNumbers(text) {
  const values = [];
  const regex = /(?:¥|￥)?\s*(\d+(?:\.\d+)?)/g;
  let match = regex.exec(text);
  while (match) {
    values.push(Number(match[1]));
    match = regex.exec(text);
  }
  return values;
}

function parseQuantity(text) {
  const direct = String(text || "").match(/x\s*(\d+)/i);
  if (direct) {
    return Number(direct[1]);
  }
  const chinese = String(text || "").match(/(\d+)\s*件/);
  if (chinese) {
    return Number(chinese[1]);
  }
  return 1;
}

function findOrderStatus(blockText) {
  if (/未付款/.test(blockText)) {
    return "未付款";
  }
  if (/已付款/.test(blockText)) {
    return "已付款";
  }
  return "未知";
}

function findProductStatus(blockText) {
  if (/已到货/.test(blockText)) {
    return "已到货";
  }
  if (/备货中/.test(blockText)) {
    return "备货中";
  }
  return "未知";
}

function lineLooksLikeStore(line) {
  const text = normalizeSpace(line);
  if (!text) {
    return false;
  }
  if (/已付款|未付款|备货中|已到货|共\d+件|合计|总计/.test(text)) {
    return false;
  }
  if (/^[¥￥xX\d\s.]+$/.test(text)) {
    return false;
  }
  return /[>》›]/.test(text);
}

function extractStoreName(lines) {
  const candidate = lines.find((line) => lineLooksLikeStore(line));
  if (candidate) {
    const normalized = normalizeSpace(candidate);
    const left = normalized.split(/[>》›]/)[0] || normalized;
    return left.replace(/[\[\]【】()（）]/g, "").trim() || "未识别店铺";
  }

  const fallback = lines.find((line) => {
    const text = normalizeSpace(line);
    if (!text) {
      return false;
    }
    if (/已付款|未付款|备货中|已到货/.test(text)) {
      return false;
    }
    return /[\u4e00-\u9fa5a-zA-Z]/.test(text);
  });

  return fallback ? normalizeSpace(fallback) : "未识别店铺";
}

function cleanProductName(text) {
  return normalizeSpace(text)
    .replace(/^(商品|名称)[:：]?/g, "")
    .replace(/[¥￥].*$/, "")
    .replace(/x\s*\d+.*/i, "")
    .trim();
}

function extractSpec(lines, centerIndex) {
  for (let i = Math.max(0, centerIndex - 2); i <= Math.min(lines.length - 1, centerIndex + 2); i += 1) {
    const text = normalizeSpace(lines[i]);
    if (/规格[:：]/.test(text)) {
      return text.replace(/.*规格[:：]?/, "").trim() || "默认";
    }
    if (/颜色|尺码|容量|版本|套餐/.test(text) && text.length <= 32) {
      return text;
    }
  }
  return "默认";
}

function extractNameNear(lines, centerIndex) {
  for (let i = centerIndex; i >= Math.max(0, centerIndex - 4); i -= 1) {
    const text = cleanProductName(lines[i]);
    if (!text) {
      continue;
    }
    if (/已付款|未付款|备货中|已到货|合计|总计|规格[:：]/.test(text)) {
      continue;
    }
    if (/^[¥￥xX\d\s.]+$/.test(text)) {
      continue;
    }
    if (text.length >= 2) {
      return text;
    }
  }
  return "未识别商品";
}

function parseProducts(lines, fullText) {
  const products = [];

  lines.forEach((line, index) => {
    const raw = normalizeSpace(line);
    if (!raw) {
      return;
    }

    const hasQuantity = /x\s*\d+/i.test(raw) || /\d+\s*件/.test(raw);
    const hasMoney = /¥|￥|\d+(?:\.\d{1,2})/.test(raw);
    if (!hasQuantity && !hasMoney) {
      return;
    }

    const quantity = parseQuantity(raw);
    const prices = parsePriceNumbers(raw);
    const unitPrice = prices[0] || 0;
    const totalPrice = prices[1] || (unitPrice > 0 ? Number((unitPrice * quantity).toFixed(2)) : 0);

    const nearby = lines.slice(Math.max(0, index - 2), Math.min(lines.length, index + 3)).join(" ");
    const orderStatus = findOrderStatus(nearby || fullText);
    const productStatus = findProductStatus(nearby || fullText);
    const productName = extractNameNear(lines, index);
    const spec = extractSpec(lines, index);

    const strongSignal = /x\s*\d+/i.test(raw) || /¥|￥/.test(raw);
    if (!strongSignal) {
      return;
    }

    products.push({
      productName,
      quantity,
      unitPrice,
      spec,
      productStatus,
      orderStatus,
      totalPrice,
    });
  });

  if (products.length > 0) {
    return products;
  }

  const fallbackName = extractNameNear(lines, lines.length - 1);
  return [
    {
      productName: fallbackName,
      quantity: 1,
      unitPrice: 0,
      spec: "默认",
      productStatus: findProductStatus(fullText),
      orderStatus: findOrderStatus(fullText),
      totalPrice: 0,
    },
  ];
}

function parseOrderText(text, sourceName) {
  const lines = String(text || "")
    .split(/\r?\n/)
    .map((line) => normalizeSpace(line))
    .filter(Boolean);

  const fullText = lines.join(" ");
  const storeName = extractStoreName(lines);
  const products = parseProducts(lines, fullText).map((item) => ({
    ...item,
    sourceName,
  }));

  return {
    storeName,
    products,
  };
}

function normalizeStoreKey(name) {
  return normalizeSpace(name).toLowerCase();
}

function productMergeKey(item) {
  return [
    normalizeSpace(item.productName).toLowerCase(),
    normalizeSpace(item.spec).toLowerCase(),
    Number(item.unitPrice || 0).toFixed(2),
    normalizeSpace(item.orderStatus),
  ].join("|");
}

function createStore(name) {
  return {
    id: state.nextId,
    name,
    collapsed: !state.allExpanded,
    products: [],
  };
}

function upsertProducts(parsedRows, mode) {
  if (mode === "replace") {
    state.stores = [];
    state.nextId = 1;
  }

  parsedRows.forEach((row) => {
    if (!row || !row.storeName || !Array.isArray(row.products)) {
      return;
    }

    const key = normalizeStoreKey(row.storeName);
    let store = state.stores.find((item) => normalizeStoreKey(item.name) === key);
    if (!store) {
      store = createStore(row.storeName);
      state.nextId += 1;
      state.stores.push(store);
    }

    row.products.forEach((product) => {
      const mergeKey = productMergeKey(product);
      const existing = store.products.find((item) => productMergeKey(item) === mergeKey);
      if (existing) {
        existing.quantity += Number(product.quantity || 0);
        existing.totalPrice = Number((existing.totalPrice + Number(product.totalPrice || 0)).toFixed(2));
        existing.productStatus = product.productStatus || existing.productStatus;
        existing.sourceName = `${existing.sourceName}; ${product.sourceName}`;
      } else {
        store.products.push({ ...product });
      }
    });
  });

  state.stores = state.stores.filter((store) => store.products.length > 0);
}

function statusBadgeClass(value, type) {
  if (type === "order") {
    if (value === "已付款") {
      return "badge paid";
    }
    if (value === "未付款") {
      return "badge unpaid";
    }
  }
  if (type === "product") {
    if (value === "备货中") {
      return "badge product-ready";
    }
    if (value === "已到货") {
      return "badge product-arrived";
    }
  }
  return "badge";
}

function currency(value) {
  return Number(value || 0).toFixed(2);
}

function renderTable() {
  if (!state.stores.length) {
    ui.tableBody.innerHTML = '<tr><td colspan="7">暂无数据，请先导入图片或 Excel。</td></tr>';
    ui.dataSummary.textContent = "当前无数据";
    return;
  }

  const rows = [];
  let totalItems = 0;
  let totalAmount = 0;

  state.stores.forEach((store) => {
    const storeQty = store.products.reduce((sum, item) => sum + Number(item.quantity || 0), 0);
    const storeAmount = store.products.reduce((sum, item) => sum + Number(item.totalPrice || 0), 0);
    totalItems += storeQty;
    totalAmount += storeAmount;

    rows.push(`
      <tr class="store-row" data-store-row="${store.id}">
        <td>
          <div class="store-cell">
            <button type="button" class="store-toggle" data-toggle-store="${store.id}">${store.collapsed ? "+" : "-"}</button>
            <span class="store-name">${store.name}</span>
          </div>
        </td>
        <td><span class="badge">${store.products.length} 条</span></td>
        <td>${storeQty}</td>
        <td>-</td>
        <td>-</td>
        <td>-</td>
        <td>${currency(storeAmount)}</td>
      </tr>
    `);

    store.products.forEach((item) => {
      rows.push(`
        <tr class="child-row ${store.collapsed ? "child-hidden" : ""}" data-parent-store="${store.id}">
          <td>${item.productName}</td>
          <td><span class="${statusBadgeClass(item.orderStatus, "order")}">${item.orderStatus}</span></td>
          <td>${item.quantity}</td>
          <td>${currency(item.unitPrice)}</td>
          <td>${item.spec || "默认"}</td>
          <td><span class="${statusBadgeClass(item.productStatus, "product")}">${item.productStatus}</span></td>
          <td>${currency(item.totalPrice)}</td>
        </tr>
      `);
    });
  });

  ui.tableBody.innerHTML = rows.join("");
  ui.dataSummary.textContent = `店铺 ${state.stores.length} 家，商品总数 ${totalItems} 件，总金额 ¥${currency(totalAmount)}`;
}

function renderStoreSelector() {
  const options = ['<option value="">请选择店铺</option>'];
  state.stores.forEach((store) => {
    options.push(`<option value="${store.id}">${store.name}</option>`);
  });
  ui.storeSelector.innerHTML = options.join("");
}

function summarizeForCharts() {
  const storeNames = [];
  const preparing = [];
  const arrived = [];
  const paid = [];
  const unpaid = [];

  state.stores.forEach((store) => {
    storeNames.push(store.name);
    let preparingCount = 0;
    let arrivedCount = 0;
    let paidCount = 0;
    let unpaidCount = 0;

    store.products.forEach((item) => {
      if (item.productStatus === "备货中") {
        preparingCount += Number(item.quantity || 0);
      }
      if (item.productStatus === "已到货") {
        arrivedCount += Number(item.quantity || 0);
      }
      if (item.orderStatus === "已付款") {
        paidCount += Number(item.quantity || 0);
      }
      if (item.orderStatus === "未付款") {
        unpaidCount += Number(item.quantity || 0);
      }
    });

    preparing.push(preparingCount);
    arrived.push(arrivedCount);
    paid.push(paidCount);
    unpaid.push(unpaidCount);
  });

  return {
    storeNames,
    preparing,
    arrived,
    paid: paid.reduce((sum, value) => sum + value, 0),
    unpaid: unpaid.reduce((sum, value) => sum + value, 0),
  };
}

function renderCharts() {
  if (!state.stores.length) {
    storeChart.clear();
    orderChart.clear();
    return;
  }

  const summary = summarizeForCharts();

  storeChart.setOption({
    title: {
      text: "各店铺商品状态统计",
      left: "center",
      textStyle: { fontSize: 14 },
    },
    tooltip: { trigger: "axis" },
    legend: { bottom: 0 },
    grid: { left: 50, right: 18, top: 52, bottom: 48 },
    xAxis: {
      type: "category",
      data: summary.storeNames,
      axisLabel: { interval: 0, rotate: summary.storeNames.length > 4 ? 20 : 0 },
    },
    yAxis: { type: "value", name: "件数" },
    series: [
      {
        name: "备货中",
        type: "bar",
        data: summary.preparing,
        itemStyle: { color: "#4f8ed9" },
      },
      {
        name: "已到货",
        type: "bar",
        data: summary.arrived,
        itemStyle: { color: "#2f8f6c" },
      },
    ],
  });

  orderChart.setOption({
    title: {
      text: "订单付款状态占比",
      left: "center",
      textStyle: { fontSize: 14 },
    },
    tooltip: { trigger: "item" },
    legend: { bottom: 0 },
    series: [
      {
        type: "pie",
        radius: ["35%", "65%"],
        data: [
          { value: summary.paid, name: "已付款", itemStyle: { color: "#2f8f6c" } },
          { value: summary.unpaid, name: "未付款", itemStyle: { color: "#d96060" } },
        ],
        label: {
          formatter: "{b}: {c} ({d}%)",
        },
      },
    ],
  });
}

function rerenderAll() {
  renderTable();
  renderStoreSelector();
  renderCharts();
}

async function ocrFile(file, index, total) {
  const preparedFile = await preprocessImageForOcr(file);
  const result = await Tesseract.recognize(preparedFile, "chi_sim+eng", {
    logger: (message) => {
      if (message.status === "recognizing text") {
        const ratio = ((index + message.progress) / total).toFixed(3);
        ui.progress.value = Number(ratio);
      }
      if (message.status) {
        setStatus(`OCR: ${message.status}`);
      }
    },
  });
  const rawText = result?.data?.text || "";
  logOcrText(file.name, rawText);
  return parseOrderText(sanitizeOcrLines(rawText).join("\n"), file.name);
}

async function handleParseImages() {
  const files = collectImageFiles();
  if (!files.length) {
    setStatus("请先选择图片文件。");
    return;
  }

  const mode = ui.importMode.value;
  ui.progress.value = 0;
  setStatus(`开始识别 ${files.length} 张图片...`);

  const parsedRows = [];
  for (let i = 0; i < files.length; i += 1) {
    const parsed = await ocrFile(files[i], i, files.length);
    parsedRows.push(parsed);
  }

  upsertProducts(parsedRows, mode);
  rerenderAll();
  ui.progress.value = 1;
  setStatus(`识别完成：导入 ${files.length} 张图片，当前店铺 ${state.stores.length} 家。`);
}

function excelRowsToParsed(rows) {
  const grouped = new Map();

  rows.forEach((row) => {
    const storeName = normalizeSpace(
      row["店铺名称"] || row["店铺"] || row.storeName || row.store || "",
    );
    const productName = normalizeSpace(
      row["商品名称"] || row.productName || row.product || "",
    );
    if (!storeName || !productName) {
      return;
    }

    const item = {
      productName,
      orderStatus: normalizeSpace(row["订单状态"] || row.orderStatus || "未知") || "未知",
      quantity: Number(row["商品数量"] || row.quantity || 1),
      unitPrice: moneyFrom(row["商品价格"] || row.unitPrice || 0),
      spec: normalizeSpace(row["商品规格"] || row.spec || "默认") || "默认",
      productStatus: normalizeSpace(row["商品状态"] || row.productStatus || "未知") || "未知",
      totalPrice: moneyFrom(row["商品总价"] || row.totalPrice || 0),
      sourceName: "excel-import",
    };

    if (!grouped.has(storeName)) {
      grouped.set(storeName, []);
    }
    grouped.get(storeName).push(item);
  });

  return Array.from(grouped.entries()).map(([storeName, products]) => ({
    storeName,
    products,
  }));
}

async function handleImportExcel() {
  const file = getSelectedExcelFile();
  if (!file) {
    setStatus("请先选择 Excel 文件。");
    return;
  }

  const mode = ui.importMode.value;
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: "array" });
  const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(firstSheet, { defval: "" });

  const parsedRows = excelRowsToParsed(rows);
  upsertProducts(parsedRows, mode);
  rerenderAll();
  setStatus(`Excel 导入完成：${parsedRows.length} 个店铺。`);
}

function collectFlatRows() {
  const rows = [];
  state.stores.forEach((store) => {
    store.products.forEach((item) => {
      rows.push({
        店铺名称: store.name,
        订单状态: item.orderStatus,
        商品名称: item.productName,
        商品数量: item.quantity,
        商品价格: Number(item.unitPrice || 0),
        商品规格: item.spec || "默认",
        商品状态: item.productStatus,
        商品总价: Number(item.totalPrice || 0),
      });
    });
  });
  return rows;
}

function imageBase64FromChart(chart) {
  return chart.getDataURL({
    pixelRatio: 2,
    backgroundColor: "#ffffff",
    type: "png",
  });
}

async function handleExportExcel() {
  if (!state.stores.length) {
    setStatus("暂无可导出数据。");
    return;
  }

  const workbook = new ExcelJS.Workbook();
  const dataSheet = workbook.addWorksheet("订单数据");
  const chartSheet = workbook.addWorksheet("统计图表");

  dataSheet.columns = [
    { header: "店铺名称", key: "店铺名称", width: 24 },
    { header: "订单状态", key: "订单状态", width: 12 },
    { header: "商品名称", key: "商品名称", width: 28 },
    { header: "商品数量", key: "商品数量", width: 10 },
    { header: "商品价格", key: "商品价格", width: 10 },
    { header: "商品规格", key: "商品规格", width: 20 },
    { header: "商品状态", key: "商品状态", width: 12 },
    { header: "商品总价", key: "商品总价", width: 12 },
  ];

  const rows = collectFlatRows();
  rows.forEach((row) => dataSheet.addRow(row));

  dataSheet.getRow(1).font = { bold: true };
  dataSheet.autoFilter = { from: "A1", to: "H1" };

  chartSheet.getCell("A1").value = "拼团订单统计图";
  chartSheet.getCell("A1").font = { size: 16, bold: true };

  const storeChartImage = imageBase64FromChart(storeChart);
  const orderChartImage = imageBase64FromChart(orderChart);

  const storeImageId = workbook.addImage({
    base64: storeChartImage,
    extension: "png",
  });
  const orderImageId = workbook.addImage({
    base64: orderChartImage,
    extension: "png",
  });

  chartSheet.addImage(storeImageId, {
    tl: { col: 0, row: 2 },
    ext: { width: 820, height: 320 },
  });
  chartSheet.addImage(orderImageId, {
    tl: { col: 0, row: 20 },
    ext: { width: 820, height: 320 },
  });

  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });

  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `拼团订单-${Date.now()}.xlsx`;
  anchor.click();
  URL.revokeObjectURL(url);

  setStatus("Excel 导出完成，已包含图表页。");
}

function handleApplyStatus() {
  const storeId = Number(ui.storeSelector.value);
  const status = ui.statusSelector.value;
  if (!storeId) {
    setStatus("请先选择店铺。");
    return;
  }

  const store = state.stores.find((item) => item.id === storeId);
  if (!store) {
    setStatus("未找到对应店铺。");
    return;
  }

  store.products.forEach((item) => {
    item.productStatus = status;
  });

  rerenderAll();
  setStatus(`已将 ${store.name} 下所有商品状态改为 ${status}。`);
}

function handleTableClick(event) {
  const button = event.target.closest("[data-toggle-store]");
  if (!button) {
    return;
  }

  const storeId = Number(button.getAttribute("data-toggle-store"));
  const store = state.stores.find((item) => item.id === storeId);
  if (!store) {
    return;
  }

  store.collapsed = !store.collapsed;
  renderTable();
}

function handleToggleAll() {
  state.allExpanded = !state.allExpanded;
  state.stores.forEach((store) => {
    store.collapsed = !state.allExpanded;
  });
  renderTable();
  setStatus(state.allExpanded ? "已展开全部店铺" : "已收起全部店铺");
}

function handleClearData() {
  state.stores = [];
  state.nextId = 1;
  state.allExpanded = true;
  state.clipboardFiles = [];
  ui.imageInput.value = "";
  ui.excelInput.value = "";
  if (state.imagePond) {
    state.imagePond.removeFiles();
  }
  if (state.excelPond) {
    state.excelPond.removeFiles();
  }
  ui.progress.value = 0;
  rerenderAll();
  setStatus("数据已清空。");
}

function handlePasteEvent(event) {
  const clipboard = event.clipboardData;
  if (!clipboard || !clipboard.items) {
    return;
  }

  const files = Array.from(clipboard.items)
    .filter((item) => item.type && item.type.startsWith("image/"))
    .map((item, index) => {
      const file = item.getAsFile();
      if (!file) {
        return null;
      }
      const extension = (file.type.split("/")[1] || "png").replace("jpeg", "jpg");
      return new File([file], `clipboard-${Date.now()}-${index}.${extension}`, {
        type: file.type,
        lastModified: Date.now(),
      });
    })
    .filter(Boolean);

  if (!files.length) {
    return;
  }

  const existing = new Set(state.clipboardFiles.map((file) => fileFingerprint(file)));
  files.forEach((file) => {
    const key = fileFingerprint(file);
    if (!existing.has(key)) {
      existing.add(key);
      state.clipboardFiles.push(file);
      if (state.imagePond) {
        state.imagePond.addFile(file).catch(() => {
          // 非关键路径，忽略预览添加失败。
        });
      }
    }
  });

  setStatus(`已从剪贴板添加 ${files.length} 张图片。`);
}

function bindEvents() {
  ui.parseImages.addEventListener("click", async () => {
    try {
      await handleParseImages();
    } catch (error) {
      setStatus(`识别失败：${error instanceof Error ? error.message : "未知错误"}`);
    }
  });

  ui.importExcel.addEventListener("click", async () => {
    try {
      await handleImportExcel();
    } catch (error) {
      setStatus(`Excel 导入失败：${error instanceof Error ? error.message : "未知错误"}`);
    }
  });

  ui.exportExcel.addEventListener("click", async () => {
    try {
      await handleExportExcel();
    } catch (error) {
      setStatus(`Excel 导出失败：${error instanceof Error ? error.message : "未知错误"}`);
    }
  });

  ui.applyStatus.addEventListener("click", handleApplyStatus);
  ui.toggleAll.addEventListener("click", handleToggleAll);
  ui.clearData.addEventListener("click", handleClearData);
  ui.tableBody.addEventListener("click", handleTableClick);

  ui.pasteTrigger.addEventListener("click", () => {
    ui.clipboardPanel.focus();
    setStatus("请按 Ctrl+V 粘贴剪贴板图片。");
  });

  ui.clipboardPanel.addEventListener("paste", handlePasteEvent);
  window.addEventListener("paste", handlePasteEvent);

  window.addEventListener("resize", () => {
    storeChart.resize();
    orderChart.resize();
  });
}

function init() {
  ui.progress.value = 0;
  initUploadWidgets();
  bindEvents();
  rerenderAll();
}

init();
