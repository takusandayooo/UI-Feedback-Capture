import type {
  Recognition,
  RecognitionConstructor,
  TextInput,
  VoiceHandlers,
  VoiceRun,
} from "./types";
export function createVoiceInput(
  Recognition: RecognitionConstructor | undefined,
  handlers: VoiceHandlers,
) {
  let active: VoiceRun | null = null;
  function finish(run: VoiceRun) {
    if (active !== run) return;
    active = null;
    handlers.state(null);
    handlers.interim("");
  }
  return {
    get activeTarget() {
      return active?.target || null;
    },
    start(target: TextInput) {
      if (active || !Recognition) return false;
      let recognition: Recognition;
      try {
        recognition = new Recognition();
      } catch {
        handlers.error(
          "音声入力を開始できません。Chromeでページを開いてください。",
        );
        return false;
      }
      const run = { recognition, target, finalIndices: new Set<number>() };
      active = run;
      recognition.lang = "ja-JP";
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.maxAlternatives = 1;
      recognition.onstart = () => {
        if (active === run) handlers.state(target, "listening");
      };
      recognition.onresult = (event) => {
        if (active !== run) return;
        let pending = "";
        for (let i = 0; i < event.results.length; i++) {
          const result = event.results[i];
          const text = result[0]?.transcript || "";
          if (result.isFinal) {
            if (!run.finalIndices.has(i)) {
              run.finalIndices.add(i);
              if (text.trim()) handlers.append(target, text.trim());
            }
          } else pending += text;
        }
        handlers.interim(pending);
      };
      recognition.onerror = (event) => {
        if (active !== run) return;
        const messages: Record<string, string> = {
          "not-allowed":
            "マイクの使用が許可されていません。Chromeのサイト設定とOSのマイク設定を確認してください。",
          "service-not-allowed":
            "このページでは音声認識が許可されていません。Chromeの通常のWebページで再試行してください。",
          "audio-capture":
            "マイクを利用できません。接続とOSのマイク設定を確認してください。",
          "no-speech":
            "音声を聞き取れませんでした。音声入力を押してもう一度話してください。",
          network:
            "音声認識サービスに接続できません。ネット接続を確認してください。",
          "language-not-supported": "日本語の音声認識を利用できません。",
          aborted: "音声入力を停止しました。",
        };
        finish(run);
        handlers.error(
          messages[event.error] ||
            "音声認識に失敗しました。もう一度試してください。",
        );
        try {
          recognition.abort();
        } catch {}
      };
      recognition.onend = () => finish(run);
      handlers.state(target, "starting");
      try {
        recognition.start();
        return true;
      } catch {
        finish(run);
        handlers.error(
          "音声入力を開始できません。HTTPSまたはlocalhostのページで、マイクの許可を確認してください。",
        );
        return false;
      }
    },
    stop() {
      if (!active) return;
      const run = active;
      handlers.state(run.target, "stopping");
      try {
        run.recognition.stop();
      } catch {
        finish(run);
      }
    },
    cancel() {
      if (!active) return;
      const run = active;
      finish(run);
      try {
        run.recognition.abort();
      } catch {}
    },
  };
}
