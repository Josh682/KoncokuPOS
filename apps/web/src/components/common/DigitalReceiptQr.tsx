import React, { useMemo } from 'react';
import { generateQrMatrix } from '../../utils/qrCode';

interface DigitalReceiptQrProps {
  url: string;
  size?: number;
  className?: string;
}

export const DigitalReceiptQr: React.FC<DigitalReceiptQrProps> = ({
  url,
  size = 140,
  className = '',
}) => {
  const matrix = useMemo(() => {
    try {
      return generateQrMatrix(url);
    } catch (err) {
      console.warn('Failed to generate local QR matrix:', err);
      return [];
    }
  }, [url]);

  if (matrix.length === 0) {
    return (
      <div
        data-testid="digital-receipt-qr-fallback"
        className={`flex items-center justify-center bg-stone-100 rounded-xl text-stone-600 font-mono text-[10px] ${className}`}
        style={{ width: size, height: size }}
      >
        QR CODE
      </div>
    );
  }

  const moduleCount = matrix.length;
  const padding = 2; // Quiet zone modules
  const viewBoxSize = moduleCount + padding * 2;

  return (
    <div
      data-testid="digital-receipt-qr"
      className={`inline-block bg-white p-2 rounded-xl shadow-sm border border-stone-200 ${className}`}
    >
      <svg
        viewBox={`0 0 ${viewBoxSize} ${viewBoxSize}`}
        width={size}
        height={size}
        shapeRendering="crispEdges"
        className="block"
      >
        <rect width={viewBoxSize} height={viewBoxSize} fill="#ffffff" />
        {matrix.map((row, r) =>
          row.map((isDark, c) =>
            isDark ? (
              <rect
                key={`${r}-${c}`}
                x={c + padding}
                y={r + padding}
                width={1}
                height={1}
                fill="#1c1917" // stone-900
              />
            ) : null
          )
        )}
      </svg>
    </div>
  );
};
