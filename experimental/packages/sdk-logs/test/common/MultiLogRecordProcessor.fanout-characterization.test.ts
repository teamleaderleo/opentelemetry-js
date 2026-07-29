/*
 * Copyright The OpenTelemetry Authors
 * SPDX-License-Identifier: Apache-2.0
 */

import * as assert from 'assert';
import type { LogRecordProcessor } from '../../src';
import { MultiLogRecordProcessor } from '../../src/MultiLogRecordProcessor';

describe('MultiLogRecordProcessor lifecycle fanout characterization', () => {
  it('rejects and skips later processors during shutdown', async () => {
    const error = new Error('fieldwork logs shutdown throw');
    let firstCalls = 0;
    let secondCalls = 0;

    const first: LogRecordProcessor = {
      onEmit() {},
      forceFlush: () => Promise.resolve(),
      shutdown: () => {
        firstCalls += 1;
        throw error;
      },
    };
    const second: LogRecordProcessor = {
      onEmit() {},
      forceFlush: () => Promise.resolve(),
      shutdown: () => {
        secondCalls += 1;
        return Promise.resolve();
      },
    };

    const processor = new MultiLogRecordProcessor([first, second]);

    await assert.rejects(processor.shutdown(), /fieldwork logs shutdown throw/);
    assert.strictEqual(firstCalls, 1);
    assert.strictEqual(secondCalls, 0);
  });

  it('rejects and skips later processors during forceFlush', async () => {
    const error = new Error('fieldwork logs forceFlush throw');
    let firstCalls = 0;
    let secondCalls = 0;

    const first: LogRecordProcessor = {
      onEmit() {},
      shutdown: () => Promise.resolve(),
      forceFlush: () => {
        firstCalls += 1;
        throw error;
      },
    };
    const second: LogRecordProcessor = {
      onEmit() {},
      shutdown: () => Promise.resolve(),
      forceFlush: () => {
        secondCalls += 1;
        return Promise.resolve();
      },
    };

    const processor = new MultiLogRecordProcessor([first, second]);

    await assert.rejects(
      processor.forceFlush(),
      /fieldwork logs forceFlush throw/
    );
    assert.strictEqual(firstCalls, 1);
    assert.strictEqual(secondCalls, 0);
  });
});
