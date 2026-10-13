const MAX_FILE_SIZE = 50 * 1024 * 1024;
let isCompiling = false;

const sourceEl = document.querySelector("#source");
const outputEl = document.querySelector("#output");
const compileBtn = document.querySelector("#compile");
const copyBtn = document.querySelector("#copy");
const downloadBtn = document.querySelector("#download");
const statusEl = document.querySelector("#status");
const sourceCount = document.querySelector("#sourceCount");
const outputCount = document.querySelector("#outputCount");
const fileInput = document.querySelector("#file");

function setStatus(text, kind = "") {
  statusEl.textContent = text;
  statusEl.className = kind;
}

function updateCounts() {
  const byteSize = new Blob([sourceEl.value]).size;
  const sizeText =
    byteSize >= 1024 * 1024
      ? `${(byteSize / (1024 * 1024)).toFixed(2)} MB`
      : `${byteSize.toLocaleString()} bytes`;
  sourceCount.textContent = `${sourceEl.value.length.toLocaleString()} characters (${sizeText})`;

  if (outputEl.value) {
    const outSize = new Blob([outputEl.value]).size;
    const outSizeText =
      outSize >= 1024 * 1024
        ? `${(outSize / (1024 * 1024)).toFixed(2)} MB`
        : `${outSize.toLocaleString()} bytes`;
    outputCount.textContent = `${outputEl.value.length.toLocaleString()} characters (${outSizeText})`;
  } else {
    outputCount.textContent = "No output yet";
  }
}

function checkSourceSize() {
  const byteSize = new Blob([sourceEl.value]).size;

  if (byteSize > MAX_FILE_SIZE) {
    setStatus(
      `파일이 너무 큽니다 (최대 50MB, 현재 ${(byteSize / (1024 * 1024)).toFixed(2)}MB)`,
      "error"
    );
    compileBtn.disabled = true;
    return false;
  }

  if (!isCompiling) {
    compileBtn.disabled = false;
  }
  return true;
}

sourceEl.addEventListener("input", () => {
  updateCounts();
  checkSourceSize();
});

if (fileInput) {
  fileInput.addEventListener("change", async (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;

    if (file.size > MAX_FILE_SIZE) {
      setStatus(
        `파일이 너무 큽니다 (최대 50MB, 현재 ${(file.size / (1024 * 1024)).toFixed(2)}MB)`,
        "error"
      );
      fileInput.value = "";
      return;
    }

    try {
      sourceEl.value = await file.text();
      updateCounts();
      checkSourceSize();
      setStatus(`Loaded ${file.name}`, "success");
    } catch {
      setStatus("파일을 읽을 수 없습니다", "error");
    } finally {
      fileInput.value = "";
    }
  });
}

document.querySelector("#loadExample").addEventListener("click", () => {
  sourceEl.value = `local functionName = "LuaMoon"\nlocal amount = 3\nif amount >= 3 then\n    print(functionName .. " VM ready")\nelse\n    warn("not ready")\nend`;
  updateCounts();
  checkSourceSize();
  setStatus("Example loaded");
});

compileBtn.addEventListener("click", async () => {
  if (!checkSourceSize()) return;

  isCompiling = true;
  compileBtn.disabled = true;
  compileBtn.textContent = "Compiling…";
  setStatus("Compiling");
  try {
    const response = await fetch("/api/obfuscate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ source: sourceEl.value })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Compilation failed.");
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
    isCompiling = false;
    compileBtn.innerHTML = 'Compile to VM <span aria-hidden="true">→</span>';
    checkSourceSize();
  }
});

copyBtn.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(outputEl.value);
    setStatus("Copied", "success");
  } catch {
    outputEl.focus();
    outputEl.select();
    setStatus("Select and copy manually", "error");
  }
});

downloadBtn.addEventListener("click", () => {
  const blob = new Blob([outputEl.value], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "luamoon-obfuscated.lua";
  a.click();
  URL.revokeObjectURL(url);
});

updateCounts();
