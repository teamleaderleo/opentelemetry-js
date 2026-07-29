/*
 * Copyright The OpenTelemetry Authors
 * SPDX-License-Identifier: Apache-2.0
 */

import * as assert from 'assert';
import type { SpanProcessor } from '../../src';
import { TracerProvider } from '../../src';

describe('TracerProvider shutdown characterization', () => {
  it('delegates repeated shutdown calls to the active processor', async () => {
    let shutdownCalls = 0;
    const processor: SpanProcessor = {
      onStart() {},
      onEnd() {},
      forceFlush: () => Promise.resolve(),
      shutdown: () => {
        shutdownCalls += 1;
        return Promise.resolve();
      },
    };
    const provider = new TracerProvider({ spanProcessors: [processor] });

    await provider.shutdown();
    await provider.shutdown();

    assert.strictEqual(shutdownCalls, 2);
  });

  it('continues creating recording spans from cached and new tracers after shutdown', async () => {
    let startCalls = 0;
    let endCalls = 0;
    const processor: SpanProcessor = {
      onStart() {
        startCalls += 1;
      },
      onEnd() {
        endCalls += 1;
      },
      forceFlush: () => Promise.resolve(),
      shutdown: () => Promise.resolve(),
    };
    const provider = new TracerProvider({ spanProcessors: [processor] });
    const cachedTracer = provider.getTracer('cached-before-shutdown');

    await provider.shutdown();

    const cachedSpan = cachedTracer.startSpan('cached-after-shutdown');
    assert.strictEqual(cachedSpan.isRecording(), true);
    cachedSpan.end();

    const newTracer = provider.getTracer('new-after-shutdown');
    const newSpan = newTracer.startSpan('new-after-shutdown');
    assert.strictEqual(newSpan.isRecording(), true);
    newSpan.end();

    assert.strictEqual(startCalls, 2);
    assert.strictEqual(endCalls, 2);
  });
});
