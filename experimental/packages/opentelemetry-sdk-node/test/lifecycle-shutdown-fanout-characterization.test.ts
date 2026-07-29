/*
 * Copyright The OpenTelemetry Authors
 * SPDX-License-Identifier: Apache-2.0
 */

import { context, metrics, propagation, trace } from '@opentelemetry/api';
import { logs } from '@opentelemetry/api-logs';
import type { LogRecordProcessor } from '@opentelemetry/sdk-logs';
import { MetricReader } from '@opentelemetry/sdk-metrics';
import type { SpanProcessor } from '@opentelemetry/sdk-trace';
import * as assert from 'assert';
import { NodeSDK } from '../src';

class TrackingMetricReader extends MetricReader {
  public shutdownCalls = 0;

  constructor(private readonly _throwOnShutdown: boolean) {
    super();
  }

  protected onForceFlush(): Promise<void> {
    return Promise.resolve();
  }

  protected onShutdown(): Promise<void> {
    this.shutdownCalls += 1;
    if (this._throwOnShutdown) {
      throw new Error('fieldwork metric reader shutdown failure');
    }
    return Promise.resolve();
  }
}

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

  it('skips later processors and signal providers after a synchronous trace shutdown throw', async () => {
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

  it('returns a rejection but skips later log processors and metric readers', async () => {
    let throwingLogProcessorShutdownCalls = 0;
    let laterLogProcessorShutdownCalls = 0;

    const throwingLogProcessor: LogRecordProcessor = {
      onEmit() {},
      forceFlush: () => Promise.resolve(),
      shutdown: () => {
        throwingLogProcessorShutdownCalls += 1;
        throw new Error('fieldwork log processor shutdown failure');
      },
    };

    const laterLogProcessor: LogRecordProcessor = {
      onEmit() {},
      forceFlush: () => Promise.resolve(),
      shutdown: () => {
        laterLogProcessorShutdownCalls += 1;
        return Promise.resolve();
      },
    };

    const throwingMetricReader = new TrackingMetricReader(true);
    const laterMetricReader = new TrackingMetricReader(false);

    const sdk = new NodeSDK({
      autoDetectResources: false,
      logRecordProcessors: [throwingLogProcessor, laterLogProcessor],
      metricReaders: [throwingMetricReader, laterMetricReader],
      textMapPropagator: null,
    });

    sdk.start();

    await assert.rejects(sdk.shutdown());

    assert.strictEqual(throwingLogProcessorShutdownCalls, 1);
    assert.strictEqual(laterLogProcessorShutdownCalls, 0);
    assert.strictEqual(throwingMetricReader.shutdownCalls, 1);
    assert.strictEqual(laterMetricReader.shutdownCalls, 0);

    await assert.rejects(sdk.shutdown());

    assert.strictEqual(throwingLogProcessorShutdownCalls, 1);
    assert.strictEqual(laterLogProcessorShutdownCalls, 0);
    assert.strictEqual(throwingMetricReader.shutdownCalls, 1);
    assert.strictEqual(laterMetricReader.shutdownCalls, 0);
  });
});
