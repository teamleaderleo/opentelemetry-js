/*
 * Copyright The OpenTelemetry Authors
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  context,
  diag,
  metrics,
  propagation,
  trace,
  type MeterProvider,
  type TracerProvider,
} from '@opentelemetry/api';
import { logs, type LoggerProvider } from '@opentelemetry/api-logs';
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';
import type {
  Instrumentation,
  InstrumentationConfig,
} from '@opentelemetry/instrumentation';
import {
  TracerProvider as SDKTracerProvider,
  type SpanProcessor,
} from '@opentelemetry/sdk-trace';
import * as assert from 'assert';
import * as Sinon from 'sinon';
import { NOOP_SDK, startNodeSDK } from '../src/start';

class DisabledTrackingInstrumentation implements Instrumentation {
  public readonly instrumentationName =
    'fieldwork-start-function-lifecycle-characterization';
  public readonly instrumentationVersion = '0.0.0';

  public enableCalls = 0;
  public disableCalls = 0;

  private _config: InstrumentationConfig = { enabled: false };

  disable(): void {
    this.disableCalls += 1;
    this._config.enabled = false;
  }

  enable(): void {
    this.enableCalls += 1;
    this._config.enabled = true;
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

describe('startNodeSDK lifecycle characterization', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    diag.disable();
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
    diag.disable();
    Sinon.restore();

    for (const key of Object.keys(process.env)) {
      delete process.env[key];
    }
    for (const [key, value] of Object.entries(originalEnv)) {
      process.env[key] = value;
    }
  });

  it('returns NOOP_SDK after enabling instrumentation and an unowned context manager', async () => {
    const instrumentation = new DisabledTrackingInstrumentation();
    const enableContextManager = Sinon.spy(
      AsyncLocalStorageContextManager.prototype,
      'enable'
    );
    const disableContextManager = Sinon.spy(
      AsyncLocalStorageContextManager.prototype,
      'disable'
    );
    process.env.OTEL_CONFIG_FILE =
      'test/fixtures/unknown-log-record-processor.yaml';

    const sdk = startNodeSDK({ instrumentations: [instrumentation] });

    assert.strictEqual(sdk, NOOP_SDK);
    assert.strictEqual(instrumentation.enableCalls, 1);
    assert.strictEqual(instrumentation.disableCalls, 0);
    assert.strictEqual(enableContextManager.callCount, 1);
    assert.strictEqual(disableContextManager.callCount, 0);

    await sdk.shutdown();

    assert.strictEqual(instrumentation.disableCalls, 0);
    assert.strictEqual(disableContextManager.callCount, 0);
  });

  it('enables a second context manager even though global registration rejects it', async () => {
    const enableContextManager = Sinon.spy(
      AsyncLocalStorageContextManager.prototype,
      'enable'
    );
    const disableContextManager = Sinon.spy(
      AsyncLocalStorageContextManager.prototype,
      'disable'
    );
    const setGlobalContextManager = Sinon.spy(
      context,
      'setGlobalContextManager'
    );

    const first = startNodeSDK();
    const firstContextManager = context['_getContextManager']();
    const second = startNodeSDK();

    assert.strictEqual(enableContextManager.callCount, 2);
    assert.strictEqual(setGlobalContextManager.callCount, 2);
    assert.strictEqual(setGlobalContextManager.firstCall.returnValue, true);
    assert.strictEqual(setGlobalContextManager.secondCall.returnValue, false);
    assert.strictEqual(context['_getContextManager'](), firstContextManager);

    await second.shutdown();
    await first.shutdown();

    assert.strictEqual(disableContextManager.callCount, 0);
  });

  it('can publish context while retaining a pre-existing global tracer provider', async () => {
    let startedSpans = 0;
    let endedSpans = 0;
    let existingProviderShutdownCalls = 0;
    const existingProcessor: SpanProcessor = {
      onStart() {
        startedSpans += 1;
      },
      onEnd() {
        endedSpans += 1;
      },
      forceFlush: () => Promise.resolve(),
      shutdown: () => {
        existingProviderShutdownCalls += 1;
        return Promise.resolve();
      },
    };
    const existingProvider = new SDKTracerProvider({
      spanProcessors: [existingProcessor],
    });
    assert.strictEqual(trace.setGlobalTracerProvider(existingProvider), true);

    const setGlobalContextManager = Sinon.spy(
      context,
      'setGlobalContextManager'
    );
    const setGlobalTracerProvider = Sinon.spy(
      trace,
      'setGlobalTracerProvider'
    );
    const shutdownTracerProvider = Sinon.spy(
      SDKTracerProvider.prototype,
      'shutdown'
    );
    process.env.OTEL_TRACES_EXPORTER = 'console';

    const sdk = startNodeSDK();

    assert.strictEqual(setGlobalContextManager.callCount, 1);
    assert.strictEqual(setGlobalContextManager.firstCall.returnValue, true);
    assert.strictEqual(setGlobalTracerProvider.callCount, 1);
    assert.strictEqual(setGlobalTracerProvider.firstCall.returnValue, false);

    trace.getTracer('fieldwork-before-private-shutdown').startSpan('one').end();
    assert.strictEqual(startedSpans, 1);
    assert.strictEqual(endedSpans, 1);

    await sdk.shutdown();

    assert.strictEqual(shutdownTracerProvider.callCount, 1);
    assert.strictEqual(existingProviderShutdownCalls, 0);

    trace.getTracer('fieldwork-after-private-shutdown').startSpan('two').end();
    assert.strictEqual(startedSpans, 2);
    assert.strictEqual(endedSpans, 2);

    await existingProvider.shutdown();
    assert.strictEqual(existingProviderShutdownCalls, 1);
  });
});
