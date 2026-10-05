import { capture, captureElement } from "./capture";
import { placeComment } from "./comment-position";
import { bindIMEInput } from "./editing";
import { icon } from "./icons";
import { buildPrompt } from "./prompt";
import { createVoiceInput } from "./speech";
import type {
  CaptureMode,
  DrawingTool,
  FeedbackElement,
  FeedbackSession,
  IMEBinding,
  Point,
  RecognitionConstructor,
  SavedDraft,
  Stroke,
  TextInput,
} from "./types";
import { errorMessage } from "./types";
import { renderUI } from "./ui";

(() => {
  const existing = document.getElementById("ui-feedback-capture-host");
  if (existing) {
    existing.dispatchEvent(new Event("ui-feedback-activate"));
    return;
  }
  const host = document.createElement("div");
  host.id = "ui-feedback-capture-host";
  host.style.cssText =
    "all:initial;position:fixed;inset:0;z-index:2147483647;pointer-events:none;color:#20232d;font:13px/1.5 system-ui,sans-serif;";
  document.documentElement.append(host);
  const root = host.attachShadow({ mode: "open" });
  const visibilityStyle = document.createElement("style");
  visibilityStyle.textContent = ":host([hidden]){display:none!important}";
  root.innerHTML = renderUI();
  interface UIElements {
    "#canvas": HTMLCanvasElement;
    "#preview": HTMLTextAreaElement;
    "#image-note": HTMLTextAreaElement;
    "#image-thumb": HTMLImageElement;
    "#capture-mode": HTMLSelectElement;
    "#editor-capture-mode": HTMLSelectElement;
    "#width": HTMLSelectElement;
    "#color": HTMLInputElement;
    "#copy": HTMLButtonElement;
    "#undo": HTMLButtonElement;
  }
  function $<S extends string>(
    selector: S,
  ): S extends keyof UIElements ? UIElements[S] : HTMLElement {
    const element = root.querySelector(selector);
    if (!element) throw new Error(`UI要素が見つかりません: ${selector}`);
    return element as S extends keyof UIElements ? UIElements[S] : HTMLElement;
  }
  root.append(visibilityStyle);
  const key = `ui-feedback:${location.origin}${location.pathname}${location.search}`;
  let session: FeedbackSession = {
    url: location.href,
    title: document.title,
    items: [],
    hasImage: false,
    imageNote: "",
  };
  let capturing = false,
    captureCancelled = false;
  let imageMode: CaptureMode = "visible",
    editorMode: CaptureMode = "visible";
  let pendingRecapture: ((accepted: boolean) => void) | null = null;
  let hoveredItem: FeedbackElement | null = null;
  const targetElements = new WeakMap<FeedbackElement, Element>();
  const cardInputs = new WeakMap<FeedbackElement, HTMLTextAreaElement>();
  let anchoredItem: FeedbackElement | null = null;
  let anchorFrame = 0;
  let picking = false;
  let current: EventTarget | null = null;
  let imageData: string | null = null,
    baseImage: HTMLImageElement | null = null;
  let strokes: Stroke[] = [],
    savedStrokes: Stroke[] = [];
  let tool: DrawingTool = "pen",
    drawing: Stroke | null = null;
  const canvas = $("#canvas");
  const context = canvas.getContext("2d");
  if (!context) throw new Error("画像編集を利用できません。");
  const ctx: CanvasRenderingContext2D = context;
  let saveQueue = Promise.resolve();
  let draftTouched = false;
  const composingInputs = new WeakMap<EventTarget, IMEBinding>();
  function bindInput(input: TextInput, commit: (value: string) => void) {
    composingInputs.set(input, bindIMEInput(input, commit));
  }
  root.addEventListener(
    "input",
    () => {
      draftTouched = true;
    },
    true,
  );
  root.addEventListener(
    "compositionstart",
    () => {
      draftTouched = true;
    },
    true,
  );
  root.addEventListener(
    "click",
    () => {
      draftTouched = true;
    },
    true,
  );
  const status = (message: string) => {
    $("#status").textContent = message;
    $("#editor-status").textContent = message;
  };
  function persist() {
    const snapshot = JSON.parse(
      JSON.stringify({
        ...session,
        imageData,
        imageMode,
        strokes: savedStrokes,
      }),
    );
    saveQueue = saveQueue
      .then(() => chrome.storage.local.set({ [key]: snapshot }))
      .catch(() =>
        status(
          "下書きの保存に失敗しました。コピーまたはダウンロードしてください。",
        ),
      );
  }
  function refresh() {
    const text = buildPrompt(session);
    $("#preview").value = text;
    $("#empty").hidden = session.items.length > 0;
    $("#image-actions").hidden = !imageData;
    $("#count").textContent = String(session.items.length);
    $("#copy").disabled = !session.items.length && !imageData;
    if (imageData) $("#image-thumb").src = imageData;
    else $("#image-thumb").removeAttribute("src");
  }
  const voiceControls = new Map<
    TextInput,
    { button: HTMLButtonElement; preview: HTMLDivElement; label: string }
  >();
  const speechWindow = window as Window & {
    SpeechRecognition?: RecognitionConstructor;
    webkitSpeechRecognition?: RecognitionConstructor;
  };
  const Recognition =
    speechWindow.SpeechRecognition || speechWindow.webkitSpeechRecognition;
  const voice = createVoiceInput(Recognition, {
    state(target, phase) {
      for (const [input, control] of voiceControls) {
        input.readOnly = input === target;
        control.button.disabled =
          !Recognition ||
          (!!target && (input !== target || phase === "stopping"));
        control.button.innerHTML =
          icon(input === target ? "stop" : "mic") +
          (input === target
            ? phase === "stopping"
              ? "確定中"
              : "停止"
            : "音声");
        control.button.setAttribute("aria-pressed", String(input === target));
        control.button.setAttribute(
          "aria-label",
          `${control.label}の${input === target ? "音声入力を停止" : "音声入力"}`,
        );
        if (input !== target) control.preview.textContent = "";
        else
          control.preview.textContent =
            phase === "starting"
              ? "マイクを確認中…"
              : phase === "stopping"
                ? "確定中…"
                : "聞き取り中…";
      }
    },
    interim(text) {
      const control = voice.activeTarget
        ? voiceControls.get(voice.activeTarget)
        : undefined;
      if (control) control.preview.textContent = text || "聞き取り中…";
    },
    append(input, text) {
      input.value +=
        (input.value && !/\s$/.test(input.value) ? "\n" : "") + text;
      input.dispatchEvent(new Event("input", { bubbles: true }));
    },
    error(message) {
      status(message);
      for (const control of voiceControls.values())
        control.preview.textContent = message;
    },
  });
  function addVoiceControl(input: TextInput, label: string) {
    const row = document.createElement("div");
    row.className = "row voice-row";
    const button = document.createElement("button");
    button.innerHTML = `${icon("mic")}音声`;
    button.setAttribute("aria-label", `${label}の音声入力`);
    button.setAttribute("aria-pressed", "false");
    const preview = document.createElement("div");
    preview.className = "voice-preview";
    preview.setAttribute("role", "status");
    row.append(button);
    input.after(row);
    row.after(preview);
    voiceControls.set(input, { button, preview, label });
    button.disabled = !Recognition;
    if (!Recognition)
      button.title = "このブラウザーは音声入力に対応していません。";
    button.onclick = () => {
      if (voice.activeTarget === input) voice.stop();
      else if (!voice.activeTarget) voice.start(input);
    };
  }
  addVoiceControl($("#image-note"), "画像の補足");
  const inlineEditor = document.createElement("section");
  inlineEditor.className = "inline-comment";
  inlineEditor.hidden = true;
  inlineEditor.setAttribute("aria-label", "選択した要素のコメント");
  const inlineHeader = document.createElement("header");
  const inlineTitle = document.createElement("strong");
  const inlineClose = document.createElement("button");
  inlineClose.className = "icon";
  inlineClose.innerHTML = icon("close");
  inlineClose.setAttribute("aria-label", "コメント入力を閉じる");
  inlineClose.onclick = () => closeInlineComment();
  inlineHeader.append(inlineTitle, inlineClose);
  const inlineInput = document.createElement("textarea");
  inlineInput.placeholder = "変更したいこと…";
  inlineInput.setAttribute("aria-label", "選択した要素の修正指示");
  inlineEditor.append(inlineHeader, inlineInput);
  root.append(inlineEditor);
  bindInput(inlineInput, (value) => {
    if (anchoredItem) updateInstruction(anchoredItem, value, inlineInput);
  });
  addVoiceControl(inlineInput, "選択した要素の修正指示");
  const inlineActions = document.createElement("div");
  inlineActions.className = "inline-actions";
  const inlineNext = document.createElement("button");
  inlineNext.innerHTML = `${icon("plus")}要素を追加`;
  inlineNext.onclick = startPicking;
  const inlineDone = document.createElement("button");
  inlineDone.className = "primary";
  inlineDone.textContent = "完了";
  inlineDone.onclick = () => closeInlineComment();
  inlineActions.append(inlineNext, inlineDone);
  inlineEditor.append(inlineActions);
  function updateInstruction(
    item: FeedbackElement,
    value: string,
    source: TextInput,
  ) {
    item.instruction = value;
    const cardInput = cardInputs.get(item);
    if (cardInput && cardInput !== source)
      composingInputs.get(cardInput)?.setValue(value);
    if (anchoredItem === item && inlineInput !== source)
      composingInputs.get(inlineInput)?.setValue(value);
    refresh();
    persist();
  }
  function closeInlineComment(showPanel = true) {
    if (!anchoredItem) return true;
    inlineInput.blur();
    const binding = composingInputs.get(inlineInput);
    if (binding?.composing) return false;
    binding?.flush();
    voice.cancel();
    anchoredItem = null;
    cancelAnimationFrame(anchorFrame);
    inlineEditor.hidden = true;
    $(".highlight").hidden = true;
    if (showPanel) {
      $(".panel").hidden = false;
      $("#pick").focus({ preventScroll: true });
    }
    return true;
  }
  function positionInlineComment() {
    if (!anchoredItem) return;
    const element = resolveElement(anchoredItem);
    if (!element?.isConnected) {
      closeInlineComment();
      status("対象要素が見つかりません。要素を選び直してください。");
      return;
    }
    const rect = element.getBoundingClientRect();
    inlineEditor.style.maxHeight = "calc(100vh - 24px)";
    const position = placeComment(
      { x: rect.left, y: rect.top, width: rect.width, height: rect.height },
      inlineEditor.offsetWidth,
      inlineEditor.offsetHeight,
      innerWidth,
      innerHeight,
    );
    inlineEditor.style.left = `${position.left}px`;
    inlineEditor.style.top = `${position.top}px`;
    inlineEditor.style.maxHeight = `${position.maxHeight}px`;
    inlineEditor.style.visibility = position.visible ? "" : "hidden";
    inlineEditor.dataset.side = position.side;
    if (position.visible) drawHighlight(element);
    else $(".highlight").hidden = true;
    anchorFrame = requestAnimationFrame(positionInlineComment);
  }
  function openInlineComment(item: FeedbackElement) {
    if (!closeInlineComment(false)) return;
    const element = resolveElement(item);
    if (!element) {
      status("対象要素が見つかりません。要素を選び直してください。");
      return;
    }
    clearHover();
    voice.cancel();
    anchoredItem = item;
    inlineTitle.textContent = `${session.items.indexOf(item) + 1} · ${item.tag} ${item.text.slice(0, 48) || item.selector}`;
    composingInputs.get(inlineInput)?.setValue(item.instruction);
    inlineEditor.hidden = false;
    $(".panel").hidden = true;
    positionInlineComment();
    inlineInput.focus({ preventScroll: true });
  }
  host.addEventListener("ui-feedback-stop-voice", () => voice.cancel());
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) voice.cancel();
  });
  window.addEventListener("pagehide", () => voice.cancel());
  function renderItems() {
    clearHover();
    voice.cancel();
    for (const input of voiceControls.keys())
      if (input !== $("#image-note") && input !== inlineInput)
        voiceControls.delete(input);

    $("#items").replaceChildren();
    session.items.forEach((item, index) => {
      const card = document.createElement("div");
      card.className = "card";
      card.addEventListener("pointerenter", () => {
        if (picking || capturing || anchoredItem) return;
        hoveredItem = item;
        updateHover();
      });
      card.addEventListener("pointerleave", () => {
        if (hoveredItem === item) clearHover();
      });
      const row = document.createElement("div");
      row.className = "card-head";
      const number = document.createElement("span");
      number.className = "number";
      number.textContent = String(index + 1);
      const title = document.createElement("strong");
      title.className = "card-title";
      title.textContent = `${item.tag} · ${item.text.slice(0, 70) || item.selector}`;
      title.title = title.textContent;
      const remove = document.createElement("button");
      remove.className = "icon";
      remove.innerHTML = icon("trash");
      remove.setAttribute("aria-label", `${index + 1}番の指示を削除`);
      remove.onclick = () => {
        if (anchoredItem === item) closeInlineComment();
        session.items.splice(index, 1);
        renderItems();
        refresh();
        persist();
      };
      const edit = document.createElement("button");
      edit.className = "icon";
      edit.innerHTML = icon("pen");
      edit.setAttribute("aria-label", `${index + 1}番の指示を要素のそばで編集`);
      edit.onclick = () => {
        const element = resolveElement(item);
        element?.scrollIntoView({
          block: "center",
          inline: "nearest",
          behavior: "instant",
        });
        openInlineComment(item);
      };
      row.append(number, title, edit, remove);
      const meta = document.createElement("div");
      meta.className = "meta";
      meta.textContent = item.selector;
      const detail = document.createElement("details");
      detail.className = "element-detail";
      const summary = document.createElement("summary");
      summary.textContent = "要素";
      detail.append(summary, meta);
      const downloads = document.createElement("div");
      downloads.className = "element-downloads";
      for (const [format, label] of [
        ["html", "HTMLを保存"],
        ["png", "画像を保存"],
      ] as const) {
        const button = document.createElement("button");
        button.innerHTML = icon("download") + label;
        button.setAttribute("aria-label", `${index + 1}番の要素の${label}`);
        button.onclick = async () => {
          if (capturing) return;
          button.disabled = true;
          try {
            await exportElement(item, index, format);
          } catch (error) {
            status(errorMessage(error));
          } finally {
            button.disabled = false;
          }
        };
        downloads.append(button);
      }
      detail.append(downloads);
      const input = document.createElement("textarea");
      input.placeholder = "変更したいこと…";
      input.value = item.instruction;
      input.setAttribute("aria-label", `${index + 1}番の修正指示`);
      cardInputs.set(item, input);
      bindInput(input, (value) => updateInstruction(item, value, input));
      card.append(row, detail, input);
      $("#items").append(card);
      addVoiceControl(input, `${index + 1}番の修正指示`);
    });
  }
  function selectorFor(element: Element): string {
    const parts = [];
    for (
      let el: Element | null = element;
      el && el.nodeType === 1;
      el = el.parentElement
    ) {
      let part = el.localName;
      if (el.id) {
        part += `#${CSS.escape(el.id)}`;
        parts.unshift(part);
        if (document.querySelectorAll(parts.join(" > ")).length === 1) break;
      } else {
        const classes = [...el.classList]
          .slice(0, 3)
          .map((c) => `.${CSS.escape(c)}`)
          .join("");
        part += classes;
        const siblings = el.parentElement
          ? [...el.parentElement.children].filter((s) => s.matches(part))
          : [];
        if (siblings.length > 1)
          part += `:nth-child(${[...(el.parentElement?.children || [])].indexOf(el) + 1})`;
        parts.unshift(part);
        if (document.querySelectorAll(parts.join(" > ")).length === 1) break;
      }
    }
    return parts.join(" > ");
  }
  function inspect(element: Element): FeedbackElement {
    const rect = element.getBoundingClientRect(),
      styles = getComputedStyle(element);
    const selected: Record<string, string> = {};
    [
      "display",
      "color",
      "background-color",
      "font-family",
      "font-size",
      "font-weight",
      "line-height",
      "text-align",
      "padding",
      "margin",
      "border",
      "border-radius",
      "width",
      "height",
    ].forEach((name) => {
      selected[name] = styles.getPropertyValue(name);
    });
    const path = [];
    for (let el: Element | null = element; el; el = el.parentElement)
      path.unshift(el.localName + (el.id ? `#${el.id}` : ""));
    // Strip form contents from the HTML excerpt, which may include private input.
    const clone = element.cloneNode(true) as Element;
    [clone, ...clone.querySelectorAll("input,textarea,select")].forEach(
      (el) => {
        if (el.matches("input,textarea,select")) {
          el.removeAttribute("value");
          el.removeAttribute("checked");
          el.removeAttribute("selected");
          if (el.matches("textarea,select")) el.textContent = "";
        }
      },
    );
    const exportHtml = clone.outerHTML;
    return {
      exportHtml,
      tag: element.localName,
      selector: selectorFor(element),
      path: path.join(" > "),
      text: element.matches("input,textarea,select")
        ? ""
        : (
            (element instanceof HTMLElement
              ? element.innerText
              : element.textContent) ||
            element.textContent ||
            ""
          )
            .trim()
            .slice(0, 500),
      html: exportHtml.slice(0, 2000),
      styles: selected,
      bounds: {
        x: Math.round(rect.x + scrollX),
        y: Math.round(rect.y + scrollY),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      },
      viewport: { width: innerWidth, height: innerHeight, scrollX, scrollY },
      instruction: "",
    };
  }
  async function exportElement(
    item: FeedbackElement,
    index: number,
    format: "html" | "png",
  ) {
    const html = item.exportHtml || item.html || "";
    const htmlIsExcerpt = !item.exportHtml;
    const name = `ui-element-${index + 1}-${(item.tag || "element").replace(/[^a-z0-9-]/gi, "")}`;
    if (format === "png") {
      const element = resolveElement(item);
      if (!element)
        throw new Error("対象要素が見つかりません。要素を選び直してください。");
      capturing = true;
      captureCancelled = false;
      clearHover();
      voice.cancel();
      status("要素を撮影中…");
      try {
        const data = await captureElement(element, {
          host,
          mode: "visible",
          cancelled: () => captureCancelled,
          progress: (done, total) => status(`要素を撮影中 ${done}/${total}`),
        });
        const blob = await (await fetch(data)).blob();
        if (captureCancelled) throw new Error("撮影をキャンセルしました。");
        download(blob, `${name}.png`);
        status("要素の画像を保存しました。");
      } finally {
        capturing = false;
      }
      return;
    } else {
      // Keep downloaded markup inert when opened as a document.
      const documentHtml =
        "<!doctype html>\n<html lang='ja'><head><meta charset='UTF-8'><meta http-equiv='Content-Security-Policy' content=\"default-src 'none'; style-src 'unsafe-inline'; form-action 'none'; base-uri 'none'\"><title>UI element</title></head><body>\n" +
        html +
        "\n</body></html>\n";
      download(
        new Blob([documentHtml], { type: "text/html;charset=utf-8" }),
        `${name}.html`,
      );
    }
    status(
      htmlIsExcerpt
        ? "保存済みのHTML抜粋を書き出しました。全文は要素を選び直して保存してください。"
        : "要素のHTMLを書き出しました。",
    );
  }
  function drawHighlight(element: Element | null | undefined) {
    if (!element?.isConnected) {
      $(".highlight").hidden = true;
      return;
    }
    const rect = element.getBoundingClientRect();
    $(".highlight").style.cssText =
      `left:${rect.left}px;top:${rect.top}px;width:${rect.width}px;height:${rect.height}px`;
    $(".highlight").hidden = rect.width === 0 || rect.height === 0;
  }
  function clearHover() {
    hoveredItem = null;
    if (!picking && !anchoredItem) $(".highlight").hidden = true;
  }
  function resolveElement(item: FeedbackElement) {
    let element: Element | null | undefined = targetElements.get(item);
    if (!element?.isConnected) {
      try {
        const candidates = document.querySelectorAll(item.selector);
        element = candidates.length === 1 ? candidates[0] : null;
      } catch {
        element = null;
      }
      if (element) targetElements.set(item, element);
    }
    return element;
  }
  function updateHover() {
    if (!hoveredItem || picking || capturing || anchoredItem) return;
    const element = resolveElement(hoveredItem);
    drawHighlight(element);
    if (!element)
      status(
        "このコメントの対象要素が見つかりません。ページの内容が変わった可能性があります。",
      );
  }
  window.addEventListener("scroll", updateHover, true);
  window.addEventListener("resize", updateHover);
  function stopPicking() {
    clearHover();
    picking = false;
    current = null;
    $(".highlight").hidden = true;
    $(".hint").hidden = true;
    $(".panel").hidden = false;
  }
  function startPicking() {
    if (capturing) {
      captureCancelled = true;
      return;
    }
    if (pendingRecapture) settleRecapture(false);
    if (!closeInlineComment(false)) return;
    clearHover();
    voice.cancel();
    host.hidden = false;
    picking = true;
    current = null;
    $(".editor").hidden = true;
    $(".highlight").hidden = true;
    $(".panel").hidden = true;
    $(".hint").hidden = false;
    $("#cancel-pick").focus({ preventScroll: true });
  }

  for (const [toggleId, targetId] of [["menu-toggle", "menu"]]) {
    $(`#${toggleId}`).onclick = () => {
      const target = $(`#${targetId}`);
      target.hidden = !target.hidden;
      $(`#${toggleId}`).setAttribute("aria-expanded", String(!target.hidden));
    };
  }
  $("#privacy").onclick = () =>
    chrome.runtime
      .sendMessage({ type: "feedback-privacy" })
      .catch(() => status("拡張機能を再読み込みしてください。"));
  $("#remove-image").onclick = () => {
    voice.cancel();
    imageData = null;
    savedStrokes = [];
    session.hasImage = false;
    session.imageNote = "";
    refresh();
    persist();
  };
  $("#clear-draft").onclick = async () => {
    voice.cancel();
    clearHover();
    closeInlineComment(false);
    session.items = [];
    session.hasImage = false;
    session.imageNote = "";
    imageData = null;
    savedStrokes = [];
    renderItems();
    refresh();
    $("#menu").hidden = true;
    $("#menu-toggle").setAttribute("aria-expanded", "false");
    try {
      await saveQueue;
      await chrome.storage.local.remove(key);
      status("下書きを削除しました。");
    } catch {
      status("下書きを削除できませんでした。再試行してください。");
    }
  };
  function cancelPicking() {
    stopPicking();
    $("#pick").focus({ preventScroll: true });
  }
  $("#cancel-pick").onclick = cancelPicking;
  $("#pick-capture").onclick = () => {
    stopPicking();
    captureImage($("#capture-mode").value === "full" ? "full" : "visible");
  };
  $("#pick").onclick = startPicking;
  function showPanel() {
    if (capturing) return;
    if (pendingRecapture) settleRecapture(false);
    if (!closeInlineComment(false)) return;
    voice.cancel();
    host.hidden = false;
    $(".editor").hidden = true;
    stopPicking();
    $("#pick").focus({ preventScroll: true });
  }
  host.addEventListener("ui-feedback-activate", showPanel);
  document.addEventListener(
    "pointermove",
    (event) => {
      if (!picking || event.composedPath().includes(host)) return;
      current = event.target;
      if (!(current instanceof Element)) return;
      drawHighlight(current);
    },
    true,
  );
  document.addEventListener(
    "click",
    (event) => {
      if (
        !picking ||
        event.composedPath().includes(host) ||
        !(event.target instanceof Element)
      )
        return;
      event.preventDefault();
      event.stopImmediatePropagation();
      draftTouched = true;
      const item = inspect(event.target);
      targetElements.set(item, event.target);
      session.items.push(item);
      stopPicking();
      renderItems();
      refresh();
      persist();
      openInlineComment(item);
    },
    true,
  );
  function handleEscape(event: KeyboardEvent) {
    const target = event.composedPath()[0];
    if (
      event.isComposing ||
      event.keyCode === 229 ||
      composingInputs.get(target)?.composing
    )
      return;
    if (event.key === "Escape") {
      if (pendingRecapture) {
        event.preventDefault();
        settleRecapture(false);
        return;
      }
      if (capturing) {
        captureCancelled = true;
        event.preventDefault();
        return;
      }
      voice.cancel();
      if (picking) {
        event.preventDefault();
        cancelPicking();
      } else if (anchoredItem) {
        event.preventDefault();
        closeInlineComment();
      } else if (!$(".editor").hidden) {
        event.preventDefault();
        cancelImage();
      }
    }
  }
  // Shadow DOM retargets textarea key events to the host div. Prevent page
  // shortcuts from treating those events as keys pressed outside an editor.
  for (const type of ["keydown", "keyup", "keypress"] as const) {
    window.addEventListener(
      type,
      (event) => {
        if (!event.composedPath().includes(host)) {
          if (
            type === "keydown" &&
            picking &&
            event.key === "Escape" &&
            !event.isComposing &&
            event.keyCode !== 229
          ) {
            event.stopImmediatePropagation();
            handleEscape(event);
          }
          return;
        }
        event.stopImmediatePropagation();
        if (type === "keydown") handleEscape(event);
        // Keep native typing, IME conversion, Enter and clipboard shortcuts.
      },
      true,
    );
  }
  document.addEventListener("keydown", handleEscape, true);
  $("#close").onclick = () => {
    voice.cancel();
    closeInlineComment(false);
    stopPicking();
    host.hidden = true;
  };
  bindInput($("#image-note"), () => {});
  async function clipboardText(text: string) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const area = $("#preview");
      area.value = text;
      area.focus();
      area.select();
      if (!document.execCommand("copy"))
        throw new Error(
          "コピーできません。プレビューを選択して手動でコピーしてください。",
        );
    }
  }
  $("#copy").onclick = async () => {
    try {
      await clipboardText(buildPrompt(session));
      status(
        "プロンプトをコピーしました。" +
          (imageData ? "画像も別途添付してください。" : ""),
      );
    } catch (e) {
      status(errorMessage(e));
    }
  };
  function download(blob: Blob, name: string) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    root.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }
  function redraw() {
    if (!baseImage) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(baseImage, 0, 0);
    for (const stroke of [...strokes, ...(drawing ? [drawing] : [])]) {
      const points = stroke.points,
        first = points[0],
        last = points.at(-1);
      if (!first || !last) continue;
      ctx.strokeStyle = stroke.color;
      ctx.lineWidth = stroke.width;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.beginPath();
      if (stroke.tool === "rect")
        ctx.rect(first.x, first.y, last.x - first.x, last.y - first.y);
      else {
        ctx.moveTo(first.x, first.y);
        if (stroke.tool === "pen") {
          if (points.length === 1) ctx.lineTo(first.x + 0.1, first.y);
          else
            points.slice(1).forEach((p) => {
              ctx.lineTo(p.x, p.y);
            });
        } else {
          ctx.lineTo(last.x, last.y);
          const angle = Math.atan2(last.y - first.y, last.x - first.x),
            length = stroke.width * 4;
          for (const delta of [-0.5, 0.5]) {
            ctx.moveTo(last.x, last.y);
            ctx.lineTo(
              last.x - length * Math.cos(angle + delta),
              last.y - length * Math.sin(angle + delta),
            );
          }
        }
      }
      ctx.stroke();
    }
    $("#undo").disabled = strokes.length === 0;
  }
  async function openImage(
    data: string,
    isNew: boolean,
    mode: CaptureMode = imageMode,
  ) {
    clearHover();
    voice.cancel();
    const image = new Image();
    image.src = data;
    await image.decode();
    baseImage = image;
    canvas.width = image.width;
    canvas.height = image.height;
    editorMode = mode;
    $("#editor-capture-mode").value = mode;
    $("#editor-status").textContent = "";
    strokes = isNew ? [] : structuredClone(savedStrokes);
    drawing = null;
    $("#image-note").value = isNew ? "" : session.imageNote;
    $(".panel").hidden = true;
    $(".editor").hidden = false;
    redraw();
  }
  function settleRecapture(confirmed: boolean) {
    const resolve = pendingRecapture;
    pendingRecapture = null;
    $(".recapture-confirm").hidden = true;
    $("#editor-capture-mode").disabled = false;
    $("#editor-capture-mode").focus({ preventScroll: true });
    resolve?.(confirmed);
  }
  $("#keep-image").onclick = () => settleRecapture(false);
  $("#replace-image").onclick = () => settleRecapture(true);
  async function captureImage(mode: CaptureMode, fromEditor = false) {
    if (capturing || pendingRecapture) return;
    if (fromEditor && (strokes.length || drawing)) {
      $("#editor-capture-mode").value = editorMode;
      $("#editor-capture-mode").disabled = true;
      const accepted = await new Promise<boolean>((resolve) => {
        pendingRecapture = resolve;
        $(".recapture-confirm").hidden = false;
        $("#keep-image").focus({ preventScroll: true });
      });
      if (!accepted) return;
      $("#editor-capture-mode").value = mode;
    }
    const note = fromEditor ? $("#image-note").value : "";
    clearHover();
    voice.cancel();
    capturing = true;
    captureCancelled = false;
    const controls = ["capture", "capture-mode", "editor-capture-mode", "done"];
    controls.forEach((id) => {
      ($(`#${id}`) as HTMLButtonElement | HTMLSelectElement).disabled = true;
    });
    canvas.style.pointerEvents = "none";
    $("#image-note").readOnly = true;
    status(mode === "full" ? "ページ全体を撮影中… Escでキャンセル" : "撮影中…");
    try {
      const data = await capture({
        host,
        mode,
        cancelled: () => captureCancelled,
      });
      if (captureCancelled) throw new Error("撮影をキャンセルしました。");
      await openImage(data, true, mode);
      $("#image-note").value = note;
      $("#capture-mode").value = mode;
      status("");
    } catch (error) {
      $("#editor-capture-mode").value = editorMode;
      status(errorMessage(error));
    } finally {
      capturing = false;
      controls.forEach((id) => {
        ($(`#${id}`) as HTMLButtonElement | HTMLSelectElement).disabled = false;
      });
      canvas.style.pointerEvents = "";
      $("#image-note").readOnly = false;
    }
  }
  $("#capture").onclick = () =>
    captureImage($("#capture-mode").value === "full" ? "full" : "visible");
  $("#editor-capture-mode").onchange = () =>
    captureImage(
      $("#editor-capture-mode").value === "full" ? "full" : "visible",
      true,
    );
  $("#edit-image").onclick = () =>
    imageData &&
    openImage(imageData, false).catch((error) => status(errorMessage(error)));
  root.querySelectorAll<HTMLButtonElement>("[data-tool]").forEach((button) => {
    button.onclick = () => {
      tool =
        button.dataset.tool === "rect"
          ? "rect"
          : button.dataset.tool === "arrow"
            ? "arrow"
            : "pen";
      root.querySelectorAll<HTMLButtonElement>("[data-tool]").forEach((b) => {
        b.classList.toggle("active", b === button);
        b.setAttribute("aria-pressed", String(b === button));
      });
    };
  });
  const point = (event: PointerEvent): Point => {
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) * canvas.width) / rect.width,
      y: ((event.clientY - rect.top) * canvas.height) / rect.height,
    };
  };
  canvas.onpointerdown = (event) => {
    if (event.button !== 0) return;
    canvas.setPointerCapture(event.pointerId);
    const scale = canvas.width / canvas.getBoundingClientRect().width;
    drawing = {
      tool,
      color: $("#color").value,
      width: Number($("#width").value) * scale,
      points: [point(event)],
    };
    redraw();
  };
  canvas.onpointermove = (event) => {
    if (!drawing) return;
    const p = point(event);
    if (drawing.tool === "pen") drawing.points.push(p);
    else drawing.points = [drawing.points[0], p];
    redraw();
  };
  canvas.onpointerup = () => {
    if (drawing) {
      strokes.push(drawing);
      drawing = null;
      redraw();
    }
  };
  canvas.onpointercancel = () => {
    drawing = null;
    redraw();
  };
  $("#undo").onclick = () => {
    strokes.pop();
    redraw();
  };
  function cancelImage() {
    if (pendingRecapture) {
      settleRecapture(false);
      return;
    }
    if (capturing) {
      captureCancelled = true;
      return;
    }
    voice.cancel();
    drawing = null;
    $(".editor").hidden = true;
    $(".panel").hidden = false;
  }
  $("#cancel-image").onclick = cancelImage;
  $("#done").onclick = () => {
    if (!baseImage) return;
    voice.cancel();
    if (drawing) {
      strokes.push(drawing);
      drawing = null;
    }
    redraw();
    imageData = baseImage.src;
    imageMode = editorMode;
    savedStrokes = structuredClone(strokes);
    session.hasImage = true;
    session.imageNote = $("#image-note").value;
    cancelImage();
    refresh();
    persist();
    status("画像を添付しました。");
  };
  async function imageBlob(): Promise<Blob> {
    await openImageForExport();
    return new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (blob) =>
          blob ? resolve(blob) : reject(new Error("画像を作成できません。")),
        "image/png",
      ),
    );
  }
  async function openImageForExport() {
    if (!imageData) throw new Error("画像がありません。");
    const image = new Image();
    image.src = imageData;
    await image.decode();
    baseImage = image;
    canvas.width = image.width;
    canvas.height = image.height;
    strokes = structuredClone(savedStrokes);
    drawing = null;
    redraw();
  }
  $("#save-image").onclick = async () => {
    try {
      download(await imageBlob(), "ui-feedback.png");
      status("PNGを書き出しました。");
    } catch (error) {
      status(errorMessage(error));
    }
  };
  $("#copy-image").onclick = async () => {
    try {
      const pending = imageBlob();
      await navigator.clipboard.write([
        new ClipboardItem({ "image/png": pending }),
      ]);
      status("画像をコピーしました。AIの入力欄に貼り付けてください。");
    } catch {
      status("このページでは画像コピーできません。PNG保存を使ってください。");
    }
  };
  chrome.storage.local
    .get(key)
    .then((result) => {
      if (result[key] && !draftTouched) {
        const saved = result[key] as SavedDraft;
        session = {
          url: location.href,
          title: document.title,
          items: saved.items || [],
          hasImage: !!saved.imageData,
          imageNote: saved.imageNote || "",
        };
        imageData = saved.imageData || null;
        imageMode = saved.imageMode === "full" ? "full" : "visible";
        savedStrokes = saved.strokes || [];
        renderItems();
        refresh();
        status("このページの下書きを復元しました。");
      }
    })
    .catch(() => status("下書きを読み込めませんでした。"));
  refresh();
  showPanel();
})();
