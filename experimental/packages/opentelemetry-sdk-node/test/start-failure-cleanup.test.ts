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
import { TracerProvider as SDKTracerProvider } from '@opentelemetry/sdk-trace';
import * as assert from 'assert';
import * as Sinon from 'sinon';
import { NOOP_SDK, startNodeSDK } from '../src/start';

class DisabledTrackingInstrumentation implements Instrumentation {
  public readonly instrumentationName = 'start-failure-cleanup-test';
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

class ThrowingInstrumentation extends DisabledTrackingInstrumentation {
  enable(): void {
    super.enable();
    throw new Error('instrumentation enable failed');
  }
}

describe('startNodeSDK failure cleanup', () => {
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

  it('does not enable instrumentation when component creation fails', async () => {
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
    assert.strictEqual(instrumentation.enableCalls, 0);
    assert.strictEqual(instrumentation.disableCalls, 0);
    assert.strictEqual(enableContextManager.callCount, 1);
    assert.strictEqual(disableContextManager.callCount, 1);

    await sdk.shutdown();
  });

  it('does not publish globals when instrumentation registration throws', () => {
    const instrumentation = new ThrowingInstrumentation();
    const setGlobalContextManager = Sinon.spy(
      context,
      'setGlobalContextManager'
    );
    const setGlobalTracerProvider = Sinon.spy(
      trace,
      'setGlobalTracerProvider'
    );
    const disableContextManager = Sinon.spy(
      AsyncLocalStorageContextManager.prototype,
      'disable'
    );
    const shutdownTracerProvider = Sinon.spy(
      SDKTracerProvider.prototype,
      'shutdown'
    );
    process.env.OTEL_TRACES_EXPORTER = 'console';

    assert.throws(
      () => startNodeSDK({ instrumentations: [instrumentation] }),
      /instrumentation enable failed/
    );

    assert.strictEqual(instrumentation.enableCalls, 1);
    assert.strictEqual(setGlobalContextManager.callCount, 0);
    assert.strictEqual(setGlobalTracerProvider.callCount, 0);
    assert.strictEqual(disableContextManager.callCount, 1);
    assert.strictEqual(shutdownTracerProvider.callCount, 1);
  });

  it('still registers instrumentation after successful component setup', async () => {
    const instrumentation = new DisabledTrackingInstrumentation();

    const sdk = startNodeSDK({ instrumentations: [instrumentation] });

    assert.notStrictEqual(sdk, NOOP_SDK);
    assert.strictEqual(instrumentation.enableCalls, 1);
    assert.strictEqual(instrumentation.disableCalls, 0);

    await sdk.shutdown();
  });
});
