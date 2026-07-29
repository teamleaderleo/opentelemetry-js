/*
 * Copyright The OpenTelemetry Authors
 * SPDX-License-Identifier: Apache-2.0
 */

import { context, metrics, propagation, trace } from '@opentelemetry/api';
import { logs } from '@opentelemetry/api-logs';
import { MeterProvider, MetricReader } from '@opentelemetry/sdk-metrics';
import * as assert from 'assert';
import { NodeSDK } from '../src';

class TrackingMetricReader extends MetricReader {
  public shutdownCalls = 0;

  protected onForceFlush(): Promise<void> {
    return Promise.resolve();
  }

  protected onShutdown(): Promise<void> {
    this.shutdownCalls += 1;
    return Promise.resolve();
  }
}

describe('NodeSDK metric construction characterization', () => {
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

  it('strands readers bound before a later reader makes construction fail', async () => {
    const strandedReader = new TrackingMetricReader();
    const alreadyBoundReader = new TrackingMetricReader();
    const existingOwner = new MeterProvider({ readers: [alreadyBoundReader] });
    const sdk = new NodeSDK({
      autoDetectResources: false,
      metricReaders: [strandedReader, alreadyBoundReader],
      textMapPropagator: null,
    });

    assert.throws(
      () => sdk.start(),
      /MetricReader can not be bound to a MeterProvider again\./
    );

    assert.strictEqual(sdk['_meterProvider'], undefined);
    assert.strictEqual(strandedReader.shutdownCalls, 0);

    await sdk.shutdown();

    assert.strictEqual(strandedReader.shutdownCalls, 0);
    assert.throws(
      () => new MeterProvider({ readers: [strandedReader] }),
      /MetricReader can not be bound to a MeterProvider again\./
    );

    await strandedReader.shutdown();
    await existingOwner.shutdown();
  });
});
