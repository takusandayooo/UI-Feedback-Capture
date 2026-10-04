import type { IMEBinding, TextInput } from "./types";
export function bindIMEInput(
  input: TextInput,
  commit: (value: string) => void,
): IMEBinding {
  let composing = false;
  let lastValue = input.value;
  function update() {
    if (composing || lastValue === input.value) return;
    lastValue = input.value;
    commit(input.value);
  }
  input.addEventListener("compositionstart", () => {
    composing = true;
  });
  input.addEventListener("compositionend", () => {
    composing = false;
    queueMicrotask(update);
  });
  input.addEventListener("input", (event) => {
    if (!(event as InputEvent).isComposing && !composing) update();
  });
  return {
    get composing() {
      return composing;
    },
    flush: update,
    setValue(value) {
      if (composing) return false;
      input.value = value;
      lastValue = value;
      return true;
    },
  };
}
