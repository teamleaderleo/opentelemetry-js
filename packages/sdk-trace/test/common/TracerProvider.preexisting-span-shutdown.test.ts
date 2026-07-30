/*
 * Copyright The OpenTelemetry Authors
 * SPDX-License-Identifier: Apache-2.0
 */

import * as assert from 'assert';
import type { SpanProcessor } from '../../src';
import { TracerProvider } from '../../src';

describe('TracerProvider pre-existing span shutdown boundary', () => {
  it('still invokes onEnd while processor shutdown is pending', async () => {
    let startCalls = 0;
    let endCalls = 0;
    let shutdownCalls = 0;
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
      shutdown: () => {
        shutdownCalls += 1;
        return pendingShutdown;
      },
    };
    const provider = new TracerProvider({ spanProcessors: [processor] });
    const span = provider.getTracer('pre-existing').startSpan('pending');

    const shutdown = provider.shutdown();
    span.end();

    assert.strictEqual(startCalls, 1);
    assert.strictEqual(endCalls, 1);
    assert.strictEqual(shutdownCalls, 1);

    resolveShutdown();
    await shutdown;
  });

  it('invokes a healthy processor before shutdown, then calls it again after shutdown', async () => {
    const error = new Error('onEnd called after processor shutdown');
    let processorShutdown = false;
    let endCalls = 0;
    const processor: SpanProcessor = {
      onStart() {},
      onEnd() {
        endCalls += 1;
        if (processorShutdown) {
          throw error;
        }
      },
      forceFlush: () => Promise.resolve(),
      shutdown: () => {
        processorShutdown = true;
        return Promise.resolve();
      },
    };
    const provider = new TracerProvider({ spanProcessors: [processor] });
    const tracer = provider.getTracer('pre-existing');
    const healthySpan = tracer.startSpan('before');
    const lateSpan = tracer.startSpan('after');

    assert.doesNotThrow(() => healthySpan.end());
    assert.strictEqual(endCalls, 1);

    await provider.shutdown();

    assert.throws(
      () => lateSpan.end(),
      candidate => candidate === error
    );
    assert.strictEqual(endCalls, 2);
    assert.strictEqual(lateSpan.isRecording(), false);
  });
});
