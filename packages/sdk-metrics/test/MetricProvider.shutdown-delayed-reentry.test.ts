/*
 * Copyright The OpenTelemetry Authors
 * SPDX-License-Identifier: Apache-2.0
 */

import * as assert from 'assert';
import { MeterProvider, MetricReader } from '../src';

const nextTurn = () => new Promise<void>(resolve => setTimeout(resolve, 0));

async function settlesWithin(
  promise: Promise<unknown>,
  timeoutMillis = 20
): Promise<boolean> {
  return Promise.race([
    promise.then(
      () => true,
      () => true
    ),
    new Promise<boolean>(resolve =>
      setTimeout(() => resolve(false), timeoutMillis)
    ),
  ]);
}

class DelayedReentrantMetricReader extends MetricReader {
  public owner?: MeterProvider;
  public nestedShutdown?: Promise<void>;
  public shutdownCalls = 0;
  private readonly target: 'reader' | 'provider';

  constructor(target: 'reader' | 'provider') {
    super();
    this.target = target;
  }

  protected async onShutdown(): Promise<void> {
    this.shutdownCalls += 1;
    await Promise.resolve();
    this.nestedShutdown =
      this.target === 'reader' ? this.shutdown() : this.owner!.shutdown();
    return this.nestedShutdown;
  }

  protected onForceFlush(): Promise<void> {
    return Promise.resolve();
  }
}

describe('metrics delayed shutdown reentry', () => {
  it('records an unbounded MetricReader same-owner self-dependency', async () => {
    const reader = new DelayedReentrantMetricReader('reader');

    const outerShutdown = reader.shutdown();
    await nextTurn();
    const externalShutdown = reader.shutdown();

    assert.ok(reader.nestedShutdown);
    assert.strictEqual(reader.nestedShutdown, outerShutdown);
    assert.strictEqual(externalShutdown, outerShutdown);
    assert.strictEqual(await settlesWithin(outerShutdown), false);
    assert.strictEqual(reader.shutdownCalls, 1);
  });

  it('uses the one shared MetricReader timeout result to unwind the cycle', async () => {
    const reader = new DelayedReentrantMetricReader('reader');

    const outerShutdown = reader.shutdown({ timeoutMillis: 5 });
    await nextTurn();
    const externalShutdown = reader.shutdown({ timeoutMillis: 1000 });

    assert.ok(reader.nestedShutdown);
    assert.strictEqual(reader.nestedShutdown, outerShutdown);
    assert.strictEqual(externalShutdown, outerShutdown);
    await assert.rejects(outerShutdown, /Operation timed out/);
    await assert.rejects(externalShutdown, /Operation timed out/);
    assert.strictEqual(reader.shutdownCalls, 1);
  });

  it('records an unbounded MeterProvider and reader dependency cycle', async () => {
    const reader = new DelayedReentrantMetricReader('provider');
    const provider = new MeterProvider({ readers: [reader] });
    reader.owner = provider;

    const outerShutdown = provider.shutdown();
    await nextTurn();
    const externalShutdown = provider.shutdown();

    assert.ok(reader.nestedShutdown);
    assert.strictEqual(reader.nestedShutdown, outerShutdown);
    assert.strictEqual(externalShutdown, outerShutdown);
    assert.strictEqual(await settlesWithin(outerShutdown), false);
    assert.strictEqual(reader.shutdownCalls, 1);
  });

  it('propagates the reader operation timeout through MeterProvider joiners', async () => {
    const reader = new DelayedReentrantMetricReader('provider');
    const provider = new MeterProvider({ readers: [reader] });
    reader.owner = provider;

    const outerShutdown = provider.shutdown({ timeoutMillis: 5 });
    await nextTurn();
    const externalShutdown = provider.shutdown({ timeoutMillis: 1000 });

    assert.ok(reader.nestedShutdown);
    assert.strictEqual(reader.nestedShutdown, outerShutdown);
    assert.strictEqual(externalShutdown, outerShutdown);
    await assert.rejects(outerShutdown, /Operation timed out/);
    await assert.rejects(externalShutdown, /Operation timed out/);
    assert.strictEqual(reader.shutdownCalls, 1);
  });
});
