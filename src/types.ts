export interface Point {
  x: number;
  y: number;
}
export interface Bounds extends Point {
  width: number;
  height: number;
}
export interface FeedbackElement {
  tag: string;
  selector: string;
  path: string;
  text: string;
  html: string;
  exportHtml?: string;
  styles: Record<string, string>;
  bounds: Bounds;
  viewport: { width: number; height: number; scrollX: number; scrollY: number };
  instruction: string;
}
export interface FeedbackSession {
  url: string;
  title: string;
  items: FeedbackElement[];
  hasImage: boolean;
  imageNote: string;
}
export type CaptureMode = "visible" | "full";
export type DrawingTool = "pen" | "rect" | "arrow";
export interface Stroke {
  tool: DrawingTool;
  color: string;
  width: number;
  points: Point[];
}
export interface SavedDraft extends FeedbackSession {
  imageData: string | null;
  imageMode: CaptureMode;
  strokes: Stroke[];
}
export type TextInput = HTMLInputElement | HTMLTextAreaElement;
export interface IMEBinding {
  readonly composing: boolean;
  flush(): void;
  setValue(value: string): boolean;
}
export interface RecognitionResult {
  isFinal: boolean;
  [index: number]: { transcript: string };
}
export interface Recognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onstart: (() => void) | null;
  onresult: ((event: { results: ArrayLike<RecognitionResult> }) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
export type RecognitionConstructor = new () => Recognition;
export interface VoiceHandlers {
  state(
    target: TextInput | null,
    phase?: "starting" | "listening" | "stopping",
  ): void;
  interim(text: string): void;
  append(input: TextInput, text: string): void;
  error(message: string): void;
}
export interface VoiceRun {
  recognition: Recognition;
  target: TextInput;
  finalIndices: Set<number>;
}
export interface CaptureOptions {
  host: HTMLElement;
  mode: CaptureMode;
  cancelled?: () => boolean;
  progress?: (done: number, total: number) => void;
}
export interface CaptureResponse {
  data?: string;
  error?: string;
}
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
