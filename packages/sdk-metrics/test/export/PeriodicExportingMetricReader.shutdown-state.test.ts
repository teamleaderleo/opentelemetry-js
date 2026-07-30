/*
 * Copyright The OpenTelemetry Authors
 * SPDX-License-Identifier: Apache-2.0
 */

import * as assert from 'assert';
import type { ExportResult } from '@opentelemetry/core';
import { ExportResultCode } from '@opentelemetry/core';
import {
  MeterProvider,
  PeriodicExportingMetricReader,
  type PushMetricExporter,
} from '../../src';
import type { ResourceMetrics } from '../../src/export/MetricData';

const MAX_32_BIT_INT = 2 ** 31 - 1;

class ControlledExporter implements PushMetricExporter {
  public readonly exports: ResourceMetrics[] = [];
  public readonly firstExportStarted: Promise<void>;
  private markFirstExportStarted: () => void = () => {};
  private finishFirstExport: (() => void) | undefined;

  constructor() {
    this.firstExportStarted = new Promise<void>(resolve => {
      this.markFirstExportStarted = resolve;
    });
  }

  export(
    metrics: ResourceMetrics,
    resultCallback: (result: ExportResult) => void
  ): void {
    this.exports.push(metrics);
    if (this.exports.length === 1) {
      this.markFirstExportStarted();
      this.finishFirstExport = () => {
        resultCallback({ code: ExportResultCode.SUCCESS });
      };
      return;
    }

    resultCallback({ code: ExportResultCode.SUCCESS });
  }

  releaseFirstExport(): void {
    const finishFirstExport = this.finishFirstExport;
    this.finishFirstExport = undefined;
    finishFirstExport?.();
  }

  forceFlush(): Promise<void> {
    return Promise.resolve();
  }

  shutdown(): Promise<void> {
    return Promise.resolve();
  }
}

describe('PeriodicExportingMetricReader shutdown state', () => {
  it('keeps public collection closed while completing its owned final collection', async () => {
    const exporter = new ControlledExporter();
    const reader = new PeriodicExportingMetricReader({
      exporter,
      exportIntervalMillis: MAX_32_BIT_INT,
      exportTimeoutMillis: 1000,
    });
    const provider = new MeterProvider({ readers: [reader] });
    provider
      .getMeter('fieldwork-final-collection')
      .createCounter('fieldwork.requests')
      .add(1);

    const forceFlush = reader.forceFlush();
    await exporter.firstExportStarted;

    const shutdown = provider.shutdown();
    await assert.rejects(reader.collect(), /MetricReader is shutdown/);

    exporter.releaseFirstExport();
    await Promise.all([forceFlush, shutdown]);

    assert.strictEqual(exporter.exports.length, 2);
    assert.ok(
      exporter.exports[1].scopeMetrics.some(scopeMetric =>
        scopeMetric.metrics.some(
          metric => metric.descriptor.name === 'fieldwork.requests'
        )
      )
    );
  });
});
