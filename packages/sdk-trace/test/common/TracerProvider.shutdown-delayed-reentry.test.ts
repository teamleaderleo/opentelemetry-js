/*
 * Copyright The OpenTelemetry Authors
 * SPDX-License-Identifier: Apache-2.0
 */

import * as assert from 'assert';
import type { SpanProcessor } from '../../src';
import { TracerProvider } from '../../src';

const nextTurn = () => new Promise<void>(resolve => setTimeout(resolve, 0));

async function settlesWithin(
  promise: Promise<unknown>,
  timeoutMillis = 20
): Promise<boolean> {
  return Promise.race([
    promise.then(
      () => true,
      () => true
    ),
    new Promise<boolean>(resolve =>
      setTimeout(() => resolve(false), timeoutMillis)
    ),
  ]);
}

function processor(shutdown: () => Promise<void>): SpanProcessor {
  return {
    onStart() {},
    onEnd() {},
    forceFlush: () => Promise.resolve(),
    shutdown,
  };
}

describe('TracerProvider delayed shutdown reentry', () => {
  it('records a delayed processor shutdown self-dependency while an external caller joins', async () => {
    let nestedShutdown: Promise<void> | undefined;
    let shutdownCalls = 0;
    const spanProcessor = processor(async () => {
      shutdownCalls += 1;
      await Promise.resolve();
      nestedShutdown = provider.shutdown();
      return nestedShutdown;
    });
    const provider = new TracerProvider({ spanProcessors: [spanProcessor] });

    const outerShutdown = provider.shutdown();
    await nextTurn();
    const externalShutdown = provider.shutdown();

    assert.ok(nestedShutdown);
    assert.strictEqual(nestedShutdown, outerShutdown);
    assert.strictEqual(externalShutdown, outerShutdown);
    assert.strictEqual(await settlesWithin(outerShutdown), false);
    assert.strictEqual(shutdownCalls, 1);
  });

  it('records delayed forceFlush reentry using the same pending shutdown result', async () => {
    let nestedForceFlush: Promise<void> | undefined;
    let processorForceFlushCalls = 0;
    const spanProcessor: SpanProcessor = {
      onStart() {},
      onEnd() {},
      forceFlush: () => {
        processorForceFlushCalls += 1;
        return Promise.resolve();
      },
      shutdown: async () => {
        await Promise.resolve();
        nestedForceFlush = provider.forceFlush();
        return nestedForceFlush;
      },
    };
    const provider = new TracerProvider({ spanProcessors: [spanProcessor] });

    const outerShutdown = provider.shutdown();
    await nextTurn();

    assert.ok(nestedForceFlush);
    assert.strictEqual(nestedForceFlush, outerShutdown);
    assert.strictEqual(await settlesWithin(outerShutdown), false);
    assert.strictEqual(processorForceFlushCalls, 0);
  });

  it('allows delayed cross-provider shutdown nesting to complete', async () => {
    const nested = new TracerProvider({
      spanProcessors: [processor(() => Promise.resolve())],
    });
    const owner = new TracerProvider({
      spanProcessors: [
        processor(async () => {
          await Promise.resolve();
          return nested.shutdown();
        }),
      ],
    });

    assert.strictEqual(await settlesWithin(owner.shutdown()), true);
  });
});
