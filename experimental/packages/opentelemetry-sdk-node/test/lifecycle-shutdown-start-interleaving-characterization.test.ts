/*
 * Copyright The OpenTelemetry Authors
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  context,
  metrics,
  propagation,
  trace,
  type MeterProvider,
  type TracerProvider,
} from '@opentelemetry/api';
import { logs, type LoggerProvider } from '@opentelemetry/api-logs';
import { ExportResultCode, type ExportResult } from '@opentelemetry/core';
import type {
  Instrumentation,
  InstrumentationConfig,
} from '@opentelemetry/instrumentation';
import {
  SimpleSpanProcessor,
  type ReadableSpan,
  type SpanExporter,
} from '@opentelemetry/sdk-trace';
import * as assert from 'assert';
import { NodeSDK } from '../src';

class RecordingSpanExporter implements SpanExporter {
  public readonly spans: ReadableSpan[] = [];
  public shutdownCalls = 0;

  export(
    spans: ReadableSpan[],
    resultCallback: (result: ExportResult) => void
  ): void {
    this.spans.push(...spans);
    resultCallback({ code: ExportResultCode.SUCCESS });
  }

  shutdown(): Promise<void> {
    this.shutdownCalls += 1;
    return Promise.resolve();
  }
}

class EnableCallbackInstrumentation implements Instrumentation {
  public readonly instrumentationName =
    'fieldwork-shutdown-start-interleaving';
  public readonly instrumentationVersion = '0.0.0';

  private _config: InstrumentationConfig = { enabled: false };

  constructor(private readonly _onEnable: () => void) {}

  disable(): void {
    this._config.enabled = false;
  }

  enable(): void {
    this._config.enabled = true;
    this._onEnable();
  }

  setTracerProvider(_tracerProvider: TracerProvider): void {}

  setMeterProvider(_meterProvider: MeterProvider): void {}

  setLoggerProvider(_loggerProvider: LoggerProvider): void {}

  setConfig(config: InstrumentationConfig): void {
    this._config = config;
  }

  getConfig(): InstrumentationConfig {
    return this._config;
  }
}

describe('NodeSDK shutdown/start interleaving characterization', () => {
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

  it('allows start after shutdown has already resolved', async () => {
    const exporter = new RecordingSpanExporter();
    const sdk = new NodeSDK({
      autoDetectResources: false,
      spanProcessors: [new SimpleSpanProcessor({ exporter })],
      textMapPropagator: null,
    });

    await sdk.shutdown();
    sdk.start();

    trace.getTracer('fieldwork').startSpan('after-early-shutdown').end();

    assert.strictEqual(exporter.shutdownCalls, 0);
    assert.strictEqual(exporter.spans.length, 1);

    await sdk.shutdown();
    assert.strictEqual(exporter.shutdownCalls, 1);
  });

  it('can resolve shutdown reentered from instrumentation before providers exist', async () => {
    const exporter = new RecordingSpanExporter();
    let sdk: NodeSDK;
    let reentrantShutdown: Promise<void> | undefined;

    const instrumentation = new EnableCallbackInstrumentation(() => {
      reentrantShutdown = sdk.shutdown();
    });

    sdk = new NodeSDK({
      autoDetectResources: false,
      instrumentations: [instrumentation],
      spanProcessors: [new SimpleSpanProcessor({ exporter })],
      textMapPropagator: null,
    });

    sdk.start();
    assert.ok(reentrantShutdown);
    await reentrantShutdown;

    trace
      .getTracer('fieldwork')
      .startSpan('after-reentrant-shutdown-resolved')
      .end();

    assert.strictEqual(exporter.shutdownCalls, 0);
    assert.strictEqual(exporter.spans.length, 1);

    await sdk.shutdown();
    assert.strictEqual(exporter.shutdownCalls, 1);
  });
});
