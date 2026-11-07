import { setTimeout as sleep } from 'node:timers/promises';
import { HSState, type HSStorage } from './hs-storage.ts';
import { sendHealthCheckRequest } from './healthcheck.ts';
import type { Broker } from './broker';
import { HsService } from './handshake.ts';

export function backgroundLoop(loopId: string, interval: number, job: () => Promise<void>, ct?: AbortSignal): void {
    (async () => {
        while (!ct?.aborted) {
            try {
                await job();
            } catch (error) {
                console.error(`[${loopId}] tick failed:`, error instanceof Error ? error.message : error);
            }
            await sleep(interval);
        }
    })();
}

export function startHealthCheckLoop(hsService: HsService, interval = 20_000, ct?: AbortSignal): void {
    backgroundLoop(
        'Hearth Beat',
        interval,
        async () => {
        const peers = hsService.hsStorage.getConnections()
            .filter(c => c.getState() === HSState.ACK)
            .map(c => c.toUrl());

        const results = await Promise.allSettled(peers.map(p => sendHealthCheckRequest(p)));
        results.forEach((r, i) => {
            if (r.status === 'fulfilled' && !r.value) hsService.hsStorage.closeHandshake(peers[i]!);
        });
    }, ct);
}

export function startBrokerPileWorkerLoop(b: Broker, interval = 1_000, ct?: AbortSignal): void {
    backgroundLoop(
        'PileWorker',
        interval,
        async () => {
            await b.pileWorker.unPile();
        },
        ct
    )
}
