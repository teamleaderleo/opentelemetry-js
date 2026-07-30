/*
 * Copyright The OpenTelemetry Authors
 * SPDX-License-Identifier: Apache-2.0
 */

import * as assert from 'assert';
import type { LogRecordProcessor } from '../../src';
import { LoggerProvider } from '../../src';

describe('LoggerProvider shutdown reentry', () => {
  it('contains direct recursive shutdown from a processor', async () => {
    let shutdownCalls = 0;
    let recursiveShutdown: Promise<void> | undefined;
    const processor: LogRecordProcessor = {
      onEmit() {},
      forceFlush: () => Promise.resolve(),
      shutdown: () => {
        shutdownCalls += 1;
        recursiveShutdown = provider.shutdown();
        return recursiveShutdown;
      },
    };
    const provider = new LoggerProvider({ processors: [processor] });

    await provider.shutdown();
    assert.ok(recursiveShutdown);
    await recursiveShutdown;

    assert.strictEqual(shutdownCalls, 1);
  });

  it('contains direct force flush from processor shutdown', async () => {
    let forceFlushCalls = 0;
    let recursiveForceFlush: Promise<void> | undefined;
    const processor: LogRecordProcessor = {
      onEmit() {},
      forceFlush: () => {
        forceFlushCalls += 1;
        return Promise.resolve();
      },
      shutdown: () => {
        recursiveForceFlush = provider.forceFlush();
        return recursiveForceFlush;
      },
    };
    const provider = new LoggerProvider({ processors: [processor] });

    await provider.shutdown();
    assert.ok(recursiveForceFlush);
    await recursiveForceFlush;

    assert.strictEqual(forceFlushCalls, 0);
  });
});
