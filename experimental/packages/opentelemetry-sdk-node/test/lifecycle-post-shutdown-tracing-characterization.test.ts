/*
 * Copyright The OpenTelemetry Authors
 * SPDX-License-Identifier: Apache-2.0
 */

import { context, metrics, propagation, trace } from '@opentelemetry/api';
import { logs } from '@opentelemetry/api-logs';
import type { SpanProcessor } from '@opentelemetry/sdk-trace';
import * as assert from 'assert';
import { NodeSDK } from '../src';

describe('NodeSDK post-shutdown tracing characterization', () => {
  beforeEach(() => {
    context.disable();
    trace.disable();
    propagation.disable();
    metrics.disable();
    logs.disable();

    process.env.OTEL_TRACES_EXPORTER = 'none';
    process.env.OTEL_LOGS_EXPORTER = 'none';
    process.env.OTEL_METRICS_EXPORTER = 'none';
  });

  afterEach(() => {
    context.disable();
    trace.disable();
    propagation.disable();
    metrics.disable();
    logs.disable();

    delete process.env.OTEL_TRACES_EXPORTER;
    delete process.env.OTEL_LOGS_EXPORTER;
    delete process.env.OTEL_METRICS_EXPORTER;
  });

  it('continues sending spans to a custom processor after shutdown', async () => {
    let starts = 0;
    let ends = 0;
    let shutdownCalls = 0;
    const spanProcessor: SpanProcessor = {
      onStart() {
        starts += 1;
      },
      onEnd() {
        ends += 1;
      },
      forceFlush: () => Promise.resolve(),
      shutdown: () => {
        shutdownCalls += 1;
        return Promise.resolve();
      },
    };
    const sdk = new NodeSDK({
      autoDetectResources: false,
      spanProcessors: [spanProcessor],
      textMapPropagator: null,
    });

    sdk.start();
    trace.getTracer('fieldwork').startSpan('before-shutdown').end();

    assert.strictEqual(starts, 1);
    assert.strictEqual(ends, 1);

    await sdk.shutdown();

    assert.strictEqual(shutdownCalls, 1);

    trace.getTracer('fieldwork').startSpan('after-shutdown').end();

    assert.strictEqual(starts, 2);
    assert.strictEqual(ends, 2);
  });
});
