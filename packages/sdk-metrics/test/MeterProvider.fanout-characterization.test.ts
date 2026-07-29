/*
 * Copyright The OpenTelemetry Authors
 * SPDX-License-Identifier: Apache-2.0
 */

import * as assert from 'assert';
import * as sinon from 'sinon';
import { MeterProvider } from '../src';
import { TestMetricReader } from './export/TestMetricReader';

describe('MeterProvider lifecycle fanout characterization', () => {
  afterEach(() => {
    sinon.restore();
  });

  it('rejects, skips later readers, and becomes terminal during shutdown', async () => {
    const error = new Error('fieldwork metrics shutdown throw');
    const first = new TestMetricReader();
    const second = new TestMetricReader();
    let firstCalls = 0;
    let secondCalls = 0;

    sinon.stub(first, 'shutdown').callsFake(() => {
      firstCalls += 1;
      throw error;
    });
    sinon.stub(second, 'shutdown').callsFake(() => {
      secondCalls += 1;
      return Promise.resolve();
    });

    const provider = new MeterProvider({ readers: [first, second] });

    await assert.rejects(provider.shutdown(), /fieldwork metrics shutdown throw/);
    assert.strictEqual(firstCalls, 1);
    assert.strictEqual(secondCalls, 0);

    await provider.shutdown();
    assert.strictEqual(firstCalls, 1);
    assert.strictEqual(secondCalls, 0);
  });

  it('lets a concurrent second shutdown resolve before the first shutdown fails', async () => {
    const reader = new TestMetricReader();
    const error = new Error('fieldwork delayed metrics shutdown failure');
    let shutdownCalls = 0;
    let rejectShutdown: (reason: Error) => void = () => {};
    const delayedFailure = new Promise<void>((_resolve, reject) => {
      rejectShutdown = reject;
    });

    sinon.stub(reader, 'shutdown').callsFake(() => {
      shutdownCalls += 1;
      return delayedFailure;
    });

    const provider = new MeterProvider({ readers: [reader] });
    const firstShutdown = provider.shutdown();
    const secondShutdown = provider.shutdown();

    await secondShutdown;
    assert.strictEqual(shutdownCalls, 1);

    rejectShutdown(error);
    await assert.rejects(firstShutdown, error);
    assert.strictEqual(shutdownCalls, 1);
  });

  it('rejects and skips later readers during forceFlush', async () => {
    const error = new Error('fieldwork metrics forceFlush throw');
    const first = new TestMetricReader();
    const second = new TestMetricReader();
    let firstCalls = 0;
    let secondCalls = 0;

    sinon.stub(first, 'forceFlush').callsFake(() => {
      firstCalls += 1;
      throw error;
    });
    sinon.stub(second, 'forceFlush').callsFake(() => {
      secondCalls += 1;
      return Promise.resolve();
    });

    const provider = new MeterProvider({ readers: [first, second] });

    await assert.rejects(
      provider.forceFlush(),
      /fieldwork metrics forceFlush throw/
    );
    assert.strictEqual(firstCalls, 1);
    assert.strictEqual(secondCalls, 0);

    await provider.shutdown();
  });
});
