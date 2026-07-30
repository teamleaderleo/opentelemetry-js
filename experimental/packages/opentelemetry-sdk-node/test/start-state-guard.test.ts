/*
 * Copyright The OpenTelemetry Authors
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  context,
  diag,
  metrics,
  propagation,
  ROOT_CONTEXT,
  trace,
  type Context,
  type ContextManager,
} from '@opentelemetry/api';
import { logs } from '@opentelemetry/api-logs';
import { NoopSpanProcessor } from '@opentelemetry/sdk-trace';
import * as assert from 'assert';
import * as Sinon from 'sinon';
import { NodeSDK } from '../src';

class ReentrantContextManager implements ContextManager {
  public sdk?: NodeSDK;
  public enableCalls = 0;

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
    this.sdk?.start();
    return this;
  }

  disable(): this {
    return this;
  }
}

class ThrowingContextManager implements ContextManager {
  public enableCalls = 0;

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
    throw new Error('context manager failed to enable');
  }

  disable(): this {
    return this;
  }
}

describe('NodeSDK start-state guard', () => {
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
    Sinon.restore();
    context.disable();
    trace.disable();
    propagation.disable();
    metrics.disable();
    logs.disable();

    delete process.env.OTEL_TRACES_EXPORTER;
    delete process.env.OTEL_LOGS_EXPORTER;
    delete process.env.OTEL_METRICS_EXPORTER;
  });

  it('does not replace its provider on repeated start', async () => {
    const setGlobalTracerProvider = Sinon.spy(trace, 'setGlobalTracerProvider');
    const warn = Sinon.spy(diag, 'warn');
    const sdk = new NodeSDK({
      autoDetectResources: false,
      spanProcessors: [new NoopSpanProcessor()],
      textMapPropagator: null,
    });

    sdk.start();
    const firstProvider = sdk['_tracerProvider'];

    sdk.start();

    assert.strictEqual(sdk['_tracerProvider'], firstProvider);
    assert.strictEqual(setGlobalTracerProvider.callCount, 1);
    assert.ok(warn.calledWith('NodeSDK.start() may only be called once.'));

    await sdk.shutdown();
  });

  it('does not restart the same instance after shutdown', async () => {
    const setGlobalTracerProvider = Sinon.spy(trace, 'setGlobalTracerProvider');
    const sdk = new NodeSDK({
      autoDetectResources: false,
      spanProcessors: [new NoopSpanProcessor()],
      textMapPropagator: null,
    });

    sdk.start();
    const firstProvider = sdk['_tracerProvider'];
    await sdk.shutdown();

    sdk.start();

    assert.strictEqual(sdk['_tracerProvider'], firstProvider);
    assert.strictEqual(setGlobalTracerProvider.callCount, 1);
  });

  it('blocks a reentrant start before registration repeats', async () => {
    const setGlobalTracerProvider = Sinon.spy(trace, 'setGlobalTracerProvider');
    const contextManager = new ReentrantContextManager();
    const sdk = new NodeSDK({
      autoDetectResources: false,
      contextManager,
      spanProcessors: [new NoopSpanProcessor()],
      textMapPropagator: null,
    });
    contextManager.sdk = sdk;

    sdk.start();

    assert.strictEqual(contextManager.enableCalls, 1);
    assert.strictEqual(setGlobalTracerProvider.callCount, 1);

    await sdk.shutdown();
  });

  it('does not repeat side effects after a failed start attempt', () => {
    const warn = Sinon.spy(diag, 'warn');
    const contextManager = new ThrowingContextManager();
    const sdk = new NodeSDK({
      autoDetectResources: false,
      contextManager,
      textMapPropagator: null,
    });

    assert.throws(() => sdk.start(), /context manager failed to enable/);
    assert.doesNotThrow(() => sdk.start());

    assert.strictEqual(contextManager.enableCalls, 1);
    assert.ok(warn.calledWith('NodeSDK.start() may only be called once.'));
  });
});
