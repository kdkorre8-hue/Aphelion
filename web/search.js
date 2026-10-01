// Search your galaxy: artists (stars and dust) and songs, from a box opened with "/", Ctrl+K (Cmd+K on a Mac)
// or the search button. Type to narrow it down, arrow keys to choose, Enter to go there.
import { el, icon } from "./ui.js";

const $ = (id) => document.getElementById(id);
const MAX_PER_GROUP = 8;

// Lower case without accents, so "beyonce" finds Beyoncé
const normalize = (text) => text.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase();

// How well a name matches what you typed: the whole name, its start, the start of one of its words, anywhere
function score(key, query) {
  if (key === query) return 4;
  if (key.startsWith(query)) return 3;
  if (key.split(/[^\p{L}\p{N}]+/u).some((word) => word.startsWith(query))) return 2;
  return key.includes(query) ? 1 : 0;
}

// items: [{ group: "Artists" | "Songs", name, meta, color, weight, pick }], best first when nothing is typed.
// suggestions: what to show before you type.
export function setupSearch(items, suggestions) {
  for (const item of items) item.key = normalize(item.name);
  const dialog = $("search"), input = $("search-input"), results = $("search-results"), empty = $("search-empty");
  $("search-field").prepend(icon("search"));
  let shown = [], active = 0, returnFocus = null;

  function render() {
    const query = normalize(input.value.trim());
    let groups;
    if (!query) groups = [["Your top artists", suggestions]];
    else {
      const matches = items.map((item) => [item, score(item.key, query)]).filter(([, s]) => s > 0)
        .sort((a, b) => b[1] - a[1] || b[0].weight - a[0].weight).map(([item]) => item);
      groups = ["Artists", "Songs"].map((name) => [name, matches.filter((m) => m.group === name).slice(0, MAX_PER_GROUP)]);
    }
    results.replaceChildren();
    shown = [];
    for (const [title, list] of groups) {
      if (!list.length) continue;
      const heading = el("li", "search-group", title);
      heading.setAttribute("role", "presentation");
      results.append(heading);
      for (const item of list) {
        const row = el("li", "search-result");
        row.id = `search-result-${shown.length}`;
        row.setAttribute("role", "option");
        const dot = el("span", "search-dot");
        dot.style.background = item.color;
        row.append(dot, el("span", "search-name", item.name), el("span", "search-meta", item.meta));
        const index = shown.length;
        row.onpointermove = () => setActive(index);
        row.onclick = () => choose(index);
        results.append(row);
        shown.push(item);
      }
    }
    empty.hidden = shown.length > 0;
    setActive(0);
  }

  function setActive(index) {
    active = Math.max(0, Math.min(index, shown.length - 1));
    results.querySelectorAll(".search-result").forEach((row, i) => row.setAttribute("aria-selected", String(i === active)));
    const row = $(`search-result-${active}`);
    if (row) {
      input.setAttribute("aria-activedescendant", row.id);
      row.scrollIntoView({ block: "nearest" });
    } else input.removeAttribute("aria-activedescendant");
  }

  function choose(index) {
    const item = shown[index];
    if (!item) return;
    close();
    item.pick();
  }

  function open() {
    if (!dialog.hidden) return;
    returnFocus = document.activeElement;
    dialog.hidden = false;
    input.value = "";
    render();
    input.focus();
  }

  function close() {
    if (dialog.hidden) return;
    dialog.hidden = true;
    if (returnFocus?.isConnected) returnFocus.focus({ preventScroll: true });
  }

  input.oninput = render;
  input.onkeydown = (e) => {
    if (e.key === "ArrowDown") setActive(active + 1);
    else if (e.key === "ArrowUp") setActive(active - 1);
    else if (e.key === "Enter") choose(active);
    else if (e.key === "Escape") close();
    else return;
    e.preventDefault();
    e.stopPropagation(); // Escape here only closes the search
  };
  dialog.onpointerdown = (e) => { if (e.target === dialog) close(); }; // outside the box
  window.addEventListener("keydown", (e) => {
    const typing = e.target.closest?.("input, textarea, [contenteditable]");
    if (((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") || (e.key === "/" && !typing && !e.ctrlKey && !e.metaKey)) {
      e.preventDefault();
      open();
    }
  });

  // the button in the top bar
  const button = el("button", "action");
  button.type = "button";
  button.title = "Search (/)";
  button.setAttribute("aria-label", "Search");
  button.append(icon("search"), el("span", "action-label", "Search"), el("kbd", "", "/"));
  button.onclick = open;
  $("actions").append(button);
  $("skip").onclick = open; // the keyboard's first stop on the page

  return { open, close };
}
