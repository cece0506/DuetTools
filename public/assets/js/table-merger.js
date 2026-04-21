/* global XLSX, FilePond */

const SOURCE_COL = "文件来源";

const state = {
  filePond: null,
  mergedData: [],
  searchFilteredData: [],
  finalFilteredData: [],
  selectedRows: new Set(),
  hiddenColumns: new Set(),
  sortColumn: null,
  sortOrder: "asc",
  encoding: "gbk",
  displayedCount: 50,
};

const ui = {
  fileInputUi: document.getElementById("file-input-ui"),
  encoding: document.getElementById("encoding"),
  selectedFilesContainer: document.getElementById("selected-files-container"),
  selectedFilesList: document.getElementById("selected-files-list"),
  clearUploadsBtn: document.getElementById("clear-uploads"),
  mergeTables: document.getElementById("merge-tables"),
  exportMerged: document.getElementById("export-merged"),
  toggleColumns: document.getElementById("toggle-merged-columns"),
  statusText: document.getElementById("status-text"),
  mergedCard: document.getElementById("merged-card"),
  emptyState: document.getElementById("empty-state"),
  mergedSummary: document.getElementById("merged-summary"),
  mergedThead: document.getElementById("merged-thead"),
  mergedTbody: document.getElementById("merged-tbody"),
  tableWrapper: document.getElementById("table-wrapper"),
  searchBox: document.getElementById("search-box"),
  sourceFilter: document.getElementById("source-filter"),
  sourceFilterOptions: document.getElementById("source-filter-options"),
  deleteSelected: document.getElementById("delete-selected"),
  selectedCount: document.getElementById("selected-count"),
  columnSelector: document.getElementById("column-selector"),
  columnList: document.getElementById("column-list"),
  closeColumnSelector: document.getElementById("close-column-selector"),
  loadingIndicator: document.getElementById("loading-indicator"),
};

const DATE_PATTERNS = [
  /^\d{4}[-/]\d{1,2}[-/]\d{1,2}(\s\d{1,2}:\d{1,2}(:\d{1,2})?)?$/,
  /^\d{1,2}[-/]\d{1,2}[-/]\d{4}(\s\d{1,2}:\d{1,2}(:\d{1,2})?)?$/,
  /^\d{13}$/,
  /^\d{10}$/,
];

function setStatus(text) {
  ui.statusText.textContent = text;
}

function getSelectedFiles() {
  if (state.filePond) {
    return state.filePond.getFiles().map((item) => item.file);
  }
  return Array.from(ui.fileInputUi.files || []);
}

function isDateField(columnName) {
  return /date|time|datetime|时间|日期/i.test(String(columnName || ""));
}

function isExcelSerialDate(value) {
  const num = Number(value);
  return Number.isFinite(num) && num > 20000 && num < 80000;
}

function isDateValue(value) {
  if (value === null || value === undefined || value === "") return false;
  const str = String(value).trim();
  if (isExcelSerialDate(str)) return true;
  return DATE_PATTERNS.some((pattern) => pattern.test(str));
}

function excelSerialToDate(serial) {
  const wholeDays = Math.floor(serial);
  const fraction = serial - wholeDays;
  const utcValue = (wholeDays - 25569) * 86400;
  const date = new Date(utcValue * 1000);
  date.setSeconds(date.getSeconds() + Math.round(fraction * 86400));
  return date;
}

function formatDateTime(value) {
  if (value === null || value === undefined || value === "") return "";
  const str = String(value).trim();

  if (isExcelSerialDate(str)) {
    return excelSerialToDate(Number(str)).toLocaleString("zh-CN", { hour12: false });
  }
  if (/^\d{13}$/.test(str)) {
    return new Date(Number(str)).toLocaleString("zh-CN", { hour12: false });
  }
  if (/^\d{10}$/.test(str)) {
    return new Date(Number(str) * 1000).toLocaleString("zh-CN", { hour12: false });
  }

  const date = new Date(str);
  if (!Number.isNaN(date.getTime())) {
    return date.toLocaleString("zh-CN", { hour12: false });
  }

  return str;
}

function decodeBuffer(buffer, encoding) {
  try {
    if (encoding === "gbk") return new TextDecoder("gb2312").decode(buffer);
    if (encoding === "utf-8") return new TextDecoder("utf-8").decode(buffer);
    if (encoding === "utf-16") return new TextDecoder("utf-16").decode(buffer);
    if (encoding === "iso-8859-1") return new TextDecoder("iso-8859-1").decode(buffer);
  } catch (_err) {
    try {
      return new TextDecoder("utf-8").decode(buffer);
    } catch (_err2) {
      return new TextDecoder("iso-8859-1").decode(buffer);
    }
  }
  return new TextDecoder("utf-8").decode(buffer);
}

function sanitizeRows(rows) {
  return rows.map((row) => {
    const clean = {};
    Object.keys(row).forEach((key) => {
      if (!/^__EMPTY/i.test(key)) {
        clean[key] = row[key];
      }
    });
    return clean;
  });
}

function getHeadersFromRows(rows) {
  if (!rows.length) return [];
  return Object.keys(rows[0]).filter((h) => !/^__EMPTY/i.test(h));
}

async function readTableFile(file, encoding) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target.result);

        if (file.name.toLowerCase().endsWith(".csv")) {
          const text = decodeBuffer(data, encoding);
          const workbook = XLSX.read(text, { type: "string", cellDates: false, raw: true });
          const sheet = workbook.Sheets[workbook.SheetNames[0]];
          const rawRows = XLSX.utils.sheet_to_json(sheet, { raw: true, defval: "" });
          const rows = sanitizeRows(rawRows);
          resolve({ name: file.name, headers: getHeadersFromRows(rows), data: rows });
          return;
        }

        const workbook = XLSX.read(data, { type: "array", cellDates: false, raw: true });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const rawRows = XLSX.utils.sheet_to_json(sheet, { raw: true, defval: "" });
        const rows = sanitizeRows(rawRows);
        resolve({ name: file.name, headers: getHeadersFromRows(rows), data: rows });
      } catch (err) {
        reject(err);
      }
    };

    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(file);
  });
}

function renderSelectedFilesList() {
  const files = getSelectedFiles();

  if (!files.length) {
    ui.selectedFilesContainer.style.display = "none";
    ui.mergeTables.disabled = true;
    return;
  }

  ui.selectedFilesContainer.style.display = "block";
  ui.selectedFilesList.innerHTML = "";
  ui.mergeTables.disabled = false;

  files.forEach((file, idx) => {
    const li = document.createElement("li");
    li.className = "file-item";

    const nameSpan = document.createElement("span");
    nameSpan.className = "file-item-name";
    nameSpan.title = file.name;
    nameSpan.textContent = file.name;

    const removeBtn = document.createElement("button");
    removeBtn.className = "file-item-remove";
    removeBtn.type = "button";
    removeBtn.textContent = "删除";
    removeBtn.addEventListener("click", () => {
      if (state.filePond) {
        const pondFile = state.filePond.getFiles()[idx];
        if (pondFile) state.filePond.removeFile(pondFile.id);
      }
      renderSelectedFilesList();
    });

    li.append(nameSpan, removeBtn);
    ui.selectedFilesList.appendChild(li);
  });
}

function checkHeadersConsistency(tables) {
  if (!tables.length) return { consistent: true, issues: [] };

  const baseHeaders = tables[0].headers;
  const issues = [];

  tables.forEach((table) => {
    if (JSON.stringify(table.headers) !== JSON.stringify(baseHeaders)) {
      issues.push(`${table.name}: 表头不一致`);
    }
  });

  return { consistent: issues.length === 0, issues };
}

function formatCellByHeader(header, value) {
  if (value === null || value === undefined) return "";
  if (isDateField(header)) return formatDateTime(value);
  return String(value);
}

function refreshSourceFilterOptions() {
  const values = Array.from(new Set(state.mergedData.map((row) => row[SOURCE_COL])));
  ui.sourceFilterOptions.innerHTML = '<option value=""></option>';
  values.forEach((v) => {
    const option = document.createElement("option");
    option.value = v;
    ui.sourceFilterOptions.appendChild(option);
  });
}

function applyFilters() {
  const text = ui.searchBox.value.trim().toLowerCase();
  const source = ui.sourceFilter.value.trim();

  state.searchFilteredData = !text
    ? [...state.mergedData]
    : state.mergedData.filter((row) =>
        Object.values(row).some((v) => String(v).toLowerCase().includes(text))
      );

  state.finalFilteredData = !source
    ? [...state.searchFilteredData]
    : state.searchFilteredData.filter((row) => row[SOURCE_COL] === source);

  state.displayedCount = 50;
}

function updateSelectedCount() {
  const count = state.selectedRows.size;
  ui.selectedCount.textContent = count ? `已选 ${count} 行` : "";
  ui.deleteSelected.disabled = count === 0;
}

function renderTableBody(headers) {
  ui.mergedTbody.innerHTML = "";

  const displayCount = Math.min(state.displayedCount, state.finalFilteredData.length);

  for (let i = 0; i < displayCount; i += 1) {
    const row = state.finalFilteredData[i];
    const tr = document.createElement("tr");
    if (state.selectedRows.has(row)) tr.classList.add("selected");

    let html = `
      <td class="checkbox-col">
        <input type="checkbox" class="row-checkbox" data-row-index="${i}" ${state.selectedRows.has(row) ? "checked" : ""} />
      </td>
    `;

    headers.forEach((h) => {
      const hidden = state.hiddenColumns.has(h) ? "hidden" : "";
      html += `<td class="${hidden}">${formatCellByHeader(h, row[h])}</td>`;
    });

    tr.innerHTML = html;

    const checkbox = tr.querySelector(".row-checkbox");
    checkbox.addEventListener("change", (e) => {
      if (e.target.checked) state.selectedRows.add(row);
      else state.selectedRows.delete(row);
      updateSelectedCount();
    });

    ui.mergedTbody.appendChild(tr);
  }

  ui.loadingIndicator.style.display = state.finalFilteredData.length > state.displayedCount ? "block" : "none";
  updateSelectedCount();
}

function renderColumnSelector(headers) {
  ui.columnList.innerHTML = "";

  headers.forEach((h) => {
    const item = document.createElement("div");
    item.className = "column-item";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = !state.hiddenColumns.has(h);
    checkbox.addEventListener("change", () => {
      if (checkbox.checked) state.hiddenColumns.delete(h);
      else state.hiddenColumns.add(h);
      renderMergedTable();
    });

    const label = document.createElement("label");
    label.textContent = h;

    item.append(checkbox, label);
    ui.columnList.appendChild(item);
  });
}

function handleTableScroll() {
  const ratio =
    (ui.tableWrapper.scrollTop + ui.tableWrapper.clientHeight) /
    Math.max(ui.tableWrapper.scrollHeight, 1);

  if (ratio > 0.8 && state.displayedCount < state.finalFilteredData.length) {
    state.displayedCount = Math.min(state.displayedCount + 50, state.finalFilteredData.length);
    renderTableBody(Object.keys(state.mergedData[0] || {}));
  }
}

function handleColumnSort(e) {
  const th = e.target.closest("th.sortable");
  if (!th) return;

  const column = th.dataset.column;
  if (state.sortColumn === column) {
    state.sortOrder = state.sortOrder === "asc" ? "desc" : "asc";
  } else {
    state.sortColumn = column;
    state.sortOrder = "asc";
  }

  state.finalFilteredData.sort((a, b) => {
    let aVal = a[column] ?? "";
    let bVal = b[column] ?? "";

    const aNum = Number(aVal);
    const bNum = Number(bVal);
    if (!Number.isNaN(aNum) && !Number.isNaN(bNum) && `${aVal}` !== "" && `${bVal}` !== "") {
      aVal = aNum;
      bVal = bNum;
    }

    if (aVal < bVal) return state.sortOrder === "asc" ? -1 : 1;
    if (aVal > bVal) return state.sortOrder === "asc" ? 1 : -1;
    return 0;
  });

  ui.mergedThead.querySelectorAll("th.sortable").forEach((node) => {
    node.classList.remove("sorted-asc", "sorted-desc");
  });
  th.classList.add(state.sortOrder === "asc" ? "sorted-asc" : "sorted-desc");

  state.displayedCount = 50;
  renderTableBody(Object.keys(state.mergedData[0] || {}));
}

function renderMergedTable() {
  if (!state.mergedData.length) return;

  const headers = Object.keys(state.mergedData[0]);
  ui.mergedThead.innerHTML = `
    <tr>
      <th class="checkbox-col">
        <input type="checkbox" id="select-all" />
      </th>
      ${headers
        .map(
          (h) => `<th class="sortable ${state.hiddenColumns.has(h) ? "hidden" : ""}" data-column="${h}">${h}</th>`
        )
        .join("")}
    </tr>
  `;

  ui.mergedThead.querySelector("#select-all").addEventListener("change", (e) => {
    const checked = e.target.checked;
    const max = Math.min(state.displayedCount, state.finalFilteredData.length);
    for (let i = 0; i < max; i += 1) {
      const row = state.finalFilteredData[i];
      if (checked) state.selectedRows.add(row);
      else state.selectedRows.delete(row);
    }
    renderTableBody(headers);
  });

  ui.mergedThead.querySelectorAll("th.sortable").forEach((th) => {
    th.addEventListener("click", handleColumnSort);
  });

  renderTableBody(headers);
  renderColumnSelector(headers);
  ui.mergedSummary.textContent = `共 ${state.finalFilteredData.length} 行数据`;
  ui.tableWrapper.onscroll = handleTableScroll;
}

async function handleMergeClick() {
  const files = getSelectedFiles();
  if (files.length < 2) {
    setStatus("需要至少 2 个文件才能合并");
    return;
  }

  state.encoding = ui.encoding.value;
  setStatus("正在读取并合并文件...");

  try {
    const tables = [];
    for (let i = 0; i < files.length; i += 1) {
      setStatus(`正在加载文件 ${i + 1}/${files.length} (${state.encoding})...`);
      const table = await readTableFile(files[i], state.encoding);
      tables.push(table);
    }

    const check = checkHeadersConsistency(tables);
    if (!check.consistent) {
      const ok = confirm(`检测到表头不一致：\n${check.issues.join("\n")}\n\n是否继续合并？`);
      if (!ok) {
        setStatus("已取消合并");
        return;
      }
    }

    const baseHeaders = tables[0].headers;
    const mergedRows = [];

    tables.forEach((table) => {
      table.data.forEach((row) => {
        const mapped = {};
        baseHeaders.forEach((h) => {
          mapped[h] = row[h] ?? "";
        });
        mapped[SOURCE_COL] = table.name;
        mergedRows.push(mapped);
      });
    });

    state.mergedData = mergedRows;
    state.selectedRows.clear();
    state.hiddenColumns.clear();
    state.sortColumn = null;

    refreshSourceFilterOptions();
    applyFilters();
    renderMergedTable();

    ui.mergedCard.style.display = "flex";
    ui.mergedCard.style.flexDirection = "column";
    ui.emptyState.style.display = "none";
    ui.exportMerged.disabled = false;
    ui.toggleColumns.disabled = false;
    setStatus(`✓ 合并完成: 共 ${state.mergedData.length} 行`);
  } catch (err) {
    setStatus(`合并失败: ${err.message}`);
  }
}

function applyAndRender() {
  applyFilters();
  if (!state.mergedData.length) return;
  renderMergedTable();
}

function deleteSelectedRows() {
  if (!state.selectedRows.size) return;

  const ok = confirm(`确定删除 ${state.selectedRows.size} 行吗？`);
  if (!ok) return;

  state.mergedData = state.mergedData.filter((row) => !state.selectedRows.has(row));
  state.selectedRows.clear();

  if (!state.mergedData.length) {
    ui.mergedCard.style.display = "none";
    ui.emptyState.style.display = "flex";
    ui.exportMerged.disabled = true;
    ui.toggleColumns.disabled = true;
    ui.sourceFilter.value = "";
    ui.sourceFilterOptions.innerHTML = '<option value=""></option>';
    setStatus("已删除全部数据");
    return;
  }

  refreshSourceFilterOptions();
  applyFilters();
  renderMergedTable();
  setStatus("已删除选中行");
}

function escapeCsvCell(value) {
  const text = String(value ?? "");
  if (/[",\r\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function binaryStringToUint8Array(binary) {
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i) & 0xff;
  }
  return bytes;
}

function encodeUtf16Le(text) {
  const buffer = new Uint8Array(2 + text.length * 2);
  buffer[0] = 0xff;
  buffer[1] = 0xfe;
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    buffer[2 + i * 2] = code & 0xff;
    buffer[3 + i * 2] = code >> 8;
  }
  return buffer;
}

function buildCsvContent(exportHeaders) {
  return [
    exportHeaders.map((header) => escapeCsvCell(header)).join(","),
    ...state.finalFilteredData.map((row) =>
      exportHeaders.map((header) => escapeCsvCell(formatCellByHeader(header, row[header]))).join(",")
    ),
  ].join("\r\n");
}

function buildCsvBlob(csvContent, exportHeaders) {
  if (state.encoding === "utf-16") {
    return new Blob([encodeUtf16Le(csvContent)], {
      type: "text/csv;charset=utf-16;",
    });
  }

  if (state.encoding === "gbk" || state.encoding === "iso-8859-1") {
    const sheet = XLSX.utils.aoa_to_sheet([
      exportHeaders,
      ...state.finalFilteredData.map((row) =>
        exportHeaders.map((header) => formatCellByHeader(header, row[header]))
      ),
    ]);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, "合并数据");
    const codepage = state.encoding === "gbk" ? 936 : 28591;
    const binary = XLSX.write(workbook, {
      bookType: "csv",
      type: "binary",
      sheet: "合并数据",
      codepage,
      FS: ",",
      RS: "\r\n",
    });
    return new Blob([binaryStringToUint8Array(binary)], {
      type: `text/csv;charset=${state.encoding};`,
    });
  }

  return new Blob([`\uFEFF${csvContent}`], {
    type: "text/csv;charset=utf-8;",
  });
}

function exportAsCsv() {
  if (!state.finalFilteredData.length) {
    setStatus("没有可导出的数据");
    return;
  }

  try {
    setStatus("正在导出...");
    state.encoding = ui.encoding.value;

    const allHeaders = Object.keys(state.mergedData[0]);
    const exportHeaders = allHeaders.filter((h) => !state.hiddenColumns.has(h));
    const csvContent = buildCsvContent(exportHeaders);
    const blob = buildCsvBlob(csvContent, exportHeaders);
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `合并表格_${state.encoding}_${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);

    setStatus("✓ CSV 导出成功");
  } catch (err) {
    setStatus(`导出失败: ${err.message}`);
  }
}

function clearAll() {
  if (!confirm("确定要清空所有数据吗？")) return;

  state.mergedData = [];
  state.searchFilteredData = [];
  state.finalFilteredData = [];
  state.selectedRows.clear();
  state.hiddenColumns.clear();
  state.sortColumn = null;
  state.displayedCount = 50;

  if (state.filePond) {
    state.filePond.removeFiles();
  }

  ui.selectedFilesContainer.style.display = "none";
  ui.mergedCard.style.display = "none";
  ui.emptyState.style.display = "flex";
  ui.mergeTables.disabled = true;
  ui.exportMerged.disabled = true;
  ui.toggleColumns.disabled = true;
  ui.searchBox.value = "";
  ui.sourceFilter.value = "";
  ui.sourceFilterOptions.innerHTML = '<option value=""></option>';
  ui.columnSelector.style.display = "none";

  renderSelectedFilesList();
  setStatus("已清空所有数据");
}

function initFileUpload() {
  if (typeof FilePond === "undefined") {
    ui.fileInputUi.addEventListener("change", renderSelectedFilesList);
    return;
  }

  state.filePond = FilePond.create(ui.fileInputUi, {
    allowMultiple: true,
    storeAsFile: true,
    credits: false,
    labelIdle: "拖拽或点击选择表格文件（Excel / CSV）",
  });

  state.filePond.on("updatefiles", () => {
    renderSelectedFilesList();
  });
}
      state.hiddenColumns.add(SOURCE_COL);
      renderMergedTable();

function initEventListeners() {
  ui.clearUploadsBtn.addEventListener("click", clearAll);
  ui.mergeTables.addEventListener("click", handleMergeClick);
  ui.exportMerged.addEventListener("click", exportAsCsv);
  ui.deleteSelected.addEventListener("click", deleteSelectedRows);

  ui.searchBox.addEventListener("input", applyAndRender);
  ui.sourceFilter.addEventListener("change", applyAndRender);
  ui.sourceFilter.addEventListener("input", applyAndRender);

  ui.toggleColumns.addEventListener("click", () => {
    ui.columnSelector.style.display =
      ui.columnSelector.style.display === "none" ? "block" : "none";
  });

  ui.closeColumnSelector.addEventListener("click", () => {
    ui.columnSelector.style.display = "none";
  });
}

initFileUpload();
initEventListeners();
setStatus("请选择文件后点击合并");
