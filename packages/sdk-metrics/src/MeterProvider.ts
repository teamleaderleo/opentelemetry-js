/*
 * Copyright The OpenTelemetry Authors
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  MeterProvider as IMeterProvider,
  Meter as IMeter,
  MeterOptions,
} from '@opentelemetry/api';
import { diag, createNoopMeter } from '@opentelemetry/api';
import { BindOnceFuture } from '@opentelemetry/core';
import type { Resource } from '@opentelemetry/resources';
import { defaultResource } from '@opentelemetry/resources';
import { MetricReader, type IMetricReader } from './export/MetricReader';
import { MeterProviderSharedState } from './state/MeterProviderSharedState';
import { MetricCollector } from './state/MetricCollector';
import type { ForceFlushOptions, ShutdownOptions } from './types';
import type { ViewOptions } from './view/View';
import { View } from './view/View';

/**
 * MeterProviderOptions provides an interface for configuring a MeterProvider.
 */
export interface MeterProviderOptions {
  /** Resource associated with metric telemetry  */
  resource?: Resource;
  views?: ViewOptions[];
  readers?: IMetricReader[];

  /**
   * Whether to enable SDK metrics for this meter provider.
   * @experimental This option is experimental and is subject to breaking changes in minor releases.
   */
  sdkMetricsEnabled?: boolean;
}

/**
 * This class implements the {@link MeterProvider} interface.
 */
export class MeterProvider implements IMeterProvider {
  private _sharedState: MeterProviderSharedState;
  private readonly _shutdownOnce: BindOnceFuture<
    void,
    MeterProvider,
    (options?: ShutdownOptions) => Promise<void>
  >;
  private _shutdownInvocationActive = false;

  constructor(options?: MeterProviderOptions) {
    this._sharedState = new MeterProviderSharedState(
      options?.resource ?? defaultResource()
    );
    this._shutdownOnce = new BindOnceFuture(this._shutdown, this);

    if (options?.views != null && options.views.length > 0) {
      for (const viewOption of options.views) {
        this._sharedState.viewRegistry.addView(new View(viewOption));
      }
    }

    if (options?.readers != null && options.readers.length > 0) {
      for (const metricReader of options.readers) {
        const collector = new MetricCollector(this._sharedState, metricReader);
        metricReader.setMetricProducer(collector);
        this._sharedState.metricCollectors.push(collector);
        if (options.sdkMetricsEnabled && metricReader instanceof MetricReader) {
          metricReader._setSelfObsMeterProvider(this);
        }
      }
    }
  }

  /**
   * Get a meter with the configuration of the MeterProvider.
   */
  getMeter(name: string, version = '', options: MeterOptions = {}): IMeter {
    // https://github.com/open-telemetry/opentelemetry-specification/blob/main/specification/metrics/sdk.md#meter-creation
    if (this._shutdownOnce.isCalled) {
      diag.warn('A shutdown MeterProvider cannot provide a Meter');
      return createNoopMeter();
    }

    return this._sharedState.getMeterSharedState({
      name,
      version,
      schemaUrl: options.schemaUrl,
    }).meter;
  }

  /**
   * Shut down the MeterProvider and all registered
   * MetricReaders.
   *
   * Returns a promise which is resolved when all flushes are complete.
   */
  shutdown(options?: ShutdownOptions): Promise<void> {
    if (this._shutdownInvocationActive) {
      diag.warn('recursive MeterProvider shutdown is ignored');
      return Promise.resolve();
    }
    if (this._shutdownOnce.isCalled) {
      diag.warn('shutdown may only be called once per MeterProvider');
      return this._shutdownOnce.promise;
    }
    return this._shutdownOnce.call(options);
  }

  private _shutdown(options?: ShutdownOptions): Promise<void> {
    this._shutdownInvocationActive = true;
    try {
      return Promise.all(
        this._sharedState.metricCollectors.map(collector => {
          return collector.shutdown(options);
        })
      ).then(() => {});
    } finally {
      this._shutdownInvocationActive = false;
    }
  }

  /**
   * Notifies all registered MetricReaders to flush any buffered data.
   *
   * Returns a promise which is resolved when all flushes are complete.
   */
  forceFlush(options?: ForceFlushOptions): Promise<void> {
    if (this._shutdownInvocationActive) {
      diag.warn('cannot force flush recursively during MeterProvider shutdown');
      return Promise.resolve();
    }
    // do not flush after shutdown
    if (this._shutdownOnce.isCalled) {
      diag.warn('invalid attempt to force flush after MeterProvider shutdown');
      return this._shutdownOnce.promise;
    }

    return Promise.all(
      this._sharedState.metricCollectors.map(collector => {
        return collector.forceFlush(options);
      })
    ).then(() => {});
  }
}
