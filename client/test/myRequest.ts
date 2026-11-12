import type { MyRequest } from '../src/api/types';

/** One of the user's requests (GET /Lumen/Requests/Mine), downloading The Matrix unless told otherwise. */
export function myRequest(overrides: Partial<MyRequest> & { key?: string; title?: string } = {}): MyRequest {
  const { key = 'movie-603', title = 'The Matrix', ...rest } = overrides;
  const [mediaType, id] = key.split('-');
  return {
    RequestIds: [Number(id)],
    Item: {
      Key: key,
      MediaType: mediaType as 'movie' | 'tv',
      TmdbId: Number(id),
      Title: title,
      GenreNames: [],
      State: 'Requested',
    },
    Status: 'Downloading',
    Percent: 40,
    SecondsLeft: 600,
    Announce: false,
    ...rest,
  };
}
