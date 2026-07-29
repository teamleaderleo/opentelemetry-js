/*
 * Copyright The OpenTelemetry Authors
 * SPDX-License-Identifier: Apache-2.0
 */

import { context, metrics, propagation, trace } from '@opentelemetry/api';
import { logs } from '@opentelemetry/api-logs';
import {
  ConsoleMetricExporter,
  PeriodicExportingMetricReader,
} from '@opentelemetry/sdk-metrics';
import * as assert from 'assert';
import { NodeSDK } from '../src';

describe('NodeSDK metrics double-start characterization', () => {
  beforeEach(() => {
    context.disable();
    trace.disable();
    propagation.disable();
    metrics.disable();
    logs.disable();

    process.env.OTEL_TRACES_EXPORTER = 'none';
    process.env.OTEL_LOGS_EXPORTER = 'none';
  });

  afterEach(() => {
    context.disable();
    trace.disable();
    propagation.disable();
    metrics.disable();
    logs.disable();

    delete process.env.OTEL_TRACES_EXPORTER;
    delete process.env.OTEL_LOGS_EXPORTER;
  });

  it('throws after a metric reader is rebound during a repeated start', async () => {
    const metricReader = new PeriodicExportingMetricReader({
      exporter: new ConsoleMetricExporter(),
      exportIntervalMillis: 60_000,
    });
    const sdk = new NodeSDK({
      autoDetectResources: false,
      metricReaders: [metricReader],
      textMapPropagator: null,
    });

    sdk.start();

    assert.throws(
      () => sdk.start(),
      /MetricReader can not be bound to a MeterProvider again\./
    );

    await sdk.shutdown();
  });
});
