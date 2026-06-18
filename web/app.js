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
const zipDownloads = document.querySelector("#zipDownloads");
const clearButton = document.querySelector("#clearButton");
const status = document.querySelector("#status");
const qualityPresets = document.querySelectorAll(".quality-preset");

let items = [];

const formatBytes = (bytes) => {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** index).toFixed(index ? 1 : 0)} ${units[index]}`;
};

const safeWebpName = (name) => `${name.replace(/\.[^.]+$/, "") || "image"}.webp`;

const crcTable = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  return value >>> 0;
});

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function writeUint16(bytes, offset, value) {
  bytes[offset] = value & 0xff;
  bytes[offset + 1] = (value >>> 8) & 0xff;
}

function writeUint32(bytes, offset, value) {
  bytes[offset] = value & 0xff;
  bytes[offset + 1] = (value >>> 8) & 0xff;
  bytes[offset + 2] = (value >>> 16) & 0xff;
  bytes[offset + 3] = (value >>> 24) & 0xff;
}

function dosTimestamp(date) {
  const time =
    (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  const day =
    ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { time, day };
}

function uniqueZipName(name, usedNames) {
  const baseName = safeWebpName(name).replace(/[\\/:*?"<>|]/g, "-");
  let candidate = baseName;
  let index = 2;
  while (usedNames.has(candidate.toLowerCase())) {
    candidate = baseName.replace(/\.webp$/i, `-${index}.webp`);
    index += 1;
  }
  usedNames.add(candidate.toLowerCase());
  return candidate;
}

async function createZipBlob(convertedItems) {
  const encoder = new TextEncoder();
  const localParts = [];
  const centralParts = [];
  const usedNames = new Set();
  let offset = 0;

  for (const item of convertedItems) {
    const fileBytes = new Uint8Array(await item.resultBlob.arrayBuffer());
    const fileNameBytes = encoder.encode(uniqueZipName(item.file.name, usedNames));
    const checksum = crc32(fileBytes);
    const { time, day } = dosTimestamp(new Date());

    const localHeader = new Uint8Array(30 + fileNameBytes.length);
    writeUint32(localHeader, 0, 0x04034b50);
    writeUint16(localHeader, 4, 20);
    writeUint16(localHeader, 6, 0x0800);
    writeUint16(localHeader, 8, 0);
    writeUint16(localHeader, 10, time);
    writeUint16(localHeader, 12, day);
    writeUint32(localHeader, 14, checksum);
    writeUint32(localHeader, 18, fileBytes.length);
    writeUint32(localHeader, 22, fileBytes.length);
    writeUint16(localHeader, 26, fileNameBytes.length);
    localHeader.set(fileNameBytes, 30);
    localParts.push(localHeader, fileBytes);

    const centralHeader = new Uint8Array(46 + fileNameBytes.length);
    writeUint32(centralHeader, 0, 0x02014b50);
    writeUint16(centralHeader, 4, 20);
    writeUint16(centralHeader, 6, 20);
    writeUint16(centralHeader, 8, 0x0800);
    writeUint16(centralHeader, 10, 0);
    writeUint16(centralHeader, 12, time);
    writeUint16(centralHeader, 14, day);
    writeUint32(centralHeader, 16, checksum);
    writeUint32(centralHeader, 20, fileBytes.length);
    writeUint32(centralHeader, 24, fileBytes.length);
    writeUint16(centralHeader, 28, fileNameBytes.length);
    writeUint32(centralHeader, 42, offset);
    centralHeader.set(fileNameBytes, 46);
    centralParts.push(centralHeader);

    offset += localHeader.length + fileBytes.length;
  }

  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
  const endHeader = new Uint8Array(22);
  writeUint32(endHeader, 0, 0x06054b50);
  writeUint16(endHeader, 8, convertedItems.length);
  writeUint16(endHeader, 10, convertedItems.length);
  writeUint32(endHeader, 12, centralSize);
  writeUint32(endHeader, 16, offset);

  return new Blob([...localParts, ...centralParts, endHeader], { type: "application/zip" });
}

function updateControls() {
  const count = items.length;
  fileSection.hidden = count === 0;
  convertButton.disabled = count === 0;
  clearButton.disabled = count === 0;
  downloadAllButton.hidden = !items.some((item) => item.resultUrl);
  updateDownloadLabel();
  fileCount.textContent = `${count} image${count === 1 ? "" : "s"}`;
  totalSize.textContent = `${formatBytes(items.reduce((sum, item) => sum + item.file.size, 0))} selected`;
  status.textContent = count ? "Ready to convert." : "Add images to begin.";
}

function updateDownloadLabel() {
  downloadAllButton.textContent = zipDownloads.checked ? "Download ZIP" : "Download all";
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
      resultBlob: null,
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
  item.resultBlob = blob;
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
zipDownloads.addEventListener("change", updateDownloadLabel);

qualityPresets.forEach((preset) => {
  preset.addEventListener("click", () => {
    quality.value = preset.dataset.quality;
    qualityValue.textContent = `${quality.value}%`;
    qualityPresets.forEach((button) => button.classList.remove("is-recommended"));
    preset.classList.add("is-recommended");
  });
});

clearButton.addEventListener("click", () => {
  for (const item of items) {
    URL.revokeObjectURL(item.previewUrl);
    if (item.resultUrl) URL.revokeObjectURL(item.resultUrl);
  }
  items = [];
  renderItems();
  updateControls();
});

downloadAllButton.addEventListener("click", async () => {
  const convertedItems = items.filter((item) => item.resultBlob);
  if (zipDownloads.checked && convertedItems.length) {
    status.textContent = "Building ZIP download...";
    const zipBlob = await createZipBlob(convertedItems);
    const zipUrl = URL.createObjectURL(zipBlob);
    const link = document.createElement("a");
    link.href = zipUrl;
    link.download = "webready-images.zip";
    link.click();
    setTimeout(() => URL.revokeObjectURL(zipUrl), 1000);
    status.textContent = `Downloaded ${convertedItems.length} WebP files as a ZIP.`;
    return;
  }

  convertedItems.forEach(downloadItem);
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
