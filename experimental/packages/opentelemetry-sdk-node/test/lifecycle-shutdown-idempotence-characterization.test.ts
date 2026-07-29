/*
 * Copyright The OpenTelemetry Authors
 * SPDX-License-Identifier: Apache-2.0
 */

import { context, metrics, propagation, trace } from '@opentelemetry/api';
import { logs } from '@opentelemetry/api-logs';
import type { SpanProcessor } from '@opentelemetry/sdk-trace';
import * as assert from 'assert';
import { NodeSDK } from '../src';

describe('NodeSDK shutdown idempotence characterization', () => {
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

  it('calls a custom span processor shutdown for every SDK shutdown call', async () => {
    let shutdownCalls = 0;
    const spanProcessor: SpanProcessor = {
      onStart() {},
      onEnd() {},
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
    await sdk.shutdown();
    await sdk.shutdown();

    assert.strictEqual(shutdownCalls, 2);
  });
});
