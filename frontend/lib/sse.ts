export type SSEEvent = {
  event: string;
  data: string;
};

export async function* streamSSE(
  res: Response,
): AsyncGenerator<SSEEvent, void, void> {
  if (!res.ok || !res.body) {
    throw new Error(`stream failed: ${res.status}`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) {
      if (buffer.trim().length > 0) {
        const frame = parseFrame(buffer);
        if (frame) yield frame;
      }
      break;
    }
    buffer += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buffer.indexOf("\n\n")) !== -1) {
      const frame = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      const event = parseFrame(frame);
      if (event) yield event;
    }
  }
}

function parseFrame(frame: string): SSEEvent | null {
  const lines = frame.split("\n");
  let eventName = "message";
  let data = "";
  for (const line of lines) {
    if (line.startsWith("event:")) {
      eventName = line.slice(6).trim();
    } else if (line.startsWith("data:")) {
      data += line.slice(5).trimStart();
    }
  }
  if (!data) return null;
  return { event: eventName, data };
}
