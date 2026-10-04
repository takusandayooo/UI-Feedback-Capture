import { errorMessage } from "./types";

const unavailableMessage =
  "このページでは使えません。通常のWebページを開いてから押してください。";
async function actionStatus(tabId: number, title: string, badge = "") {
  await Promise.allSettled([
    chrome.action.setBadgeText({ tabId, text: badge }),
    chrome.action.setTitle({ tabId, title }),
  ]);
}
chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.id) return;
  const url = tab.url || "";
  if (
    /^(chrome|chrome-extension|devtools|about|edge):/.test(url) ||
    /^https:\/\/(chromewebstore\.google\.com|chrome\.google\.com\/webstore)(\/|$)/.test(
      url,
    )
  ) {
    await actionStatus(tab.id, unavailableMessage);
    return;
  }
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["content.js"],
    });
    await actionStatus(tab.id, "UIの修正指示を作成");
  } catch (error) {
    const message = errorMessage(error);
    if (
      /Cannot access|extensions gallery cannot be scripted|Missing host permission/i.test(
        message,
      )
    ) {
      await actionStatus(tab.id, unavailableMessage);
    } else {
      await actionStatus(
        tab.id,
        `起動できません: ${message || "ページを再読み込みして再試行してください。"}`,
        "!",
      );
    }
  }
});
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (message.type === "feedback-privacy") {
    chrome.tabs.create({ url: chrome.runtime.getURL("privacy.html") });
    return;
  }
  if (message.type !== "feedback-capture" || !sender.tab) return;
  const tab = sender.tab;
  (async () => {
    const active = await chrome.tabs.query({
      active: true,
      windowId: tab.windowId,
    });
    if (active[0]?.id !== tab.id)
      throw new Error("対象タブを開いてから再試行してください。");
    return await chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" });
  })().then(
    (data) => respond({ data }),
    (error) => respond({ error: error.message }),
  );
  return true;
});
