/*
 * Copyright The OpenTelemetry Authors
 * SPDX-License-Identifier: Apache-2.0
 */

import * as assert from 'assert';
import { MeterProvider } from '../src';
import { TestMetricReader } from './export/TestMetricReader';

describe('MeterProvider cached meter shutdown characterization', () => {
  it('allows a cached meter and instrument to write collectable storage after shutdown', async () => {
    const reader = new TestMetricReader();
    const provider = new MeterProvider({ readers: [reader] });
    const cachedMeter = provider.getMeter('fieldwork-cached-meter');
    const cachedCounter = cachedMeter.createCounter('created-before-shutdown');

    await provider.shutdown();

    cachedCounter.add(1);
    cachedMeter.createCounter('created-after-shutdown').add(2);

    const result = await reader.getMetricCollector().collect();
    const metrics = result.resourceMetrics.scopeMetrics.flatMap(
      scopeMetrics => scopeMetrics.metrics
    );
    const before = metrics.find(
      metric => metric.descriptor.name === 'created-before-shutdown'
    );
    const after = metrics.find(
      metric => metric.descriptor.name === 'created-after-shutdown'
    );

    assert.ok(before);
    assert.ok(after);
    assert.strictEqual(before.dataPoints[0].value, 1);
    assert.strictEqual(after.dataPoints[0].value, 2);
  });
});
