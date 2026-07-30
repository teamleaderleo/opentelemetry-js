/*
 * Copyright The OpenTelemetry Authors
 * SPDX-License-Identifier: Apache-2.0
 */

import * as assert from 'assert';
import * as sinon from 'sinon';
import { MeterProvider } from '../src';
import { TestMetricReader } from './export/TestMetricReader';

describe('MeterProvider shared shutdown and attempt-all composition', () => {
  afterEach(() => {
    sinon.restore();
  });

  it('shares one rejection after attempting every reader', async () => {
    const error = new Error('fieldwork metrics shutdown failure');
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
    const firstShutdown = provider.shutdown({ timeoutMillis: 10 });
    const secondShutdown = provider.shutdown({ timeoutMillis: 1000 });

    assert.strictEqual(firstShutdown, secondShutdown);
    await assert.rejects(firstShutdown, candidate => candidate === error);
    await assert.rejects(secondShutdown, candidate => candidate === error);
    assert.strictEqual(firstCalls, 1);
    assert.strictEqual(secondCalls, 1);
  });

  it('rejects forceFlush after attempting every reader', async () => {
    const error = new Error('fieldwork metrics forceFlush failure');
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
      candidate => candidate === error
    );
    assert.strictEqual(firstCalls, 1);
    assert.strictEqual(secondCalls, 1);

    sinon.restore();
    await provider.shutdown();
  });
});
