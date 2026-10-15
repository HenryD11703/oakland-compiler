import { handleRequest } from "./handler";
import type { WorkerRequest } from "./protocol";

// The DOM and worker type libraries disagree about `self`; this is the worker's own scope.
const scope = self as unknown as {
  onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null;
  postMessage(message: unknown): void;
};

scope.onmessage = (event) => {
  scope.postMessage(handleRequest(event.data));
};
