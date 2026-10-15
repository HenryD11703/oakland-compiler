import { run } from "../core/run";
import { numericSeries } from "../core/trace/series";
import type { WorkerRequest, WorkerResponse } from "./protocol";

/** Answers a request. Pure, so it is tested without a worker; the worker file only wires it to messages. */
export function handleRequest(request: WorkerRequest): WorkerResponse {
  const result = run(request.source);
  const series = result.trace ? numericSeries(result.trace) : [];
  return { type: "result", id: request.id, outcome: { result, series } };
}
