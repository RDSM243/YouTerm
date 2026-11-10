import type { LibraryCategory } from '../types';

export const LIBRARY_ITEMS: { id: LibraryCategory; label: string }[] = [
  { id: 'explore', label: 'Explore & Trending' },
  { id: 'made_for_you', label: 'Made For You' },
  { id: 'recently_played', label: 'Recently Played' },
  { id: 'liked_songs', label: 'Liked Songs' },
  { id: 'albums', label: 'Albums & EP' },
  { id: 'artists', label: 'Artists' },
  { id: 'podcasts', label: 'Podcasts & Ambient' },
];
