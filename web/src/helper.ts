// The helper worker: it checks a project, tests a candidate or draws a random one, and
// answers once. The page ends it after the answer, or when it takes too long.

import { handleHelp, type HelpRequest } from "./protocol.ts";

self.onmessage = (event: MessageEvent<HelpRequest>) => self.postMessage(handleHelp(event.data));
