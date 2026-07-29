/*
 * Copyright The OpenTelemetry Authors
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  context,
  metrics,
  propagation,
  ROOT_CONTEXT,
  trace,
  type Context,
  type ContextManager,
} from '@opentelemetry/api';
import {
  logs,
  type LoggerProvider as ApiLoggerProvider,
} from '@opentelemetry/api-logs';
import { ExportResultCode, type ExportResult } from '@opentelemetry/core';
import type {
  LogRecordProcessor,
  ReadWriteLogRecord,
} from '@opentelemetry/sdk-logs';
import {
  SimpleSpanProcessor,
  type ReadableSpan,
  type SpanExporter,
} from '@opentelemetry/sdk-trace';
import * as assert from 'assert';
import { NodeSDK } from '../src';

class TrackingContextManager implements ContextManager {
  public enableCalls = 0;
  public disableCalls = 0;

  active(): Context {
    return ROOT_CONTEXT;
  }

  with<A extends unknown[], F extends (...args: A) => ReturnType<F>>(
    _context: Context,
    fn: F,
    thisArg?: ThisParameterType<F>,
    ...args: A
  ): ReturnType<F> {
    return fn.call(thisArg, ...args);
  }

  bind<T>(_context: Context, target: T): T {
    return target;
  }

  enable(): this {
    this.enableCalls += 1;
    return this;
  }

  disable(): this {
    this.disableCalls += 1;
    return this;
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

class TrackingLogRecordProcessor implements LogRecordProcessor {
  public shutdownCalls = 0;

  forceFlush(): Promise<void> {
    return Promise.resolve();
  }

  onEmit(_logRecord: ReadWriteLogRecord, _context?: Context): void {}

  shutdown(): Promise<void> {
    this.shutdownCalls += 1;
    return Promise.resolve();
  }
}

describe('NodeSDK restart and registration failure characterization', () => {
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

  it('enables a rejected context manager and does not disable it on shutdown', async () => {
    const firstContextManager = new TrackingContextManager();
    const rejectedContextManager = new TrackingContextManager();
    const firstSdk = new NodeSDK({
      autoDetectResources: false,
      contextManager: firstContextManager,
      textMapPropagator: null,
    });
    const rejectedSdk = new NodeSDK({
      autoDetectResources: false,
      contextManager: rejectedContextManager,
      textMapPropagator: null,
    });

    firstSdk.start();
    rejectedSdk.start();

    assert.strictEqual(firstContextManager.enableCalls, 1);
    assert.strictEqual(rejectedContextManager.enableCalls, 1);
    assert.strictEqual(context['_getContextManager'](), firstContextManager);

    await rejectedSdk.shutdown();

    assert.strictEqual(rejectedContextManager.disableCalls, 0);

    await firstSdk.shutdown();
    assert.strictEqual(firstContextManager.disableCalls, 0);
  });

  it('restarting one SDK after shutdown leaves tracing on the first shutdown provider', async () => {
    const exporter = new RecordingSpanExporter();
    const processor = new SimpleSpanProcessor({ exporter });
    const sdk = new NodeSDK({
      autoDetectResources: false,
      spanProcessors: [processor],
      textMapPropagator: null,
    });

    sdk.start();
    const firstProvider = sdk['_tracerProvider'];
    trace.getTracer('fieldwork').startSpan('before-shutdown').end();
    assert.strictEqual(exporter.spans.length, 1);

    await sdk.shutdown();
    assert.strictEqual(exporter.shutdownCalls, 1);

    sdk.start();
    const secondProvider = sdk['_tracerProvider'];

    assert.notStrictEqual(secondProvider, firstProvider);
    assert.strictEqual(
      (trace.getTracerProvider() as { getDelegate(): unknown }).getDelegate(),
      firstProvider
    );

    trace.getTracer('fieldwork').startSpan('after-restart').end();
    assert.strictEqual(exporter.spans.length, 1);

    await sdk.shutdown();
  });

  it('restarting one SDK after shutdown leaves logs on the first shutdown provider', async () => {
    const processor = new TrackingLogRecordProcessor();
    const sdk = new NodeSDK({
      autoDetectResources: false,
      logRecordProcessors: [processor],
      textMapPropagator: null,
    });

    sdk.start();
    const firstProvider = sdk['_loggerProvider'];
    assert.strictEqual(
      logs.getLoggerProvider() as ApiLoggerProvider,
      firstProvider
    );

    await sdk.shutdown();
    assert.strictEqual(processor.shutdownCalls, 1);

    sdk.start();
    const secondProvider = sdk['_loggerProvider'];

    assert.notStrictEqual(secondProvider, firstProvider);
    assert.strictEqual(
      logs.getLoggerProvider() as ApiLoggerProvider,
      firstProvider
    );

    await sdk.shutdown();
  });
});