import type { ReactNode } from 'react';
import { View } from 'react-native';

import { chunkIntoRows } from '@/constants/trade-list-layout';

interface EqualGridProps<T> {
  items: readonly T[];
  columns: number;
  gap?: number;
  renderItem: (item: T, index: number) => ReactNode;
  keyExtractor: (item: T, index: number) => string;
}

/**
 * A fixed-column grid where every cell — in every row, including a short final one — is exactly the
 * same width. Plain `flex-row flex-wrap` can't do this: a partial last row's items are only as wide as
 * their own content (or stretch unevenly if also `flex-1`), so they never actually line up under the
 * columns above them. This pads a short final row with empty `flex-1` spacers instead, so every column
 * — full row or not — is the same width and both outer edges stay flush with the container.
 *
 * Reuses `chunkIntoRows` (constants/trade-list-layout.ts), the same row-chunking `TradeListCard` uses
 * for the "Share trade list" export, so every N-column grid in the app agrees on what "row" means.
 */
export function EqualGrid<T>({ items, columns, gap = 8, renderItem, keyExtractor }: EqualGridProps<T>) {
  const rows = chunkIntoRows(items, columns);

  return (
    <View style={{ gap }}>
      {rows.map((row, rowIndex) => (
        <View key={rowIndex} className="flex-row" style={{ gap }}>
          {row.map((item, i) => {
            const index = rowIndex * columns + i;
            return (
              <View key={keyExtractor(item, index)} className="min-w-0 flex-1">
                {renderItem(item, index)}
              </View>
            );
          })}
          {/* Short final row: pad out the missing columns with bare spacers so `row`'s real cells stay
           *  exactly as wide as every full row's, instead of `flex-1` stretching them to fill the gap. */}
          {Array.from({ length: columns - row.length }, (_, i) => (
            <View key={`spacer-${i}`} className="flex-1" />
          ))}
        </View>
      ))}
    </View>
  );
}
