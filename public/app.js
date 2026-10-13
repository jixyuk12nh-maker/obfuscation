const sourceEl = document.querySelector("#source");
const outputEl = document.querySelector("#output");
const compileBtn = document.querySelector("#compile");
const copyBtn = document.querySelector("#copy");
const downloadBtn = document.querySelector("#download");
const statusEl = document.querySelector("#status");
const sourceCount = document.querySelector("#sourceCount");
const outputCount = document.querySelector("#outputCount");

function setStatus(text, kind = "") {
  statusEl.textContent = text;
  statusEl.className = kind;
}
function updateCounts() {
  sourceCount.textContent = `${sourceEl.value.length.toLocaleString()} characters`;
  outputCount.textContent = outputEl.value ? `${outputEl.value.length.toLocaleString()} characters` : "No output yet";
}
sourceEl.addEventListener("input", updateCounts);

document.querySelector("#loadExample").addEventListener("click", () => {
  sourceEl.value = `local functionName = "LuaMoon"\nlocal amount = 3\nif amount >= 3 then\n    print(functionName .. " VM ready")\nelse\n    warn("not ready")\nend`;
  updateCounts();
  setStatus("Example loaded");
});

compileBtn.addEventListener("click", async () => {
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
    compileBtn.disabled = false;
    compileBtn.innerHTML = 'Compile to VM <span aria-hidden="true">→</span>';
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
