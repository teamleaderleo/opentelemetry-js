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
import type {
  Instrumentation,
  InstrumentationConfig,
} from '@opentelemetry/instrumentation';
import type { LogRecordProcessor } from '@opentelemetry/sdk-logs';
import { MetricReader } from '@opentelemetry/sdk-metrics';
import type { ReadableSpan, SpanProcessor } from '@opentelemetry/sdk-trace';
import * as assert from 'assert';
import * as Sinon from 'sinon';
import { NodeSDK } from '../src';

class EnableCallbackInstrumentation implements Instrumentation {
  public readonly instrumentationName = 'start-shutdown-state-test';
  public readonly instrumentationVersion = '0.0.0';

  private _config: InstrumentationConfig = { enabled: false };
  private readonly _onEnable: () => void;

  constructor(onEnable: () => void) {
    this._onEnable = onEnable;
  }

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

class ControlledSpanProcessor implements SpanProcessor {
  public startCalls = 0;
  public endCalls = 0;
  public shutdownCalls = 0;
  public resolveShutdown: () => void = () => {};

  private readonly _shutdown = new Promise<void>(resolve => {
    this.resolveShutdown = resolve;
  });

  onStart(): void {
    this.startCalls += 1;
  }

  onEnd(_span: ReadableSpan): void {
    this.endCalls += 1;
  }

  forceFlush(): Promise<void> {
    return Promise.resolve();
  }

  shutdown(): Promise<void> {
    this.shutdownCalls += 1;
    return this._shutdown;
  }
}

class ImmediateSpanProcessor implements SpanProcessor {
  public shutdownCalls = 0;

  onStart(): void {}

  onEnd(_span: ReadableSpan): void {}

  forceFlush(): Promise<void> {
    return Promise.resolve();
  }

  shutdown(): Promise<void> {
    this.shutdownCalls += 1;
    return Promise.resolve();
  }
}

class ControlledMetricReader extends MetricReader {
  public shutdownCalls = 0;

  private readonly _shutdownError?: Error;

  constructor(shutdownError?: Error) {
    super();
    this._shutdownError = shutdownError;
  }

  protected onForceFlush(): Promise<void> {
    return Promise.resolve();
  }

  protected onShutdown(): Promise<void> {
    this.shutdownCalls += 1;
    return this._shutdownError
      ? Promise.reject(this._shutdownError)
      : Promise.resolve();
  }
}

class ControlledLogRecordProcessor implements LogRecordProcessor {
  public shutdownCalls = 0;

  onEmit(): void {}

  forceFlush(): Promise<void> {
    return Promise.resolve();
  }

  shutdown(): Promise<void> {
    this.shutdownCalls += 1;
    return Promise.resolve();
  }
}

describe('NodeSDK start/shutdown state', () => {
  beforeEach(() => {
    context.disable();
    trace.disable();
    propagation.disable();
    metrics.disable();
    logs.disable();

    process.env.OTEL_TRACES_EXPORTER = 'none';
    process.env.OTEL_LOGS_EXPORTER = 'none';
    process.env.OTEL_METRICS_EXPORTER = 'none';
    process.env.OTEL_NODE_EXPERIMENTAL_SDK_METRICS = 'true';
  });

  afterEach(() => {
    Sinon.restore();
    context.disable();
    trace.disable();
    propagation.disable();
    metrics.disable();
    logs.disable();

    delete process.env.OTEL_TRACES_EXPORTER;
    delete process.env.OTEL_LOGS_EXPORTER;
    delete process.env.OTEL_METRICS_EXPORTER;
    delete process.env.OTEL_NODE_EXPERIMENTAL_SDK_METRICS;
  });

  it('makes shutdown before start terminal and shares one promise', async () => {
    const processor = new ControlledSpanProcessor();
    const sdk = new NodeSDK({
      autoDetectResources: false,
      spanProcessors: [processor],
      textMapPropagator: null,
    });

    const first = sdk.shutdown();
    const second = sdk.shutdown();

    assert.strictEqual(first, second);
    await first;

    sdk.start();
    trace.getTracer('fieldwork').startSpan('after-early-shutdown').end();

    assert.strictEqual(processor.startCalls, 0);
    assert.strictEqual(processor.endCalls, 0);
    assert.strictEqual(processor.shutdownCalls, 0);
  });

  it('defers reentrant shutdown until startup has created its providers', async () => {
    const processor = new ControlledSpanProcessor();
    const sdkRef: { current?: NodeSDK } = {};
    let reentrantShutdown: Promise<void> | undefined;
    let repeatedShutdown: Promise<void> | undefined;

    const instrumentation = new EnableCallbackInstrumentation(() => {
      reentrantShutdown = sdkRef.current?.shutdown();
      repeatedShutdown = sdkRef.current?.shutdown();
    });

    const sdk = new NodeSDK({
      autoDetectResources: false,
      instrumentations: [instrumentation],
      spanProcessors: [processor],
      textMapPropagator: null,
    });
    sdkRef.current = sdk;

    sdk.start();

    assert.ok(reentrantShutdown);
    assert.strictEqual(reentrantShutdown, repeatedShutdown);
    assert.strictEqual(processor.shutdownCalls, 1);

    let settled = false;
    void reentrantShutdown.then(() => {
      settled = true;
    });
    await Promise.resolve();
    assert.strictEqual(settled, false);

    processor.resolveShutdown();
    await reentrantShutdown;
    assert.strictEqual(settled, true);
    assert.strictEqual(sdk.shutdown(), reentrantShutdown);
  });

  it('settles reentrant shutdown when startup throws before providers exist', async () => {
    const sdkRef: { current?: NodeSDK } = {};
    let reentrantShutdown: Promise<void> | undefined;
    const instrumentation = new EnableCallbackInstrumentation(() => {
      reentrantShutdown = sdkRef.current?.shutdown();
      throw new Error('fieldwork startup failure');
    });

    const sdk = new NodeSDK({
      autoDetectResources: false,
      instrumentations: [instrumentation],
      textMapPropagator: null,
    });
    sdkRef.current = sdk;

    assert.throws(() => sdk.start(), /fieldwork startup failure/);
    assert.ok(reentrantShutdown);
    await reentrantShutdown;

    sdk.start();
    assert.strictEqual(sdk.shutdown(), reentrantShutdown);
  });

  it('shuts down a meter provider created before meter registration fails', async () => {
    const startupError = new Error('meter registration failed');
    const metricReader = new ControlledMetricReader();
    const spanProcessor = new ImmediateSpanProcessor();
    const logRecordProcessor = new ControlledLogRecordProcessor();
    const sdkRef: { current?: NodeSDK } = {};
    let reentrantShutdown: Promise<void> | undefined;

    Sinon.stub(metrics, 'setGlobalMeterProvider').throws(startupError);
    const instrumentation = new EnableCallbackInstrumentation(() => {
      reentrantShutdown = sdkRef.current?.shutdown();
    });
    const sdk = new NodeSDK({
      autoDetectResources: false,
      instrumentations: [instrumentation],
      metricReaders: [metricReader],
      spanProcessors: [spanProcessor],
      logRecordProcessors: [logRecordProcessor],
      textMapPropagator: null,
    });
    sdkRef.current = sdk;

    assert.throws(
      () => sdk.start(),
      candidate => candidate === startupError
    );
    assert.ok(reentrantShutdown);
    await reentrantShutdown;

    assert.strictEqual(metricReader.shutdownCalls, 1);
    assert.strictEqual(spanProcessor.shutdownCalls, 0);
    assert.strictEqual(logRecordProcessor.shutdownCalls, 0);
  });

  it('shuts down meter and tracer providers created before trace registration fails', async () => {
    const startupError = new Error('trace registration failed');
    const metricReader = new ControlledMetricReader();
    const spanProcessor = new ImmediateSpanProcessor();
    const logRecordProcessor = new ControlledLogRecordProcessor();
    const sdkRef: { current?: NodeSDK } = {};
    let reentrantShutdown: Promise<void> | undefined;

    Sinon.stub(trace, 'setGlobalTracerProvider').throws(startupError);
    const instrumentation = new EnableCallbackInstrumentation(() => {
      reentrantShutdown = sdkRef.current?.shutdown();
    });
    const sdk = new NodeSDK({
      autoDetectResources: false,
      instrumentations: [instrumentation],
      metricReaders: [metricReader],
      spanProcessors: [spanProcessor],
      logRecordProcessors: [logRecordProcessor],
      textMapPropagator: null,
    });
    sdkRef.current = sdk;

    assert.throws(
      () => sdk.start(),
      candidate => candidate === startupError
    );
    assert.ok(reentrantShutdown);
    await reentrantShutdown;

    assert.strictEqual(metricReader.shutdownCalls, 1);
    assert.strictEqual(spanProcessor.shutdownCalls, 1);
    assert.strictEqual(logRecordProcessor.shutdownCalls, 0);
  });

  it('shuts down every provider created before logger registration fails', async () => {
    const startupError = new Error('logger registration failed');
    const metricReader = new ControlledMetricReader();
    const spanProcessor = new ImmediateSpanProcessor();
    const logRecordProcessor = new ControlledLogRecordProcessor();
    const sdkRef: { current?: NodeSDK } = {};
    let reentrantShutdown: Promise<void> | undefined;

    Sinon.stub(logs, 'setGlobalLoggerProvider').throws(startupError);
    const instrumentation = new EnableCallbackInstrumentation(() => {
      reentrantShutdown = sdkRef.current?.shutdown();
    });
    const sdk = new NodeSDK({
      autoDetectResources: false,
      instrumentations: [instrumentation],
      metricReaders: [metricReader],
      spanProcessors: [spanProcessor],
      logRecordProcessors: [logRecordProcessor],
      textMapPropagator: null,
    });
    sdkRef.current = sdk;

    assert.throws(
      () => sdk.start(),
      candidate => candidate === startupError
    );
    assert.ok(reentrantShutdown);
    await reentrantShutdown;

    assert.strictEqual(metricReader.shutdownCalls, 1);
    assert.strictEqual(spanProcessor.shutdownCalls, 1);
    assert.strictEqual(logRecordProcessor.shutdownCalls, 1);
  });

  it('keeps startup and teardown failures on their owning calls', async () => {
    const startupError = new Error('trace registration failed');
    const teardownError = new Error('metric reader shutdown failed');
    const metricReader = new ControlledMetricReader(teardownError);
    const spanProcessor = new ImmediateSpanProcessor();
    const sdkRef: { current?: NodeSDK } = {};
    let reentrantShutdown: Promise<void> | undefined;

    Sinon.stub(trace, 'setGlobalTracerProvider').throws(startupError);
    const instrumentation = new EnableCallbackInstrumentation(() => {
      reentrantShutdown = sdkRef.current?.shutdown();
    });
    const sdk = new NodeSDK({
      autoDetectResources: false,
      instrumentations: [instrumentation],
      metricReaders: [metricReader],
      spanProcessors: [spanProcessor],
      textMapPropagator: null,
    });
    sdkRef.current = sdk;

    assert.throws(
      () => sdk.start(),
      candidate => candidate === startupError
    );
    assert.ok(reentrantShutdown);
    await assert.rejects(
      reentrantShutdown,
      candidate => candidate === teardownError
    );

    assert.strictEqual(metricReader.shutdownCalls, 1);
    assert.strictEqual(spanProcessor.shutdownCalls, 1);
  });
});
