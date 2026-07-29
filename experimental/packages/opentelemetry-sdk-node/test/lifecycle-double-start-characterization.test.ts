/*
 * Copyright The OpenTelemetry Authors
 * SPDX-License-Identifier: Apache-2.0
 */

import { context, metrics, propagation, trace } from '@opentelemetry/api';
import { logs } from '@opentelemetry/api-logs';
import { ExportResultCode, type ExportResult } from '@opentelemetry/core';
import type { ReadableSpan, SpanExporter } from '@opentelemetry/sdk-trace';
import * as assert from 'assert';
import { NodeSDK } from '../src';

class RecordingSpanExporter implements SpanExporter {
  public readonly spans: ReadableSpan[] = [];

  export(
    spans: ReadableSpan[],
    resultCallback: (result: ExportResult) => void
  ): void {
    this.spans.push(...spans);
    resultCallback({ code: ExportResultCode.SUCCESS });
  }

  shutdown(): Promise<void> {
    return Promise.resolve();
  }
}

type ShutdownCapableProvider = {
  shutdown(): Promise<void>;
};

type NodeSdkInternals = {
  _tracerProvider?: ShutdownCapableProvider;
};

type ProxyProvider = {
  getDelegate(): unknown;
};

describe('NodeSDK double-start lifecycle characterization', () => {
  beforeEach(() => {
    context.disable();
    trace.disable();
    propagation.disable();
    metrics.disable();
    logs.disable();

    process.env.OTEL_LOGS_EXPORTER = 'none';
    process.env.OTEL_METRICS_EXPORTER = 'none';
  });

  afterEach(() => {
    context.disable();
    trace.disable();
    propagation.disable();
    metrics.disable();
    logs.disable();

    delete process.env.OTEL_LOGS_EXPORTER;
    delete process.env.OTEL_METRICS_EXPORTER;
  });

  it('overwrites its owned provider while the global API keeps the first provider', async () => {
    const exporter = new RecordingSpanExporter();
    const sdk = new NodeSDK({
      autoDetectResources: false,
      traceExporter: exporter,
      textMapPropagator: null,
    });

    sdk.start();

    const proxyProvider = trace.getTracerProvider() as unknown as ProxyProvider;
    const firstOwnedProvider = (sdk as unknown as NodeSdkInternals)
      ._tracerProvider;

    assert.ok(firstOwnedProvider);
    assert.strictEqual(proxyProvider.getDelegate(), firstOwnedProvider);

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
      ._tracerProvider;

    assert.ok(secondOwnedProvider);
    assert.notStrictEqual(secondOwnedProvider, firstOwnedProvider);
    assert.strictEqual(proxyProvider.getDelegate(), firstOwnedProvider);

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

    // The first provider is still the global delegate but is no longer owned by
    // NodeSDK. Shut it down explicitly so the characterization test is isolated.
    await shutdownFirstProvider();
  });
});
