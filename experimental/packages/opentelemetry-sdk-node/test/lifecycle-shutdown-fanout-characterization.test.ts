/*
 * Copyright The OpenTelemetry Authors
 * SPDX-License-Identifier: Apache-2.0
 */

import { context, metrics, propagation, trace } from '@opentelemetry/api';
import { logs } from '@opentelemetry/api-logs';
import type { LogRecordProcessor } from '@opentelemetry/sdk-logs';
import type { SpanProcessor } from '@opentelemetry/sdk-trace';
import * as assert from 'assert';
import { NodeSDK } from '../src';

describe('NodeSDK shutdown fanout characterization', () => {
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

  it('skips later processors and signal providers after a synchronous shutdown throw', async () => {
    let throwingProcessorShutdownCalls = 0;
    let laterSpanProcessorShutdownCalls = 0;
    let logProcessorShutdownCalls = 0;

    const throwingSpanProcessor: SpanProcessor = {
      onStart() {},
      onEnd() {},
      forceFlush: () => Promise.resolve(),
      shutdown: () => {
        throwingProcessorShutdownCalls += 1;
        if (throwingProcessorShutdownCalls === 1) {
          throw new Error('fieldwork synchronous shutdown failure');
        }
        return Promise.resolve();
      },
    };

    const laterSpanProcessor: SpanProcessor = {
      onStart() {},
      onEnd() {},
      forceFlush: () => Promise.resolve(),
      shutdown: () => {
        laterSpanProcessorShutdownCalls += 1;
        return Promise.resolve();
      },
    };

    const logProcessor: LogRecordProcessor = {
      onEmit() {},
      forceFlush: () => Promise.resolve(),
      shutdown: () => {
        logProcessorShutdownCalls += 1;
        return Promise.resolve();
      },
    };

    const sdk = new NodeSDK({
      autoDetectResources: false,
      spanProcessors: [throwingSpanProcessor, laterSpanProcessor],
      logRecordProcessors: [logProcessor],
      textMapPropagator: null,
    });

    sdk.start();

    assert.throws(
      () => sdk.shutdown(),
      /fieldwork synchronous shutdown failure/
    );

    assert.strictEqual(throwingProcessorShutdownCalls, 1);
    assert.strictEqual(laterSpanProcessorShutdownCalls, 0);
    assert.strictEqual(logProcessorShutdownCalls, 0);

    await sdk.shutdown();

    assert.strictEqual(throwingProcessorShutdownCalls, 2);
    assert.strictEqual(laterSpanProcessorShutdownCalls, 1);
    assert.strictEqual(logProcessorShutdownCalls, 1);
  });
});
