/*
 * Copyright The OpenTelemetry Authors
 * SPDX-License-Identifier: Apache-2.0
 */

import * as assert from 'assert';
import * as sinon from 'sinon';
import { MeterProvider } from '../src';
import { TestMetricReader } from './export/TestMetricReader';

type MutableCollectorState = {
  _sharedState: {
    metricCollectors: unknown[];
  };
};

function getMutableCollectors(provider: MeterProvider): unknown[] {
  return (provider as unknown as MutableCollectorState)._sharedState
    .metricCollectors;
}

describe('MeterProvider attempt-all lifecycle', () => {
  afterEach(() => {
    sinon.restore();
  });

  it('rejects shutdown after attempting every reader', async () => {
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

    await assert.rejects(provider.shutdown(), candidate => candidate === error);
    assert.strictEqual(firstCalls, 1);
    assert.strictEqual(secondCalls, 1);
  });

  it('uses the opening collector snapshot during shutdown', async () => {
    const first = new TestMetricReader();
    const second = new TestMetricReader();
    let removeSecond: () => void = () => {
      throw new Error('collector mutation was not initialized');
    };
    let secondCalls = 0;

    sinon.stub(first, 'shutdown').callsFake(() => {
      removeSecond();
      return Promise.resolve();
    });
    sinon.stub(second, 'shutdown').callsFake(() => {
      secondCalls += 1;
      return Promise.resolve();
    });

    const provider = new MeterProvider({ readers: [first, second] });
    const collectors = getMutableCollectors(provider);
    removeSecond = () => {
      collectors.splice(1, 1);
    };

    await provider.shutdown();

    assert.strictEqual(secondCalls, 1);
    assert.strictEqual(collectors.length, 1);
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

  it('uses the opening collector snapshot during forceFlush', async () => {
    const first = new TestMetricReader();
    const second = new TestMetricReader();
    let removeSecond: () => void = () => {
      throw new Error('collector mutation was not initialized');
    };
    let removedCollector: unknown;
    let secondCalls = 0;

    sinon.stub(first, 'forceFlush').callsFake(() => {
      removeSecond();
      return Promise.resolve();
    });
    sinon.stub(second, 'forceFlush').callsFake(() => {
      secondCalls += 1;
      return Promise.resolve();
    });

    const provider = new MeterProvider({ readers: [first, second] });
    const collectors = getMutableCollectors(provider);
    removeSecond = () => {
      [removedCollector] = collectors.splice(1, 1);
    };

    await provider.forceFlush();

    assert.strictEqual(secondCalls, 1);
    assert.strictEqual(collectors.length, 1);

    if (removedCollector !== undefined) {
      collectors.push(removedCollector);
    }
    sinon.restore();
    await provider.shutdown();
  });
});
