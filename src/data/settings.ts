import type { AsciiRenderMode } from '../types';

export const COVER_MODES: { id: AsciiRenderMode; label: string }[] = [
  { id: 'original_hd', label: 'Original image (HD)' },
  { id: 'half_block', label: 'ANSI half-block (TrueColor)' },
  { id: 'braille', label: 'Braille matrix' },
  { id: 'matrix_code', label: 'Matrix code' },
  { id: 'retro_crt', label: 'Retro monochrome CRT' },
];
