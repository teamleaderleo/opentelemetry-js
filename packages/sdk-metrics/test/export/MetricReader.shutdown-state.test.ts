/*
 * Copyright The OpenTelemetry Authors
 * SPDX-License-Identifier: Apache-2.0
 */

import * as assert from 'assert';
import * as sinon from 'sinon';
import { MetricReader } from '../../src';
import { TestMetricProducer } from './TestMetricProducer';

class ControlledMetricReader extends MetricReader {
  public shutdownCalls = 0;
  public forceFlushCalls = 0;
  public shutdownImplementation: () => Promise<void> = () => Promise.resolve();

  protected onShutdown(): Promise<void> {
    this.shutdownCalls += 1;
    return this.shutdownImplementation();
  }

  protected onForceFlush(): Promise<void> {
    this.forceFlushCalls += 1;
    return Promise.resolve();
  }
}

describe('MetricReader shutdown state', () => {
  afterEach(() => {
    sinon.restore();
  });

  it('shares one shutdown operation, options, and result across callers', async () => {
    const reader = new ControlledMetricReader();
    let resolveShutdown: () => void = () => {};
    const pendingShutdown = new Promise<void>(resolve => {
      resolveShutdown = resolve;
    });
    reader.shutdownImplementation = () => pendingShutdown;

    const first = reader.shutdown({ timeoutMillis: 100 });
    const second = reader.shutdown({ timeoutMillis: 1000 });

    assert.strictEqual(first, second);
    assert.strictEqual(reader.shutdownCalls, 1);
    assert.deepStrictEqual(
      (reader as unknown as { _shutdownOptions?: unknown })._shutdownOptions,
      { timeoutMillis: 100 }
    );

    resolveShutdown();
    await Promise.all([first, second]);

    const third = reader.shutdown({ timeoutMillis: 5000 });
    assert.strictEqual(third, first);
    await third;
    assert.strictEqual(reader.shutdownCalls, 1);
  });

  it('uses the first caller timeout for the shared shutdown result', async () => {
    const clock = sinon.useFakeTimers();
    const reader = new ControlledMetricReader();
    reader.shutdownImplementation = () => new Promise<void>(() => {});

    const first = reader.shutdown({ timeoutMillis: 10 });
    const second = reader.shutdown({ timeoutMillis: 1000 });

    assert.strictEqual(first, second);
    const firstRejected = assert.rejects(first, /Operation timed out/);
    const secondRejected = assert.rejects(second, /Operation timed out/);
    await clock.tickAsync(11);
    await Promise.all([firstRejected, secondRejected]);
    assert.strictEqual(reader.shutdownCalls, 1);
  });

  it('converts a synchronous onShutdown throw into one shared rejection', async () => {
    const reader = new ControlledMetricReader();
    const error = new Error('fieldwork metric reader shutdown failure');
    reader.shutdownImplementation = () => {
      throw error;
    };

    const first = reader.shutdown();
    const second = reader.shutdown();

    assert.strictEqual(first, second);
    await assert.rejects(first, candidate => candidate === error);
    await assert.rejects(second, candidate => candidate === error);
    assert.strictEqual(reader.shutdownCalls, 1);
  });

  it('preserves the unbound collection diagnostic after shutdown', async () => {
    const reader = new ControlledMetricReader();

    await reader.shutdown();

    await assert.rejects(
      reader.collect(),
      /MetricReader is not bound to a MetricProducer/
    );
  });

  it('becomes terminal and returns the shutdown result once shutdown begins', async () => {
    const reader = new ControlledMetricReader();
    reader.setMetricProducer(new TestMetricProducer());
    let resolveShutdown: () => void = () => {};
    const pendingShutdown = new Promise<void>(resolve => {
      resolveShutdown = resolve;
    });
    reader.shutdownImplementation = () => pendingShutdown;

    const shutdown = reader.shutdown();
    let forceFlushResolved = false;
    const forceFlush = reader.forceFlush().then(() => {
      forceFlushResolved = true;
    });

    await Promise.resolve();
    assert.strictEqual(forceFlushResolved, false);
    assert.strictEqual(reader.forceFlushCalls, 0);
    await assert.rejects(reader.collect(), /MetricReader is shutdown/);

    resolveShutdown();
    await Promise.all([shutdown, forceFlush]);
    assert.strictEqual(forceFlushResolved, true);
  });

  it('contains direct recursive shutdown and force flush from onShutdown', async () => {
    const reader = new ControlledMetricReader();
    let recursiveShutdown: Promise<void> | undefined;
    let recursiveForceFlush: Promise<void> | undefined;
    reader.shutdownImplementation = () => {
      recursiveShutdown = reader.shutdown();
      recursiveForceFlush = reader.forceFlush();
      return Promise.all([recursiveShutdown, recursiveForceFlush]).then(
        () => {}
      );
    };

    await reader.shutdown();
    await Promise.all([recursiveShutdown, recursiveForceFlush]);

    assert.strictEqual(reader.shutdownCalls, 1);
    assert.strictEqual(reader.forceFlushCalls, 0);
  });
});
