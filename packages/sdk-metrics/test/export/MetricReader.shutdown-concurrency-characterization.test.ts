/*
 * Copyright The OpenTelemetry Authors
 * SPDX-License-Identifier: Apache-2.0
 */

import * as assert from 'assert';
import { MetricReader } from '../../src';

class ControlledShutdownReader extends MetricReader {
  public shutdownCalls = 0;
  public shutdownResolvers: Array<() => void> = [];

  protected onForceFlush(): Promise<void> {
    return Promise.resolve();
  }

  protected onShutdown(): Promise<void> {
    this.shutdownCalls += 1;
    return new Promise<void>(resolve => {
      this.shutdownResolvers.push(resolve);
    });
  }
}

describe('MetricReader shutdown concurrency characterization', () => {
  it('starts onShutdown twice when shutdown is called concurrently', async () => {
    const reader = new ControlledShutdownReader();

    const firstShutdown = reader.shutdown();
    const secondShutdown = reader.shutdown();

    assert.strictEqual(reader.shutdownCalls, 2);
    assert.strictEqual(reader.shutdownResolvers.length, 2);

    for (const resolve of reader.shutdownResolvers) {
      resolve();
    }

    await Promise.all([firstShutdown, secondShutdown]);
    assert.strictEqual(reader.shutdownCalls, 2);
  });
});
