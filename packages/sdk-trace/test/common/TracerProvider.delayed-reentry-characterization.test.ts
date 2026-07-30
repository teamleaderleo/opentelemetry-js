/*
 * Copyright The OpenTelemetry Authors
 * SPDX-License-Identifier: Apache-2.0
 */

import * as assert from 'assert';
import type { SpanProcessor } from '../../src';
import { TracerProvider } from '../../src';

type Settlement = 'fulfilled' | 'rejected' | 'timeout';

async function settlementWithin(
  promise: Promise<unknown>,
  timeoutMillis = 25
): Promise<Settlement> {
  return Promise.race([
    promise.then(
      () => 'fulfilled' as const,
      () => 'rejected' as const
    ),
    new Promise<'timeout'>(resolve => {
      setTimeout(() => resolve('timeout'), timeoutMillis);
    }),
  ]);
}

function processor(
  shutdown: () => Promise<void>,
  forceFlush: () => Promise<void> = () => Promise.resolve()
): SpanProcessor {
  return {
    onStart() {},
    onEnd() {},
    shutdown,
    forceFlush,
  };
}

describe('TracerProvider delayed lifecycle reentry characterization', () => {
  it('records delayed same-provider shutdown reentry as a pending self-dependency', async () => {
    let provider: TracerProvider;
    provider = new TracerProvider({
      spanProcessors: [
        processor(async () => {
          await Promise.resolve();
          return provider.shutdown();
        }),
      ],
    });

    const shutdown = provider.shutdown();

    assert.strictEqual(await settlementWithin(shutdown), 'timeout');
  });

  it('records delayed force flush during shutdown as a pending self-dependency', async () => {
    let provider: TracerProvider;
    provider = new TracerProvider({
      spanProcessors: [
        processor(async () => {
          await Promise.resolve();
          return provider.forceFlush();
        }),
      ],
    });

    const shutdown = provider.shutdown();

    assert.strictEqual(await settlementWithin(shutdown), 'timeout');
  });

  it('preserves a legitimate unrelated concurrent shutdown joiner', async () => {
    let releaseShutdown: () => void = () => {};
    const childShutdown = new Promise<void>(resolve => {
      releaseShutdown = resolve;
    });
    const provider = new TracerProvider({
      spanProcessors: [processor(() => childShutdown)],
    });

    const owner = provider.shutdown();
    await Promise.resolve();
    const joiner = provider.shutdown();

    assert.strictEqual(joiner, owner);
    releaseShutdown();
    assert.strictEqual(await settlementWithin(owner), 'fulfilled');
    assert.strictEqual(await settlementWithin(joiner), 'fulfilled');
  });

  it('shows that an unrelated joiner shares the same pending self-cycle', async () => {
    let provider: TracerProvider;
    provider = new TracerProvider({
      spanProcessors: [
        processor(async () => {
          await Promise.resolve();
          return provider.shutdown();
        }),
      ],
    });

    const owner = provider.shutdown();
    await Promise.resolve();
    const joiner = provider.shutdown();

    assert.strictEqual(joiner, owner);
    assert.strictEqual(await settlementWithin(owner), 'timeout');
    assert.strictEqual(await settlementWithin(joiner), 'timeout');
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

    assert.strictEqual(await settlementWithin(owner.shutdown()), 'fulfilled');
  });
});
