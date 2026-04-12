// ============================================================
// VirtualList — efficient rendering for large item counts
// Uses a simple window-based virtualisation approach.
// ============================================================

import React, { useRef, useState, useEffect, useCallback } from 'react';

interface VirtualListProps<T> {
  items: T[];
  itemHeight: number;        // Fixed row height in px
  containerHeight: number;   // Visible window height in px
  overscan?: number;         // Extra rows to render outside view (default: 3)
  renderItem: (item: T, index: number) => React.ReactNode;
  keyExtractor: (item: T, index: number) => string;
  id?: string;
}

/**
 * Lightweight virtualised list that only renders rows in the visible viewport
 * plus an overscan buffer. Supports fixed-height rows only.
 */
export function VirtualList<T>({
  items,
  itemHeight,
  containerHeight,
  overscan = 3,
  renderItem,
  keyExtractor,
  id,
}: VirtualListProps<T>) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);

  const handleScroll = useCallback(() => {
    if (containerRef.current) {
      setScrollTop(containerRef.current.scrollTop);
    }
  }, []);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    el.addEventListener('scroll', handleScroll, { passive: true });
    return () => el.removeEventListener('scroll', handleScroll);
  }, [handleScroll]);

  const totalHeight = items.length * itemHeight;

  // Calculate visible window
  const startIndex = Math.max(0, Math.floor(scrollTop / itemHeight) - overscan);
  const visibleCount = Math.ceil(containerHeight / itemHeight) + overscan * 2;
  const endIndex = Math.min(items.length - 1, startIndex + visibleCount);

  const visibleItems = items.slice(startIndex, endIndex + 1);
  const paddingTop = startIndex * itemHeight;
  const paddingBottom = Math.max(0, (items.length - 1 - endIndex) * itemHeight);

  return (
    <div
      ref={containerRef}
      id={id}
      style={{
        height: containerHeight,
        overflowY: 'auto',
        overflowX: 'hidden',
        position: 'relative',
      }}
    >
      {/* Total height spacer */}
      <div style={{ height: totalHeight, position: 'relative' }}>
        {/* Padding above visible items */}
        <div style={{ height: paddingTop }} />

        {visibleItems.map((item, localIdx) => {
          const globalIdx = startIndex + localIdx;
          return (
            <div
              key={keyExtractor(item, globalIdx)}
              style={{ height: itemHeight, overflow: 'hidden' }}
            >
              {renderItem(item, globalIdx)}
            </div>
          );
        })}

        {/* Padding below visible items */}
        <div style={{ height: paddingBottom }} />
      </div>
    </div>
  );
}
