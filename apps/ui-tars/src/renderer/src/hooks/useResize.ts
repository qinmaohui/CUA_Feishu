import { useCallback, useRef, useState } from 'react';

type Edge = 'n' | 's' | 'e' | 'w' | 'nw' | 'ne' | 'sw' | 'se';

interface UseResizeOptions {
  initialWidth: number;
  initialHeight: number;
  minWidth?: number;
  minHeight?: number;
  maxWidth?: number;
  maxHeight?: number;
}

interface ResizeHandleProps {
  onMouseDown: (e: React.MouseEvent) => void;
  style: React.CSSProperties;
}

export function useResize(options: UseResizeOptions) {
  const {
    initialWidth,
    initialHeight,
    minWidth = 400,
    minHeight = 300,
    maxWidth = typeof window !== 'undefined' ? window.innerWidth - 40 : 1600,
    maxHeight = typeof window !== 'undefined' ? window.innerHeight - 40 : 1200,
  } = options;

  const [size, setSize] = useState({
    width: initialWidth,
    height: initialHeight,
  });
  const sizeRef = useRef(size);

  const getResizeHandleProps = useCallback(
    (edge: Edge): ResizeHandleProps => {
      const styleMap: Record<Edge, React.CSSProperties> = {
        n: { top: -3, left: 0, right: 0, height: 6, cursor: 'ns-resize' },
        s: { bottom: -3, left: 0, right: 0, height: 6, cursor: 'ns-resize' },
        e: { top: 0, right: -3, bottom: 0, width: 6, cursor: 'ew-resize' },
        w: { top: 0, left: -3, bottom: 0, width: 6, cursor: 'ew-resize' },
        nw: { top: -3, left: -3, width: 10, height: 10, cursor: 'nwse-resize' },
        ne: {
          top: -3,
          right: -3,
          width: 10,
          height: 10,
          cursor: 'nesw-resize',
        },
        sw: {
          bottom: -3,
          left: -3,
          width: 10,
          height: 10,
          cursor: 'nesw-resize',
        },
        se: {
          bottom: -3,
          right: -3,
          width: 10,
          height: 10,
          cursor: 'nwse-resize',
        },
      };

      return {
        onMouseDown: (e: React.MouseEvent) => {
          e.preventDefault();
          e.stopPropagation();

          const startX = e.clientX;
          const startY = e.clientY;
          const startW = sizeRef.current.width;
          const startH = sizeRef.current.height;

          const onMouseMove = (ev: MouseEvent) => {
            const dx = ev.clientX - startX;
            const dy = ev.clientY - startY;

            let newW = startW;
            let newH = startH;

            if (edge.includes('e')) newW = startW + dx;
            if (edge.includes('w')) newW = startW - dx;
            if (edge.includes('s')) newH = startH + dy;
            if (edge.includes('n')) newH = startH - dy;

            newW = Math.max(minWidth, Math.min(maxWidth, newW));
            newH = Math.max(minHeight, Math.min(maxHeight, newH));

            const newSize = { width: newW, height: newH };
            sizeRef.current = newSize;
            setSize(newSize);
          };

          const onMouseUp = () => {
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
          };

          document.addEventListener('mousemove', onMouseMove);
          document.addEventListener('mouseup', onMouseUp);
        },
        style: {
          position: 'absolute' as const,
          zIndex: 50,
          touchAction: 'none',
          ...styleMap[edge],
        },
      };
    },
    [minWidth, minHeight, maxWidth, maxHeight],
  );

  return { size, getResizeHandleProps };
}
