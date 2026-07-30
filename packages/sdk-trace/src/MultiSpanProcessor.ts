/*
 * Copyright The OpenTelemetry Authors
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Context } from '@opentelemetry/api';
import { globalErrorHandler } from '@opentelemetry/core';
import type { ReadableSpan } from './export/ReadableSpan';
import type { Span } from './Span';
import type { SpanProcessor } from './SpanProcessor';

/**
 * Implementation of the {@link SpanProcessor} that simply forwards all
 * received events to a list of {@link SpanProcessor}s.
 */
export class MultiSpanProcessor implements SpanProcessor {
  private readonly _spanProcessors: SpanProcessor[];
  constructor(spanProcessors: SpanProcessor[]) {
    this._spanProcessors = spanProcessors;
  }

  forceFlush(): Promise<void> {
    const spanProcessors = this._spanProcessors.slice();
    const promises = spanProcessors.map(spanProcessor =>
      callLifecycle(() => spanProcessor.forceFlush())
    );

    return Promise.all(promises).then(
      () => {},
      error => {
        globalErrorHandler(
          error || new Error('MultiSpanProcessor: forceFlush failed')
        );
      }
    );
  }

  onStart(span: Span, context: Context): void {
    for (const spanProcessor of this._spanProcessors) {
      spanProcessor.onStart(span, context);
    }
  }

  onEnding(span: Span): void {
    for (const spanProcessor of this._spanProcessors) {
      if (spanProcessor.onEnding) {
        spanProcessor.onEnding(span);
      }
    }
  }

  onEnd(span: ReadableSpan): void {
    for (const spanProcessor of this._spanProcessors) {
      spanProcessor.onEnd(span);
    }
  }

  shutdown(): Promise<void> {
    const spanProcessors = this._spanProcessors.slice();
    return Promise.all(
      spanProcessors.map(spanProcessor =>
        callLifecycle(() => spanProcessor.shutdown())
      )
    ).then(() => {});
  }
}

function callLifecycle(callback: () => Promise<void>): Promise<void> {
  try {
    return callback();
  } catch (error) {
    return Promise.reject(error);
  }
}
