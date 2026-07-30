/*
 * Copyright The OpenTelemetry Authors
 * SPDX-License-Identifier: Apache-2.0
 */

import * as assert from 'assert';
import * as sinon from 'sinon';
import { MeterProvider } from '../src';
import { TestMetricReader } from './export/TestMetricReader';

describe('MeterProvider shutdown state', () => {
  afterEach(() => {
    sinon.restore();
  });

  it('shares one shutdown operation, options, and result across callers', async () => {
    const reader = new TestMetricReader();
    let shutdownCalls = 0;
    let resolveShutdown: () => void = () => {};
    const pendingShutdown = new Promise<void>(resolve => {
      resolveShutdown = resolve;
    });
    const shutdown = sinon.stub(reader, 'shutdown').callsFake(options => {
      shutdownCalls += 1;
      assert.deepStrictEqual(options, { timeoutMillis: 10 });
      return pendingShutdown;
    });
    const provider = new MeterProvider({ readers: [reader] });

    const first = provider.shutdown({ timeoutMillis: 10 });
    const second = provider.shutdown({ timeoutMillis: 1000 });

    assert.strictEqual(first, second);
    assert.strictEqual(shutdownCalls, 1);
    assert.deepStrictEqual(
      (provider as unknown as { _shutdownOptions?: unknown })._shutdownOptions,
      { timeoutMillis: 10 }
    );

    resolveShutdown();
    await Promise.all([first, second]);

    const third = provider.shutdown({ timeoutMillis: 5000 });
    assert.strictEqual(third, first);
    await third;
    sinon.assert.calledOnce(shutdown);
  });

  it('converts a synchronous reader throw into one shared rejection', async () => {
    const reader = new TestMetricReader();
    const error = new Error('fieldwork metrics provider shutdown failure');
    let shutdownCalls = 0;
    sinon.stub(reader, 'shutdown').callsFake(() => {
      shutdownCalls += 1;
      throw error;
    });
    const provider = new MeterProvider({ readers: [reader] });

    const first = provider.shutdown();
    const second = provider.shutdown();

    assert.strictEqual(first, second);
    await assert.rejects(first, candidate => candidate === error);
    await assert.rejects(second, candidate => candidate === error);
    assert.strictEqual(shutdownCalls, 1);
  });

  it('returns the shutdown result instead of force flushing after shutdown begins', async () => {
    const reader = new TestMetricReader();
    let forceFlushCalls = 0;
    let resolveShutdown: () => void = () => {};
    const pendingShutdown = new Promise<void>(resolve => {
      resolveShutdown = resolve;
    });
    sinon.stub(reader, 'shutdown').returns(pendingShutdown);
    sinon.stub(reader, 'forceFlush').callsFake(() => {
      forceFlushCalls += 1;
      return Promise.resolve();
    });
    const provider = new MeterProvider({ readers: [reader] });

    const shutdown = provider.shutdown();
    const forceFlush = provider.forceFlush();

    assert.strictEqual(forceFlush, shutdown);
    assert.strictEqual(forceFlushCalls, 0);

    resolveShutdown();
    await forceFlush;
  });

  it('contains direct recursive shutdown and force flush from a reader', async () => {
    const reader = new TestMetricReader();
    let provider: MeterProvider;
    let recursiveShutdown: Promise<void> | undefined;
    let recursiveForceFlush: Promise<void> | undefined;
    let readerForceFlushCalls = 0;

    sinon.stub(reader, 'shutdown').callsFake(() => {
      recursiveShutdown = provider.shutdown();
      recursiveForceFlush = provider.forceFlush();
      return Promise.all([recursiveShutdown, recursiveForceFlush]).then(() => {});
    });
    sinon.stub(reader, 'forceFlush').callsFake(() => {
      readerForceFlushCalls += 1;
      return Promise.resolve();
    });
    provider = new MeterProvider({ readers: [reader] });

    await provider.shutdown();
    await Promise.all([recursiveShutdown, recursiveForceFlush]);

    assert.strictEqual(readerForceFlushCalls, 0);
  });
});
