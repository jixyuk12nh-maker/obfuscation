const MAX_FILE_BYTES = 50 * 1024 * 1024;
const sourceEl = document.querySelector("#source");
const outputEl = document.querySelector("#output");
const compileBtn = document.querySelector("#compile");
const copyBtn = document.querySelector("#copy");
const downloadBtn = document.querySelector("#download");
const statusEl = document.querySelector("#status");
const sourceCount = document.querySelector("#sourceCount");
const outputCount = document.querySelector("#outputCount");
const fileInput = document.querySelector("#fileInput");
const uploadBtn = document.querySelector("#uploadFile");
const sourcePane = document.querySelector("#sourcePane");
const fileInfo = document.querySelector("#fileInfo");
const fileName = document.querySelector("#fileName");
const fileSize = document.querySelector("#fileSize");
const removeFileBtn = document.querySelector("#removeFile");
const defaultCompileMarkup = compileBtn.innerHTML;

function formatFileSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function setStatus(text, kind = "") {
  statusEl.textContent = text;
  statusEl.className = kind;
}

function updateCounts() {
  sourceCount.textContent = `${sourceEl.value.length.toLocaleString()} characters`;
  outputCount.textContent = outputEl.value ? `${outputEl.value.length.toLocaleString()} characters` : "No output yet";
}

function clearFileInfo() {
  fileInfo.hidden = true;
  fileName.textContent = "";
  fileSize.textContent = "";
  fileInput.value = "";
}

async function readSourceFile(file) {
  if (!file) return;
  if (file.size > MAX_FILE_BYTES) {
    setStatus(`File is over 50 MB (${formatFileSize(file.size)})`, "error");
    fileInput.value = "";
    return;
  }
  if (!/\.(lua|txt)$/i.test(file.name)) {
    setStatus("Choose a .lua or .txt file", "error");
    fileInput.value = "";
    return;
  }

  setStatus("Reading file…", "loading");
  try {
    sourceEl.value = await file.text();
    fileName.textContent = file.name;
    fileSize.textContent = formatFileSize(file.size);
    fileInfo.hidden = false;
    updateCounts();
    setStatus("File loaded", "success");
  } catch (error) {
    setStatus("Could not read this file", "error");
  }
}

sourceEl.addEventListener("input", updateCounts);

document.querySelector("#loadExample").addEventListener("click", () => {
  clearFileInfo();
  sourceEl.value = `local functionName = "LuaMoon"\nlocal amount = 3\nif amount >= 3 then\n    print(functionName .. " VM ready")\nelse\n    warn("not ready")\nend`;
  updateCounts();
  setStatus("Example loaded", "success");
});

uploadBtn.addEventListener("click", () => fileInput.click());
fileInput.addEventListener("change", event => readSourceFile(event.target.files?.[0]));
removeFileBtn.addEventListener("click", () => {
  clearFileInfo();
  sourceEl.value = "";
  updateCounts();
  setStatus("File removed");
});

["dragenter", "dragover"].forEach(type => sourcePane.addEventListener(type, event => {
  event.preventDefault();
  sourcePane.classList.add("dragging");
}));
["dragleave", "drop"].forEach(type => sourcePane.addEventListener(type, event => {
  event.preventDefault();
  sourcePane.classList.remove("dragging");
}));
sourcePane.addEventListener("drop", event => readSourceFile(event.dataTransfer?.files?.[0]));

compileBtn.addEventListener("click", async () => {
  if (!sourceEl.value.trim()) {
    setStatus("Add source code first", "error");
    sourceEl.focus();
    return;
  }
  compileBtn.disabled = true;
  compileBtn.textContent = "Compiling…";
  setStatus("Compiling", "loading");
  try {
    const response = await fetch("/api/obfuscate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ source: sourceEl.value })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Compilation failed.");
    if (typeof data.output !== "string") throw new Error("The server returned no output.");
    outputEl.value = data.output;
    copyBtn.disabled = false;
    downloadBtn.disabled = false;
    updateCounts();
    setStatus("Compiled", "success");
  } catch (error) {
    setStatus("Compilation error", "error");
    outputEl.value = `-- ${error.message}`;
    copyBtn.disabled = true;
    downloadBtn.disabled = true;
    updateCounts();
  } finally {
    compileBtn.disabled = false;
    compileBtn.innerHTML = defaultCompileMarkup;
  }
});

copyBtn.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(outputEl.value);
    setStatus("Copied", "success");
  } catch (error) {
    outputEl.focus();
    outputEl.select();
    setStatus("Select and copy manually", "error");
  }
});

downloadBtn.addEventListener("click", () => {
  if (!outputEl.value) return;
  const blob = new Blob([outputEl.value], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "luamoon-obfuscated.lua";
  link.click();
  URL.revokeObjectURL(url);
});

updateCounts();
