/*
 * Copyright The OpenTelemetry Authors
 * SPDX-License-Identifier: Apache-2.0
 */

import * as assert from 'assert';
import { createNoopMeter } from '@opentelemetry/api';
import type { SpanProcessor } from '../../src';
import { TracerProvider } from '../../src';

describe('TracerProvider shutdown state', () => {
  it('shares one shutdown operation and result across concurrent and later callers', async () => {
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

    const third = provider.shutdown();
    assert.strictEqual(third, first);
    await third;
    assert.strictEqual(shutdownCalls, 1);
  });

  it('keeps admission closed and shares one rejection after a synchronous processor throw', async () => {
    const error = new Error('fieldwork trace shutdown failure');
    let shutdownCalls = 0;
    let forceFlushCalls = 0;
    let getMeterCalls = 0;
    const processor: SpanProcessor = {
      onStart() {},
      onEnd() {},
      forceFlush: () => {
        forceFlushCalls += 1;
        return Promise.resolve();
      },
      shutdown: () => {
        shutdownCalls += 1;
        throw error;
      },
    };
    const provider = new TracerProvider({
      spanProcessors: [processor],
      meterProvider: {
        getMeter() {
          getMeterCalls += 1;
          return createNoopMeter();
        },
      },
    });
    const cachedTracer = provider.getTracer('cached-before-failed-shutdown');

    const first = provider.shutdown();
    const second = provider.shutdown();
    const forceFlush = provider.forceFlush();

    assert.strictEqual(first, second);
    assert.strictEqual(forceFlush, first);
    await assert.rejects(first, candidate => candidate === error);
    await assert.rejects(second, candidate => candidate === error);
    await assert.rejects(forceFlush, candidate => candidate === error);

    const cachedSpan = cachedTracer.startSpan('cached-after-failed-shutdown');
    const newSpan = provider
      .getTracer('requested-after-failed-shutdown')
      .startSpan('new-after-failed-shutdown');

    assert.strictEqual(cachedSpan.isRecording(), false);
    assert.strictEqual(newSpan.isRecording(), false);
    cachedSpan.end();
    newSpan.end();
    assert.strictEqual(shutdownCalls, 1);
    assert.strictEqual(forceFlushCalls, 0);
    assert.strictEqual(getMeterCalls, 1);
  });

  it('does not deadlock when a processor returns recursive provider shutdown', async () => {
    let shutdownCalls = 0;
    let recursiveShutdown: Promise<void> | undefined;
    const processor: SpanProcessor = {
      onStart() {},
      onEnd() {},
      forceFlush: () => Promise.resolve(),
      shutdown: () => {
        shutdownCalls += 1;
        recursiveShutdown = provider.shutdown();
        return recursiveShutdown;
      },
    };
    const provider = new TracerProvider({ spanProcessors: [processor] });

    await provider.shutdown();
    await recursiveShutdown;

    assert.strictEqual(shutdownCalls, 1);
  });

  it('does not deadlock when a processor force flushes the provider during shutdown', async () => {
    let processorForceFlushCalls = 0;
    let recursiveForceFlush: Promise<void> | undefined;
    const processor: SpanProcessor = {
      onStart() {},
      onEnd() {},
      forceFlush: () => {
        processorForceFlushCalls += 1;
        return Promise.resolve();
      },
      shutdown: () => {
        recursiveForceFlush = provider.forceFlush();
        return recursiveForceFlush;
      },
    };
    const provider = new TracerProvider({ spanProcessors: [processor] });

    await provider.shutdown();
    await recursiveForceFlush;

    assert.strictEqual(processorForceFlushCalls, 0);
  });

  it('does not consult the configured meter provider for a tracer requested after shutdown', async () => {
    let getMeterCalls = 0;
    const provider = new TracerProvider({
      meterProvider: {
        getMeter() {
          getMeterCalls += 1;
          return createNoopMeter();
        },
      },
    });

    await provider.shutdown();
    const tracer = provider.getTracer('requested-after-shutdown');
    const span = tracer.startSpan('non-recording-after-shutdown');

    assert.strictEqual(getMeterCalls, 0);
    assert.strictEqual(span.isRecording(), false);
    span.end();
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
