// Keyboard shortcut (Alt+Shift+V by default) and the toolbar badge.
"use strict";
const KEY = "drift";

async function getOpts() {
  const r = await browser.storage.local.get(KEY);
  return { enabled: true, saveData: true, ...(r[KEY] || {}) };
}

function showBadge(o) {
  browser.browserAction.setBadgeText({ text: o.enabled ? "" : "off" });
  browser.browserAction.setBadgeBackgroundColor({ color: "#4a4460" });
}

browser.commands.onCommand.addListener(async (name) => {
  if (name !== "toggle-visualizer") return;
  const o = await getOpts();
  o.enabled = !o.enabled;
  await browser.storage.local.set({ [KEY]: o });
});

browser.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes[KEY]) showBadge({ enabled: true, ...(changes[KEY].newValue || {}) });
});

getOpts().then(showBadge);
