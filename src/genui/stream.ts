import { pipeJsonRender } from "@json-render/core";
import { validateSpecStream } from "./validation";

type Chunk = { type: string };
type TextDelta = { type: "text-delta"; id: string; delta: string };

/** Internal marker for the end of one upstream chunk; never leaves this module. */
const BOUNDARY = "x-genui-boundary";

/**
 * Turns `\`\`\`spec` fences in the model's text into validated `data-spec`
 * patch parts (json-render inline mode), keeping everything else intact.
 */
export function withGenerativeUI<T extends Chunk>(stream: ReadableStream<T>): ReadableStream<T> {
  return pipeJsonRender(stream.pipeThrough(markBoundaries()) as never)
    .pipeThrough(coalesceTextDeltas())
    .pipeThrough(validateSpecStream()) as unknown as ReadableStream<T>;
}

function markBoundaries<T extends Chunk>(): TransformStream<T, T> {
  return new TransformStream<T, T>({
    transform(chunk, controller) {
      controller.enqueue(chunk);
      if (chunk.type === "text-delta") controller.enqueue({ type: BOUNDARY } as T);
    },
  });
}

/**
 * json-render's transform re-emits text one character per chunk. This merges
 * the characters that came from one upstream delta (one model token) back
 * into a single delta, so the stream stays progressive without a chunk per
 * character.
 */
export function coalesceTextDeltas<T extends Chunk>(): TransformStream<T, T> {
  let pending: TextDelta | null = null;
  const release = (controller: TransformStreamDefaultController<T>) => {
    if (pending) controller.enqueue(pending as unknown as T);
    pending = null;
  };
  return new TransformStream<T, T>({
    transform(chunk, controller) {
      if (chunk.type === BOUNDARY) {
        release(controller);
        return;
      }
      if (chunk.type === "text-delta") {
        const delta = chunk as unknown as TextDelta;
        if (pending && pending.id === delta.id) {
          pending = { ...pending, delta: pending.delta + delta.delta };
        } else {
          release(controller);
          pending = { ...delta };
        }
        return;
      }
      release(controller);
      controller.enqueue(chunk);
    },
    flush(controller) {
      release(controller);
    },
  });
}
