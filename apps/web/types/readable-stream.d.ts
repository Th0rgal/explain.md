interface ReadableStream<R = unknown> {
  [Symbol.asyncIterator](): AsyncIterableIterator<R>;
}
