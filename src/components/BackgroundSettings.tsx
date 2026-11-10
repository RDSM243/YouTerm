import React, { useRef, useState } from 'react';
import { Image, Trash2, Upload } from 'lucide-react';
import type { BackgroundConfig, ThemeConfig } from '../types';
import { backgroundImageUrl, DEFAULT_BACKGROUND, importBackgroundImage, removeBackgroundImage } from '../services/background';

interface BackgroundSettingsProps {
  theme: ThemeConfig;
  config: BackgroundConfig;
  onChange: (change: Partial<BackgroundConfig>) => void;
}

export function BackgroundSettings({ theme, config, onChange }: BackgroundSettingsProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [failedRevision, setFailedRevision] = useState('');
  const hasImage = !!config.imageRevision;
  const panelStyle = { borderColor: theme.border, backgroundColor: theme.bg, color: theme.text };
  const buttonClass = 'flex items-center gap-1.5 border px-3 py-1.5 hover:brightness-125 disabled:opacity-40';
  const update = (change: Partial<BackgroundConfig>) => {
    try { onChange(change); setStatus('Background preferences saved.'); }
    catch { setStatus('Background preferences could not be saved. Check the available storage space.'); }
  };

  return (
    <fieldset disabled={busy} className="flex min-w-0 flex-col gap-4 border p-3" style={panelStyle}>
      <legend className="px-1 font-bold" style={{ color: theme.highlight }}>Background image</legend>
      <p className="text-[11px]" style={{ color: theme.textDim }}>Choose a wallpaper and adjust how it appears behind your music.</p>
      <div className="flex flex-wrap gap-2">
        <button type="button" className={buttonClass} style={panelStyle} onClick={() => fileRef.current?.click()}>
          <Upload aria-hidden="true" className="h-3 w-3" />{busy ? 'Saving…' : hasImage ? 'Change image' : 'Choose image'}
        </button>
        <button type="button" className={buttonClass} style={panelStyle} disabled={!hasImage} onClick={async () => {
          setBusy(true); setStatus('');
          try {
            await removeBackgroundImage();
            onChange({ enabled: false, imageRevision: '', imageName: '' });
            setStatus('Background image removed.');
          } catch (error) { setStatus(error instanceof Error ? error.message : 'Could not remove the background.'); }
          finally { setBusy(false); }
        }}><Trash2 aria-hidden="true" className="h-3 w-3" />Remove image</button>
        <input ref={fileRef} aria-label="Choose background image" type="file" accept="image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp" className="hidden"
          onChange={async event => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (!file) return;
            setBusy(true); setStatus('');
            try {
              const imageRevision = await importBackgroundImage(file);
              onChange({ enabled: true, imageRevision, imageName: file.name });
              setStatus('Background image saved.');
            } catch (error) { setStatus(error instanceof Error ? error.message : 'Could not import the background.'); }
            finally { setBusy(false); }
          }} />
      </div>
      {hasImage ? <div className="flex min-w-0 flex-col gap-2">
        <div className="relative h-32 overflow-hidden border" style={{ borderColor: theme.border }}>
          <img key={config.imageRevision} src={backgroundImageUrl(config.imageRevision)} alt="Background preview" className="h-full w-full object-cover"
            style={{ filter: `brightness(${config.brightness / 100})` }}
            onError={() => setFailedRevision(config.imageRevision)} onLoad={() => setFailedRevision('')} />
          <div aria-hidden="true" className="absolute inset-0 bg-black" style={{ opacity: config.darkness / 100 }} />
          <span className="absolute bottom-2 left-2 border px-2 py-1 text-[11px]" style={{ borderColor: theme.border, backgroundColor: theme.cardBg, color: theme.highlight }}>YouTerm</span>
        </div>
        <span className="truncate text-[10px]" title={config.imageName} style={{ color: theme.textDim }}>{config.imageName || 'Custom background'}</span>
        {failedRevision === config.imageRevision && <p role="status" style={{ color: theme.warning }}>This background is unavailable. Choose the image again.</p>}
      </div> : <div className="flex items-center gap-2 border border-dashed p-4 text-[11px]" style={{ borderColor: theme.border, color: theme.textDim }}>
        <Image aria-hidden="true" className="h-4 w-4 shrink-0" />PNG, JPEG or WebP · up to 12 MB
      </div>}
      <label className="flex items-center gap-3">
        <input aria-label="Show background image" type="checkbox" checked={config.enabled} disabled={!hasImage}
          onChange={event => update({ enabled: event.target.checked })} style={{ accentColor: theme.accent }} />
        <span>Show background image</span>
      </label>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {([
          ['brightness', 'Image brightness', 200, '%'],
          ['darkness', 'Dark overlay', 100, '%'],
          ['panelOpacity', 'Panel opacity', 100, '%'],
        ] as const).map(([field, label, max, unit]) => <label key={field} className="flex min-w-0 flex-col gap-2">
          <span className="flex justify-between gap-2 text-[11px]"><span style={{ color: theme.textDim }}>{label}</span>
            <span style={{ color: theme.accent }}>{config[field]}{unit}</span></span>
          <input aria-label={label} type="range" min={0} max={max} step={1} value={config[field]} disabled={!hasImage}
            onChange={event => update({ [field]: Number(event.target.value) })} style={{ accentColor: theme.accent }} />
        </label>)}
      </div>
      <div className="flex flex-col gap-3 border-t pt-3" style={{ borderColor: theme.border }}>
        <p className="font-bold text-[11px]" style={{ color: theme.textDim }}>Also show background in</p>
        {([
          ['showInSidebar', 'Sidebar'],
          ['showInPlayer', 'Player bar'],
          ['showInSpectrum', 'Spectrum'],
        ] as const).map(([field, label]) => <label key={field} className="flex items-center gap-3">
          <input aria-label={`Show background in ${label}`} type="checkbox" checked={config[field]} disabled={!hasImage}
            onChange={event => update({ [field]: event.target.checked })} style={{ accentColor: theme.accent }} />
          <span>{label}</span>
        </label>)}
      </div>
      <button type="button" className={`${buttonClass} self-start`} style={panelStyle}
        onClick={() => update({ ...DEFAULT_BACKGROUND, enabled: hasImage, imageRevision: config.imageRevision, imageName: config.imageName })}>Reset background settings</button>
      {status && <p role="status" className="text-[11px]" style={{ color: theme.accent }}>{status}</p>}
    </fieldset>
  );
}
