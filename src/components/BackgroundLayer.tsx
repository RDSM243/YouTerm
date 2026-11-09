import React, { useState } from 'react';
import type { BackgroundConfig } from '../types';
import { backgroundImageUrl } from '../services/background';

interface BackgroundLayerProps {
  config: BackgroundConfig;
  onReady: (revision: string, ready: boolean) => void;
}

export const BackgroundLayer = React.memo(function BackgroundLayer({ config, onReady }: BackgroundLayerProps) {
  const [loadedRevision, setLoadedRevision] = useState('');
  if (!config.enabled || !config.imageRevision) return null;
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 z-0 overflow-hidden"
      data-background-layer="" style={{ opacity: loadedRevision === config.imageRevision ? 1 : 0 }}>
      <img key={config.imageRevision} src={backgroundImageUrl(config.imageRevision)} alt="" draggable={false}
        className="absolute inset-0 h-full w-full object-cover" style={{ filter: `brightness(${config.brightness / 100})` }}
        onLoad={() => { setLoadedRevision(config.imageRevision); onReady(config.imageRevision, true); }}
        onError={() => { setLoadedRevision(''); onReady(config.imageRevision, false); }} />
      <div className="absolute inset-0 bg-black" style={{ opacity: config.darkness / 100 }} />
    </div>
  );
});
