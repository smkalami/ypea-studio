// The run worker: one run per worker. The page cancels a run by terminating it.

import { handleRun, type RunRequest } from "./protocol.ts";

self.onmessage = (event: MessageEvent<RunRequest>) => handleRun(event.data, (message) => self.postMessage(message));
