/*
 * Copyright The OpenTelemetry Authors
 * SPDX-License-Identifier: Apache-2.0
 */

import * as assert from 'assert';
import type { SpanProcessor } from '../../src';
import { TracerProvider } from '../../src';

describe('TracerProvider shutdown with pre-existing spans', () => {
  it('continues delivering onEnd while processor shutdown is pending', async () => {
    let resolveShutdown: () => void = () => {};
    const pendingShutdown = new Promise<void>(resolve => {
      resolveShutdown = resolve;
    });
    const events: string[] = [];
    const processor: SpanProcessor = {
      onStart() {
        events.push('span-start');
      },
      onEnd() {
        events.push('span-end');
      },
      forceFlush: () => Promise.resolve(),
      shutdown: () => {
        events.push('shutdown-start');
        return pendingShutdown.then(() => {
          events.push('shutdown-settle');
        });
      },
    };
    const provider = new TracerProvider({ spanProcessors: [processor] });
    const span = provider.getTracer('pre-existing').startSpan('pending-end');

    const shutdown = provider.shutdown();
    span.end();

    assert.deepStrictEqual(events, [
      'span-start',
      'shutdown-start',
      'span-end',
    ]);

    resolveShutdown();
    await shutdown;
    assert.deepStrictEqual(events, [
      'span-start',
      'shutdown-start',
      'span-end',
      'shutdown-settle',
    ]);
  });

  it('continues delivering onEnd after processor shutdown has settled', async () => {
    const events: string[] = [];
    const processor: SpanProcessor = {
      onStart() {
        events.push('span-start');
      },
      onEnd() {
        events.push('span-end');
      },
      forceFlush: () => Promise.resolve(),
      shutdown: () => {
        events.push('shutdown');
        return Promise.resolve();
      },
    };
    const provider = new TracerProvider({ spanProcessors: [processor] });
    const span = provider.getTracer('pre-existing').startSpan('late-end');

    await provider.shutdown();
    span.end();

    assert.deepStrictEqual(events, ['span-start', 'shutdown', 'span-end']);
  });

  it('delivers onEnd before shutdown when the span ends first', async () => {
    const events: string[] = [];
    const processor: SpanProcessor = {
      onStart() {
        events.push('span-start');
      },
      onEnd() {
        events.push('span-end');
      },
      forceFlush: () => Promise.resolve(),
      shutdown: () => {
        events.push('shutdown');
        return Promise.resolve();
      },
    };
    const provider = new TracerProvider({ spanProcessors: [processor] });
    const span = provider.getTracer('pre-existing').startSpan('normal-end');

    span.end();
    await provider.shutdown();

    assert.deepStrictEqual(events, ['span-start', 'span-end', 'shutdown']);
  });
});
