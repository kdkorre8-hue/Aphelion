// A poster of your galaxy to share: the picture you're looking at, framed with the Aphelion mark, your totals
// and your top five, as a PNG in post (4:5) or story (9:16) size. It's drawn here in the browser; nothing is
// uploaded anywhere.
import { el, icon } from "./ui.js";

const $ = (id) => document.getElementById(id);
export const FORMATS = { post: [1080, 1350], story: [1080, 1920] };
const INK = "#e9ebf5", MUTED = "#9097b6", FAINT = "#7a81a3";

// The logo, drawn from the page's own SVG symbol
async function markImage() {
  const symbol = document.getElementById("mark");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">${symbol.innerHTML}</svg>`;
  const img = new Image();
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  await img.decode();
  return img;
}

function spaced(ctx, text, x, y, spacing) {
  ctx.letterSpacing = `${spacing}px`;
  ctx.fillText(text, x, y);
  ctx.letterSpacing = "0px";
}

function fitText(ctx, text, maxWidth) {
  if (ctx.measureText(text).width <= maxWidth) return text;
  while (text.length > 1 && ctx.measureText(`${text}…`).width > maxWidth) text = text.slice(0, -1);
  return `${text.trimEnd()}…`;
}

// picture: the rendered galaxy at the poster's size. labels: names to draw on it, [{ x, y, text }].
// copy: { eyebrow, title, subtitle, listTitle, list: [{ name, value, color }] }
export async function composePoster(picture, labels, copy) {
  await document.fonts.ready;
  const { width, height } = picture;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(picture, 0, 0);

  // darken the top and the bottom, so the words stand out from the galaxy
  const top = ctx.createLinearGradient(0, 0, 0, height * 0.22);
  top.addColorStop(0, "rgba(3, 4, 10, 0.85)");
  top.addColorStop(1, "rgba(3, 4, 10, 0)");
  ctx.fillStyle = top;
  ctx.fillRect(0, 0, width, height * 0.22);
  const bottomStart = height * 0.5;
  const bottom = ctx.createLinearGradient(0, bottomStart, 0, height);
  bottom.addColorStop(0, "rgba(3, 4, 10, 0)");
  bottom.addColorStop(0.45, "rgba(3, 4, 10, 0.82)");
  bottom.addColorStop(1, "rgba(3, 4, 10, 0.96)");
  ctx.fillStyle = bottom;
  ctx.fillRect(0, bottomStart, width, height - bottomStart);

  // names in the picture, like on screen: the most important first, and none on top of another
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.font = "600 26px Inter, sans-serif";
  ctx.shadowColor = "rgba(0, 0, 0, 0.9)";
  ctx.shadowBlur = 12;
  ctx.fillStyle = "rgba(240, 243, 255, 0.95)";
  const placed = [];
  for (const label of labels) {
    const half = ctx.measureText(label.text).width / 2 + 8;
    const box = [label.x - half, label.y - 4, label.x + half, label.y + 34];
    if (placed.some((b) => box[0] < b[2] && box[2] > b[0] && box[1] < b[3] && box[3] > b[1])) continue;
    placed.push(box);
    ctx.fillText(label.text, label.x, label.y);
  }
  ctx.shadowBlur = 0;

  // the mark and the name, and the dates, across the top
  const margin = 72;
  ctx.drawImage(await markImage(), margin, margin - 4, 46, 46);
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillStyle = INK;
  ctx.font = "600 27px 'Space Grotesk', sans-serif";
  spaced(ctx, "APHELION", margin + 64, margin + 19, 6);
  ctx.textAlign = "right";
  ctx.fillStyle = FAINT;
  ctx.font = "600 21px 'Space Grotesk', sans-serif";
  spaced(ctx, copy.eyebrow.toUpperCase(), width - margin, margin + 19, 3.5);

  // the title, the numbers, and the top five, along the bottom
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  const rowHeight = 50;
  let y = height - margin - copy.list.length * rowHeight - 70 - 56 - 74;
  ctx.fillStyle = INK;
  ctx.font = "600 68px 'Space Grotesk', sans-serif";
  ctx.fillText(fitText(ctx, copy.title, width - margin * 2), margin, y);
  y += 56;
  ctx.fillStyle = MUTED;
  ctx.font = "400 29px Inter, sans-serif";
  ctx.fillText(fitText(ctx, copy.subtitle, width - margin * 2), margin, y);
  y += 74;
  ctx.fillStyle = "rgba(255, 255, 255, 0.12)";
  ctx.fillRect(margin, y - 46, width - margin * 2, 2);
  ctx.fillStyle = FAINT;
  ctx.font = "600 20px 'Space Grotesk', sans-serif";
  spaced(ctx, copy.listTitle.toUpperCase(), margin, y, 3.5);
  y += 30;
  copy.list.forEach((item, i) => {
    const row = y + rowHeight * (i + 1) - 12;
    ctx.fillStyle = FAINT;
    ctx.font = "500 26px Inter, sans-serif";
    ctx.textAlign = "left";
    ctx.fillText(String(i + 1), margin, row);
    ctx.fillStyle = item.color;
    ctx.beginPath();
    ctx.arc(margin + 52, row - 9, 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.textAlign = "right";
    ctx.fillStyle = MUTED;
    ctx.fillText(item.value, width - margin, row);
    const valueWidth = ctx.measureText(item.value).width;
    ctx.textAlign = "left";
    ctx.fillStyle = INK;
    ctx.font = "500 30px Inter, sans-serif";
    ctx.fillText(fitText(ctx, item.name, width - margin * 2 - 80 - valueWidth - 24), margin + 76, row);
  });
  return canvas;
}

// The Share button in the top bar, and its window: choose a size, see the poster, download it.
// make(format) -> a promise of the poster canvas; filename(format) -> its file name
export function setupShare({ make, filename }) {
  const dialog = $("share"), image = $("share-image"), download = $("share-download");
  let format = "post", poster = null, returnFocus = null;

  async function show() {
    poster = null;
    image.removeAttribute("src");
    dialog.classList.add("making");
    download.disabled = true;
    for (const b of dialog.querySelectorAll("[data-format]")) b.setAttribute("aria-checked", String(b.dataset.format === format));
    const made = await make(format);
    poster = made;
    image.src = made.toDataURL("image/png");
    dialog.classList.remove("making");
    download.disabled = false;
  }

  function open() {
    returnFocus = document.activeElement;
    dialog.hidden = false;
    show();
    download.focus();
  }

  function close() {
    dialog.hidden = true;
    if (returnFocus?.isConnected) returnFocus.focus({ preventScroll: true });
  }

  for (const b of dialog.querySelectorAll("[data-format]")) {
    b.onclick = () => {
      format = b.dataset.format;
      show();
    };
  }
  download.onclick = () => {
    if (!poster) return;
    poster.toBlob((blob) => {
      const url = URL.createObjectURL(blob);
      const link = el("a");
      link.href = url;
      link.download = filename(format);
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }, "image/png");
  };
  $("share-close").append(icon("close"));
  $("share-close").onclick = close;
  dialog.onpointerdown = (e) => { if (e.target === dialog) close(); };
  dialog.onkeydown = (e) => {
    if (e.key !== "Escape") return;
    e.stopPropagation();
    close();
  };

  const button = el("button", "action");
  button.type = "button";
  button.title = "Share a poster of your galaxy";
  button.setAttribute("aria-label", "Share");
  button.append(icon("share"), el("span", "action-label", "Share"));
  button.onclick = open;
  $("actions").append(button);
}
