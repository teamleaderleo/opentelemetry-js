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
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';
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

class TrackingInstrumentation implements Instrumentation {
  public readonly instrumentationName = 'fieldwork-lifecycle-characterization';
  public readonly instrumentationVersion = '0.0.0';

  public disableCalls = 0;
  public enableCalls = 0;
  public tracerProvider?: TracerProvider;
  public meterProvider?: MeterProvider;
  public loggerProvider?: LoggerProvider;

  private _config: InstrumentationConfig = { enabled: true };

  disable(): void {
    this.disableCalls += 1;
    this._config.enabled = false;
  }

  enable(): void {
    this.enableCalls += 1;
    this._config.enabled = true;
  }

  setTracerProvider(tracerProvider: TracerProvider): void {
    this.tracerProvider = tracerProvider;
  }

  setMeterProvider(meterProvider: MeterProvider): void {
    this.meterProvider = meterProvider;
  }

  setLoggerProvider(loggerProvider: LoggerProvider): void {
    this.loggerProvider = loggerProvider;
  }

  setConfig(config: InstrumentationConfig): void {
    this._config = config;
  }

  getConfig(): InstrumentationConfig {
    return this._config;
  }
}

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

describe('NodeSDK shutdown lifecycle characterization', () => {
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

  it('does not disable registered instrumentation during shutdown', async () => {
    const instrumentation = new TrackingInstrumentation();
    const sdk = new NodeSDK({
      autoDetectResources: false,
      instrumentations: [instrumentation],
    });

    sdk.start();
    await sdk.shutdown();

    assert.strictEqual(instrumentation.disableCalls, 0);
    assert.strictEqual(instrumentation.getConfig().enabled, true);
  });

  it('leaves the first context manager registered after shutdown', async () => {
    const firstContextManager = new AsyncLocalStorageContextManager();
    const secondContextManager = new AsyncLocalStorageContextManager();
    const firstSdk = new NodeSDK({
      autoDetectResources: false,
      contextManager: firstContextManager,
      textMapPropagator: null,
    });
    const secondSdk = new NodeSDK({
      autoDetectResources: false,
      contextManager: secondContextManager,
      textMapPropagator: null,
    });

    firstSdk.start();
    assert.strictEqual(context['_getContextManager'](), firstContextManager);

    await firstSdk.shutdown();
    assert.strictEqual(context['_getContextManager'](), firstContextManager);

    secondSdk.start();
    assert.strictEqual(context['_getContextManager'](), firstContextManager);

    await secondSdk.shutdown();
  });

  it('keeps a shutdown tracer provider global when a second SDK starts', async () => {
    const firstExporter = new RecordingSpanExporter();
    const secondExporter = new RecordingSpanExporter();
    const firstSdk = new NodeSDK({
      autoDetectResources: false,
      spanProcessors: [
        new SimpleSpanProcessor({ exporter: firstExporter }),
      ],
      textMapPropagator: null,
    });
    const secondSdk = new NodeSDK({
      autoDetectResources: false,
      spanProcessors: [
        new SimpleSpanProcessor({ exporter: secondExporter }),
      ],
      textMapPropagator: null,
    });

    firstSdk.start();
    trace.getTracer('fieldwork').startSpan('before-first-shutdown').end();
    assert.strictEqual(firstExporter.spans.length, 1);

    await firstSdk.shutdown();
    assert.strictEqual(firstExporter.shutdownCalls, 1);

    secondSdk.start();
    trace.getTracer('fieldwork').startSpan('after-second-start').end();

    assert.strictEqual(firstExporter.spans.length, 1);
    assert.strictEqual(secondExporter.spans.length, 0);

    await secondSdk.shutdown();
    assert.strictEqual(secondExporter.shutdownCalls, 1);
  });
});
