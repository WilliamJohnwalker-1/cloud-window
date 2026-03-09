import React from 'react';
import { encodeEAN13Bars, isValidEAN13 } from '../utils/barcode';

interface BarcodePreviewProps {
  code?: string;
}

export const BarcodePreview: React.FC<BarcodePreviewProps> = ({ code }) => {
  if (!code || !isValidEAN13(code)) return null;

  const { bars, totalWidth } = encodeEAN13Bars(code, 1.3);

  return (
    <div className="mt-2 bg-white rounded-md px-2 py-1.5">
      <svg width="100%" height="42" viewBox={`0 0 ${totalWidth} 42`} preserveAspectRatio="none">
        <title>EAN-13 Barcode</title>
        {bars.map((bar) => (
          <rect key={`${bar.x}-${bar.w}`} x={bar.x} y={0} width={bar.w} height={34} fill="#111" />
        ))}
      </svg>
      <p className="text-[10px] leading-none text-center tracking-[0.16em] text-black/80 font-mono">{code}</p>
    </div>
  );
};
