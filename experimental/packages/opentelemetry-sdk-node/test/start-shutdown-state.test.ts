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
import type { ReadableSpan, SpanProcessor } from '@opentelemetry/sdk-trace';
import * as assert from 'assert';
import { NodeSDK } from '../src';

class EnableCallbackInstrumentation implements Instrumentation {
  public readonly instrumentationName = 'start-shutdown-state-test';
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
    let sdk: NodeSDK;
    let reentrantShutdown: Promise<void> | undefined;
    let repeatedShutdown: Promise<void> | undefined;

    const instrumentation = new EnableCallbackInstrumentation(() => {
      reentrantShutdown = sdk.shutdown();
      repeatedShutdown = sdk.shutdown();
    });

    sdk = new NodeSDK({
      autoDetectResources: false,
      instrumentations: [instrumentation],
      spanProcessors: [processor],
      textMapPropagator: null,
    });

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
    let sdk: NodeSDK;
    let reentrantShutdown: Promise<void> | undefined;
    const instrumentation = new EnableCallbackInstrumentation(() => {
      reentrantShutdown = sdk.shutdown();
      throw new Error('fieldwork startup failure');
    });

    sdk = new NodeSDK({
      autoDetectResources: false,
      instrumentations: [instrumentation],
      textMapPropagator: null,
    });

    assert.throws(() => sdk.start(), /fieldwork startup failure/);
    assert.ok(reentrantShutdown);
    await reentrantShutdown;

    sdk.start();
    assert.strictEqual(sdk.shutdown(), reentrantShutdown);
  });
});
