/*
 * Copyright The OpenTelemetry Authors
 * SPDX-License-Identifier: Apache-2.0
 */

import * as assert from 'assert';
import type { SpanProcessor } from '../../src';
import { TracerProvider } from '../../src';

describe('TracerProvider shutdown state', () => {
  it('shares one shutdown operation and result across concurrent callers', async () => {
    let shutdownCalls = 0;
    let resolveShutdown: () => void = () => {};
    const pendingShutdown = new Promise<void>(resolve => {
      resolveShutdown = resolve;
    });
    const processor: SpanProcessor = {
      onStart() {},
      onEnd() {},
      forceFlush: () => Promise.resolve(),
      shutdown: () => {
        shutdownCalls += 1;
        return pendingShutdown;
      },
    };
    const provider = new TracerProvider({ spanProcessors: [processor] });

    const first = provider.shutdown();
    const second = provider.shutdown();

    assert.strictEqual(first, second);
    assert.strictEqual(shutdownCalls, 1);

    resolveShutdown();
    await Promise.all([first, second]);
    assert.strictEqual(shutdownCalls, 1);
  });

  it('converts a synchronous processor throw into one shared rejection', async () => {
    const error = new Error('fieldwork trace shutdown failure');
    let shutdownCalls = 0;
    const processor: SpanProcessor = {
      onStart() {},
      onEnd() {},
      forceFlush: () => Promise.resolve(),
      shutdown: () => {
        shutdownCalls += 1;
        throw error;
      },
    };
    const provider = new TracerProvider({ spanProcessors: [processor] });

    const first = provider.shutdown();
    const second = provider.shutdown();

    assert.strictEqual(first, second);
    await assert.rejects(first, candidate => candidate === error);
    await assert.rejects(second, candidate => candidate === error);
    assert.strictEqual(shutdownCalls, 1);
  });

  it('makes cached and new tracers non-recording as soon as shutdown begins', async () => {
    let startCalls = 0;
    let endCalls = 0;
    let resolveShutdown: () => void = () => {};
    const pendingShutdown = new Promise<void>(resolve => {
      resolveShutdown = resolve;
    });
    const processor: SpanProcessor = {
      onStart() {
        startCalls += 1;
      },
      onEnd() {
        endCalls += 1;
      },
      forceFlush: () => Promise.resolve(),
      shutdown: () => pendingShutdown,
    };
    const provider = new TracerProvider({ spanProcessors: [processor] });
    const cachedTracer = provider.getTracer('cached-before-shutdown');

    const shutdown = provider.shutdown();

    const cachedSpan = cachedTracer.startSpan('cached-during-shutdown');
    const newSpan = provider
      .getTracer('requested-during-shutdown')
      .startSpan('new-during-shutdown');

    assert.strictEqual(cachedSpan.isRecording(), false);
    assert.strictEqual(newSpan.isRecording(), false);
    cachedSpan.end();
    newSpan.end();
    assert.strictEqual(startCalls, 0);
    assert.strictEqual(endCalls, 0);

    resolveShutdown();
    await shutdown;

    const afterSpan = provider
      .getTracer('requested-after-shutdown')
      .startSpan('new-after-shutdown');
    assert.strictEqual(afterSpan.isRecording(), false);
    afterSpan.end();
    assert.strictEqual(startCalls, 0);
    assert.strictEqual(endCalls, 0);
  });

  it('returns the shutdown result instead of force flushing after shutdown begins', async () => {
    let forceFlushCalls = 0;
    let resolveShutdown: () => void = () => {};
    const pendingShutdown = new Promise<void>(resolve => {
      resolveShutdown = resolve;
    });
    const processor: SpanProcessor = {
      onStart() {},
      onEnd() {},
      forceFlush: () => {
        forceFlushCalls += 1;
        return Promise.resolve();
      },
      shutdown: () => pendingShutdown,
    };
    const provider = new TracerProvider({ spanProcessors: [processor] });

    const shutdown = provider.shutdown();
    const forceFlush = provider.forceFlush();

    assert.strictEqual(forceFlush, shutdown);
    assert.strictEqual(forceFlushCalls, 0);

    resolveShutdown();
    await forceFlush;
  });
});
