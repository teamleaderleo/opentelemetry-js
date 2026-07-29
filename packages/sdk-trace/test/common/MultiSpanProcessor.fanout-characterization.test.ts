/*
 * Copyright The OpenTelemetry Authors
 * SPDX-License-Identifier: Apache-2.0
 */

import * as assert from 'assert';
import type { SpanProcessor } from '../../src';
import { MultiSpanProcessor } from '../../src/MultiSpanProcessor';

describe('MultiSpanProcessor lifecycle fanout characterization', () => {
  it('throws synchronously and skips later processors during shutdown', () => {
    const error = new Error('fieldwork trace shutdown throw');
    let firstCalls = 0;
    let secondCalls = 0;

    const first: SpanProcessor = {
      onStart() {},
      onEnd() {},
      forceFlush: () => Promise.resolve(),
      shutdown: () => {
        firstCalls += 1;
        throw error;
      },
    };
    const second: SpanProcessor = {
      onStart() {},
      onEnd() {},
      forceFlush: () => Promise.resolve(),
      shutdown: () => {
        secondCalls += 1;
        return Promise.resolve();
      },
    };

    const processor = new MultiSpanProcessor([first, second]);

    assert.throws(() => processor.shutdown(), /fieldwork trace shutdown throw/);
    assert.strictEqual(firstCalls, 1);
    assert.strictEqual(secondCalls, 0);
  });

  it('throws synchronously and skips later processors during forceFlush', () => {
    const error = new Error('fieldwork trace forceFlush throw');
    let firstCalls = 0;
    let secondCalls = 0;

    const first: SpanProcessor = {
      onStart() {},
      onEnd() {},
      shutdown: () => Promise.resolve(),
      forceFlush: () => {
        firstCalls += 1;
        throw error;
      },
    };
    const second: SpanProcessor = {
      onStart() {},
      onEnd() {},
      shutdown: () => Promise.resolve(),
      forceFlush: () => {
        secondCalls += 1;
        return Promise.resolve();
      },
    };

    const processor = new MultiSpanProcessor([first, second]);

    assert.throws(
      () => processor.forceFlush(),
      /fieldwork trace forceFlush throw/
    );
    assert.strictEqual(firstCalls, 1);
    assert.strictEqual(secondCalls, 0);
  });
});
