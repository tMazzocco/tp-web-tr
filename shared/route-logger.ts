import type { Request, Response } from "express";

type Handler = (request: Request, response: Response) => unknown;

export function logger(label?: string) {
    return function <T extends Handler>(target: T, ctx: ClassMethodDecoratorContext) {
        const name = label ?? String(ctx.name);
        return async function (this: unknown, request: Request, response: Response) {
            const timestamp = new Date().toTimeString().slice(0, 8);
            const perf = performance.now();
            console.info(`[${timestamp}] -> ${name} ${request.method} ${request.originalUrl} origin=${request.get('Origin') ?? '-'}`, request.body);
            response.on('finish', () =>
                console.log(`[${timestamp}] ← ${name} ${response.statusCode} ${(performance.now() - perf).toFixed(1)}ms`));
            try {
                return await target.call(this, request, response);
            } catch (e) {
                console.error(`[${timestamp}] ✗ ${name}`, e);
                // Forward error
                throw e;
            }
        } as T;
    };
}