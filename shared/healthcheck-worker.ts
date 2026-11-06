/// <reference lib="webworker" />

import { sendHealthCheckRequest } from "./healthcheck.ts";

const checksInProgress = new Set<string>();

self.onmessage = (event: MessageEvent<string[]>) => {
    for (const peerOrigin of event.data) {
        if (checksInProgress.has(peerOrigin)) continue;
        checksInProgress.add(peerOrigin);

        void sendHealthCheckRequest(peerOrigin)
            .then((healthy) => {
                self.postMessage({ peerOrigin, healthy });
            })
            .finally(() => checksInProgress.delete(peerOrigin));
    }
};
