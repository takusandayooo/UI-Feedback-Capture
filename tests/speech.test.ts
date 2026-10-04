import { expect, test } from "bun:test";
import { createVoiceInput } from "../src/speech";
import type { Recognition, RecognitionResult, TextInput } from "../src/types";

test("音声の暫定結果と確定結果を分け、重複と終了後の結果を除外する", () => {
  class FakeRecognition implements Recognition {
    static instance: FakeRecognition;
    lang = "";
    continuous = false;
    interimResults = false;
    maxAlternatives = 0;
    onstart: Recognition["onstart"] = null;
    onresult: Recognition["onresult"] = null;
    onerror: Recognition["onerror"] = null;
    onend: Recognition["onend"] = null;
    constructor() {
      FakeRecognition.instance = this;
    }
    start() {
      this.onstart?.();
    }
    stop() {
      this.onend?.();
    }
    abort() {
      this.onend?.();
    }
  }
  const target = { value: "" } as TextInput;
  const appended: string[] = [],
    interim: string[] = [];
  const voice = createVoiceInput(FakeRecognition, {
    state() {},
    interim(text) {
      interim.push(text);
    },
    append(_target, text) {
      appended.push(text);
    },
    error() {},
  });
  expect(voice.start(target)).toBe(true);
  const recognition = FakeRecognition.instance;
  expect(recognition.lang).toBe("ja-JP");
  const result = (text: string, isFinal: boolean): RecognitionResult => ({
    0: { transcript: text },
    isFinal,
  });
  recognition.onresult?.({ results: [result("余白を", false)] });
  expect(appended).toEqual([]);
  recognition.onresult?.({ results: [result("余白を半分に", true)] });
  recognition.onresult?.({ results: [result("余白を半分に", true)] });
  expect(appended).toEqual(["余白を半分に"]);
  expect(interim).toContain("余白を");
  voice.cancel();
  recognition.onresult?.({
    results: [result("終了後の結果", true), result("追加", true)],
  });
  expect(appended).toEqual(["余白を半分に"]);
  expect(voice.activeTarget).toBeNull();
});
