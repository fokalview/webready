const fileInput = document.querySelector("#fileInput");
const dropZone = document.querySelector("#dropZone");
const fileSection = document.querySelector("#fileSection");
const fileList = document.querySelector("#fileList");
const fileTemplate = document.querySelector("#fileTemplate");
const fileCount = document.querySelector("#fileCount");
const totalSize = document.querySelector("#totalSize");
const quality = document.querySelector("#quality");
const scale = document.querySelector("#scale");
const qualityValue = document.querySelector("#qualityValue");
const scaleValue = document.querySelector("#scaleValue");
const convertButton = document.querySelector("#convertButton");
const downloadAllButton = document.querySelector("#downloadAllButton");
const clearButton = document.querySelector("#clearButton");
const status = document.querySelector("#status");

let items = [];

const formatBytes = (bytes) => {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** index).toFixed(index ? 1 : 0)} ${units[index]}`;
};

const safeWebpName = (name) => `${name.replace(/\.[^.]+$/, "") || "image"}.webp`;

function updateControls() {
  const count = items.length;
  fileSection.hidden = count === 0;
  convertButton.disabled = count === 0;
  clearButton.disabled = count === 0;
  downloadAllButton.hidden = !items.some((item) => item.resultUrl);
  fileCount.textContent = `${count} image${count === 1 ? "" : "s"}`;
  totalSize.textContent = `${formatBytes(items.reduce((sum, item) => sum + item.file.size, 0))} selected`;
  status.textContent = count ? "Ready to convert." : "Add images to begin.";
}

function renderItems() {
  fileList.replaceChildren();
  items.forEach((item) => {
    const card = fileTemplate.content.firstElementChild.cloneNode(true);
    card.querySelector(".thumbnail").src = item.previewUrl;
    card.querySelector(".file-name").textContent = item.file.name;
    card.querySelector(".file-meta").textContent = `${formatBytes(item.file.size)} · ${item.file.type || "image"}`;

    const resultMeta = card.querySelector(".result-meta");
    const downloadButton = card.querySelector(".download-button");
    if (item.resultUrl) {
      const savings = Math.round((1 - item.resultSize / item.file.size) * 100);
      resultMeta.textContent = `${formatBytes(item.resultSize)} WebP · ${savings >= 0 ? `${savings}% smaller` : "larger than original"}`;
      downloadButton.hidden = false;
      downloadButton.addEventListener("click", () => downloadItem(item));
    }

    card.querySelector(".remove-button").addEventListener("click", () => {
      URL.revokeObjectURL(item.previewUrl);
      if (item.resultUrl) URL.revokeObjectURL(item.resultUrl);
      items = items.filter((candidate) => candidate.id !== item.id);
      renderItems();
      updateControls();
    });
    fileList.append(card);
  });
}

function addFiles(fileCollection) {
  const imageFiles = [...fileCollection].filter((file) => file.type.startsWith("image/"));
  for (const file of imageFiles) {
    items.push({
      id: crypto.randomUUID(),
      file,
      previewUrl: URL.createObjectURL(file),
      resultUrl: null,
      resultSize: 0,
    });
  }
  renderItems();
  updateControls();
}

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const url = URL.createObjectURL(file);
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error(`Could not read ${file.name}`));
    };
    image.src = url;
  });
}

async function convertItem(item) {
  const image = await loadImage(item.file);
  const factor = Number(scale.value) / 100;
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(image.naturalWidth * factor));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * factor));
  const context = canvas.getContext("2d");
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(image, 0, 0, canvas.width, canvas.height);

  const blob = await new Promise((resolve) =>
    canvas.toBlob(resolve, "image/webp", Number(quality.value) / 100),
  );
  if (!blob) throw new Error(`Your browser could not convert ${item.file.name}`);
  if (item.resultUrl) URL.revokeObjectURL(item.resultUrl);
  item.resultUrl = URL.createObjectURL(blob);
  item.resultSize = blob.size;
}

function downloadItem(item) {
  const link = document.createElement("a");
  link.href = item.resultUrl;
  link.download = safeWebpName(item.file.name);
  link.click();
}

fileInput.addEventListener("change", () => {
  addFiles(fileInput.files);
  fileInput.value = "";
});

for (const eventName of ["dragenter", "dragover"]) {
  dropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    dropZone.classList.add("is-dragging");
  });
}

for (const eventName of ["dragleave", "drop"]) {
  dropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    dropZone.classList.remove("is-dragging");
  });
}

dropZone.addEventListener("drop", (event) => addFiles(event.dataTransfer.files));
quality.addEventListener("input", () => (qualityValue.textContent = `${quality.value}%`));
scale.addEventListener("input", () => (scaleValue.textContent = `${scale.value}%`));

clearButton.addEventListener("click", () => {
  for (const item of items) {
    URL.revokeObjectURL(item.previewUrl);
    if (item.resultUrl) URL.revokeObjectURL(item.resultUrl);
  }
  items = [];
  renderItems();
  updateControls();
});

downloadAllButton.addEventListener("click", () => {
  items.filter((item) => item.resultUrl).forEach(downloadItem);
});

convertButton.addEventListener("click", async () => {
  convertButton.disabled = true;
  clearButton.disabled = true;
  let converted = 0;
  let failed = 0;

  for (const [index, item] of items.entries()) {
    status.textContent = `Converting ${index + 1} of ${items.length}...`;
    try {
      await convertItem(item);
      converted += 1;
    } catch (error) {
      console.error(error);
      failed += 1;
    }
    renderItems();
  }

  const originalSize = items.reduce((sum, item) => sum + item.file.size, 0);
  const resultSize = items.reduce((sum, item) => sum + item.resultSize, 0);
  const saved = Math.max(0, originalSize - resultSize);
  status.textContent = `${converted} converted${failed ? `, ${failed} failed` : ""} · ${formatBytes(saved)} saved`;
  convertButton.disabled = false;
  clearButton.disabled = false;
  downloadAllButton.hidden = converted === 0;
});

updateControls();
