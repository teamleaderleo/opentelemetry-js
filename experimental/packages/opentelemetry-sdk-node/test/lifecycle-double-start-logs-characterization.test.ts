/*
 * Copyright The OpenTelemetry Authors
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  context,
  metrics,
  propagation,
  trace,
  type Context,
} from '@opentelemetry/api';
import { logs } from '@opentelemetry/api-logs';
import type {
  LogRecordProcessor,
  ReadWriteLogRecord,
} from '@opentelemetry/sdk-logs';
import * as assert from 'assert';
import { NodeSDK } from '../src';

class NoopLogRecordProcessor implements LogRecordProcessor {
  forceFlush(): Promise<void> {
    return Promise.resolve();
  }

  onEmit(_logRecord: ReadWriteLogRecord, _context?: Context): void {}

  shutdown(): Promise<void> {
    return Promise.resolve();
  }
}

type ShutdownCapableProvider = {
  shutdown(): Promise<void>;
};

type NodeSdkInternals = {
  _loggerProvider?: ShutdownCapableProvider;
};

describe('NodeSDK logs double-start characterization', () => {
  beforeEach(() => {
    context.disable();
    trace.disable();
    propagation.disable();
    metrics.disable();
    logs.disable();

    process.env.OTEL_TRACES_EXPORTER = 'none';
    process.env.OTEL_METRICS_EXPORTER = 'none';
  });

  afterEach(() => {
    context.disable();
    trace.disable();
    propagation.disable();
    metrics.disable();
    logs.disable();

    delete process.env.OTEL_TRACES_EXPORTER;
    delete process.env.OTEL_METRICS_EXPORTER;
  });

  it('overwrites its owned logger provider while the global API keeps the first provider', async () => {
    const sdk = new NodeSDK({
      autoDetectResources: false,
      logRecordProcessors: [new NoopLogRecordProcessor()],
      textMapPropagator: null,
    });

    sdk.start();

    const firstGlobalProvider = logs.getLoggerProvider();
    const firstOwnedProvider = (sdk as unknown as NodeSdkInternals)
      ._loggerProvider;

    assert.ok(firstOwnedProvider);
    assert.strictEqual(firstGlobalProvider, firstOwnedProvider);

    let firstShutdownCalls = 0;
    const shutdownFirstProvider = firstOwnedProvider.shutdown.bind(
      firstOwnedProvider
    );
    firstOwnedProvider.shutdown = async () => {
      firstShutdownCalls += 1;
      await shutdownFirstProvider();
    };

    sdk.start();

    const secondOwnedProvider = (sdk as unknown as NodeSdkInternals)
      ._loggerProvider;

    assert.ok(secondOwnedProvider);
    assert.notStrictEqual(secondOwnedProvider, firstOwnedProvider);
    assert.strictEqual(logs.getLoggerProvider(), firstGlobalProvider);

    let secondShutdownCalls = 0;
    const shutdownSecondProvider = secondOwnedProvider.shutdown.bind(
      secondOwnedProvider
    );
    secondOwnedProvider.shutdown = async () => {
      secondShutdownCalls += 1;
      await shutdownSecondProvider();
    };

    await sdk.shutdown();

    assert.strictEqual(firstShutdownCalls, 0);
    assert.strictEqual(secondShutdownCalls, 1);

    await shutdownFirstProvider();
  });
});
