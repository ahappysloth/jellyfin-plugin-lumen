/** Subsets of Jellyfin DTOs (PascalCase, as served). Only fields Lumen reads are listed. */
export interface UserData {
  PlaybackPositionTicks?: number;
  PlayedPercentage?: number;
  Played?: boolean;
  IsFavorite?: boolean;
  UnplayedItemCount?: number;
  /** When the user last played it (ISO); absent if never. */
  LastPlayedDate?: string;
}

export interface MediaStream {
  Type?: string;
  Codec?: string;
  Profile?: string;
  Width?: number;
  Height?: number;
  VideoRange?: string;
  VideoRangeType?: string;
  Channels?: number;
  Title?: string;
  DisplayTitle?: string;
  Index?: number;
  /** The codec's fourcc in its container (`hvc1`, `hev1`, `avc1`); absent for Matroska. */
  CodecTag?: string;
  /** ffprobe's level: 41 for H.264 4.1, 150 for HEVC 5.0 (level × 30), the seq_level_idx for AV1. */
  Level?: number;
  BitDepth?: number;
  BitRate?: number;
}

/** One version of a video item (Jellyfin's MediaSourceInfo). */
export interface MediaSourceInfo {
  Id?: string;
  /** ffprobe's format, normalized and comma-separated: `mov,mp4,m4a,3gp,3g2,mj2`, `mkv`, `mkv,webm`, `ts`. */
  Container?: string;
  DefaultAudioStreamIndex?: number;
  /** False when this user may not transcode: the server would then copy the video whatever was asked. */
  SupportsTranscoding?: boolean;
  MediaStreams?: MediaStream[];
  /** The file's size in bytes. */
  Size?: number;
}

export interface Person {
  Id: string;
  Name: string;
  Role?: string;
  Type?: string;
  PrimaryImageTag?: string;
}

export interface BaseItem {
  Id: string;
  Name: string;
  Type: string;
  /** Video, Audio, Photo, Book, Unknown. */
  MediaType?: string;
  IsFolder?: boolean;
  ServerId?: string;
  Overview?: string;
  ProductionYear?: number;
  OfficialRating?: string;
  CommunityRating?: number;
  RunTimeTicks?: number;
  ImageTags?: Record<string, string | undefined>;
  BackdropImageTags?: string[];
  ParentBackdropItemId?: string;
  ParentBackdropImageTags?: string[];
  ParentLogoItemId?: string;
  ParentLogoImageTag?: string;
  ParentThumbItemId?: string;
  ParentThumbImageTag?: string;
  SeriesId?: string;
  SeriesName?: string;
  SeasonId?: string;
  SeasonName?: string;
  IndexNumber?: number;
  ParentIndexNumber?: number;
  LocalTrailerCount?: number;
  /** Single-item fetches: whether this user may download the item's file (their policy, and it being a file). */
  CanDownload?: boolean;
  /** The file's path on the server; single-item fetches. */
  Path?: string;
  UserData?: UserData;
  MediaStreams?: MediaStream[];
  /**
   * Sent only when asked for (a single-item fetch has them all); Lumen only checks they are there before handing the
   * item to jellyfin-web's player (playback/play.ts canPlayAsIs).
   */
  Chapters?: unknown[];
  MediaSources?: MediaSourceInfo[];
  Trickplay?: Record<string, unknown>;
  People?: Person[];
  Genres?: string[];
  /** Library views only: `movies`, `tvshows`, `music`, … (absent for mixed folders). */
  CollectionType?: string;
  ChildCount?: number;
  /** A person's birth date (Jellyfin stores it as the premiere date). */
  PremiereDate?: string;
  /** A person's death date. */
  EndDate?: string;
  /** A person's birthplace. */
  ProductionLocations?: string[];
}

export interface ItemsResult {
  Items: BaseItem[];
  TotalRecordCount?: number;
}

/** One row of GET /Movies/Recommendations. */
export interface MovieRecommendation {
  Items: BaseItem[];
  /** SimilarToRecentlyPlayed, SimilarToLikedItem, HasDirectorFromRecentlyPlayed, HasActorFromRecentlyPlayed, … */
  RecommendationType: string;
  /** The movie or person the row is based on. */
  BaselineItemName?: string;
  CategoryId?: string;
}

export interface HomeRow {
  Id: string;
  Type: string;
  Title: string;
  Items: BaseItem[];
  /**
   * Catalog rows (Trending, My Requests, …; requests spec §3): one ordered list mixing library titles (Item) and
   * titles the server doesn't have (Catalog). Their Items is empty; other rows leave this out.
   */
  Entries?: HomeRowEntry[] | null;
  /**
   * Where the row's titles came from when that isn't what its type says: "Seerr" for a Top 10 row showing Seerr's
   * trending list because Trakt has none to give yet (it has no Top chart to "See all" of).
   */
  Source?: string | null;
}

export interface HomeRowEntry {
  Item?: BaseItem | null;
  Catalog?: CatalogItem | null;
}

/** A Top charts title: its true Trakt rank (gaps where a title can't be shown) and its card. */
export interface ChartEntry {
  Rank: number;
  Item?: BaseItem | null;
  Catalog?: CatalogItem | null;
}

/** A page of a chart (GET /Lumen/Charts/{type}/{period}); TotalCount is how many titles it has for this user. */
export interface ChartPage {
  Entries: ChartEntry[];
  TotalCount: number;
  StartIndex: number;
  /** How many of the page's titles Seerr failed on or was too slow for this time: asking again may bring them. */
  Missing?: number;
}

export interface HeroItem {
  Item: BaseItem;
  TrailerItemId: string | null;
  /** Without a local trailer and with "Use online trailers" on: the trailer's YouTube video id (none on IMDb). */
  TrailerYouTubeId?: string | null;
  /** Without a local trailer and with "Use online trailers" on: the trailer's MP4 on IMDb's video CDN. */
  TrailerImdbUrl?: string | null;
  /** With TrailerImdbUrl: the same trailer's 1080p MP4 there, when IMDb has that besides. */
  TrailerImdbUrlHd?: string | null;
}

/**
 * A title's trailer online (GET Lumen/Items/{id}/Trailer, …/Requests/Title/{type}/{id}/Trailer): IMDb's MP4 (and its
 * 1080p one, when there is one), and YouTube's video id, the fallback should IMDb's file not play.
 */
export interface OnlineTrailer {
  ImdbUrl?: string | null;
  ImdbUrlHd?: string | null;
  YouTubeId?: string | null;
}

/** Card badges the server computes for home items (see BadgeService). */
export type BadgeKey = 'RecentlyAdded' | 'NewEpisode' | 'NewSeason';

export interface HomeResponse {
  ConfigVersion: number;
  Hero: HeroItem[];
  Rows: HomeRow[];
  /** Item id → badge. Absent from older servers. */
  Badges?: Record<string, BadgeKey>;
}

export interface ClientConfig {
  Enabled: boolean;
  HomeTakeover: boolean;
  DetailsTakeover: boolean;
  LibraryTakeover: boolean;
  StyleStockPages: boolean;
  StyleVideoPlayer: boolean;
  AccentColor: string;
  HeroIntervalSeconds: number;
  TrailerPreview: boolean;
  TrailerDelaySeconds: number;
  /** A hero slide whose trailer is playing stays until it ends (Hero.tsx). */
  HeroWaitForTrailer: boolean;
  /**
   * "Use online trailers": titles without a local trailer preview theirs from IMDb (a plain MP4, TrailerPreview.tsx), else
   * YouTube (views/home/YouTubePreview.tsx). Named for the setting's first form, YouTube's alone.
   */
  YouTubeTrailers?: boolean;
  /** Where YouTube's player loads from instead of YouTube: only set for the E2E tests' stub player. */
  YouTubeEmbedBase?: string | null;
  /** Seerr is set up (whether this user has request features is GET /Lumen/Requests/Status's to say). */
  Requests?: boolean;
  /** A Trakt key is saved: the Top charts page exists and the Top 10 rows link to it (the key stays on the server). */
  Charts?: boolean;
  BuildHash: string;
}

export interface SessionInfo {
  Id: string;
  DeviceId: string;
  UserId?: string;
  /** What the server is doing for this session's playback (Playback info). */
  TranscodingInfo?: TranscodingInfo;
}

/** The server's transcode for a session (Jellyfin's TranscodingInfo subset). */
export interface TranscodingInfo {
  VideoCodec?: string;
  AudioCodec?: string;
  Container?: string;
  Bitrate?: number;
  Width?: number;
  Height?: number;
  AudioChannels?: number;
  Framerate?: number;
  IsVideoDirect?: boolean;
  IsAudioDirect?: boolean;
  HardwareAccelerationType?: string;
  TranscodeReasons?: string[];
}

/** The signed-in user (Jellyfin's UserDto subset). */
/** GET /SyncPlay/List: a SyncPlay group the user can join. */
export interface SyncPlayGroup {
  GroupId: string;
  GroupName: string;
  State?: string;
  Participants: string[];
}

export interface UserInfo {
  Id: string;
  Name: string;
  ServerName?: string;
  PrimaryImageTag?: string;
  HasPassword?: boolean;
  /** The user's own settings; "Play next episode automatically" is the player's next-episode card's countdown. */
  Configuration?: { EnableNextEpisodeAutoPlay?: boolean };
  Policy?: {
    IsAdministrator?: boolean;
    SyncPlayAccess?: 'CreateAndJoinGroups' | 'JoinGroups' | 'None';
    /** What jellyfin-web's item menu reads (views/itemMenu/itemCommands.ts). */
    EnableCollectionManagement?: boolean;
    EnableSubtitleManagement?: boolean;
    EnableContentDownloading?: boolean;
  };
}

/** GET /Lumen/Requests/Status: what this user can do with Seerr's catalog (all false when off or unmapped). */
export interface RequestStatus {
  Enabled: boolean;
  CanRequestMovies: boolean;
  CanRequestTv: boolean;
  /** Authorizes catalog image URLs (in place of the access token, which never goes in a URL). Null without access. */
  ImageToken?: string | null;
}

export type CatalogMediaType = 'movie' | 'tv';
export type CatalogState =
  'None' | 'Requested' | 'Downloading' | 'PartlyAvailable' | 'Available' | 'Blocklisted';

/** A title from Seerr's catalog (requests spec §3). Images are TMDB file names, served by Lumen's image proxy. */
export interface CatalogItem {
  Key: string;
  MediaType: CatalogMediaType;
  TmdbId: number;
  Title: string;
  Year?: number | null;
  Overview?: string | null;
  Rating?: number | null;
  GenreNames: string[];
  Poster?: string | null;
  Backdrop?: string | null;
  State: CatalogState;
  /** Set when the server has it and this user can see it: open the normal details page instead. */
  JellyfinItemId?: string | null;
}

export interface CatalogSeason {
  Number: number;
  Name: string;
  EpisodeCount: number;
  State: CatalogState;
}

export interface CatalogTitle extends CatalogItem {
  Runtime?: number | null;
  TrailerUrl?: string | null;
  Cast: { TmdbId: number; Name: string; Character?: string | null; Photo?: string | null }[];
  Seasons: CatalogSeason[];
  Recommendations: CatalogItem[];
  CanRequest: boolean;
}

export interface CatalogSearch {
  Results: CatalogItem[];
  Page: number;
  TotalPages: number;
}

/** How one of the user's requests is going (request progress design note, 2026-11-12). */
export type RequestProgressStatus =
  'Requested' | 'Queued' | 'Downloading' | 'Processing' | 'Ready' | 'Declined' | 'Failed';

/** One title the user requested (GET /Lumen/Requests/Mine). */
export interface MyRequest {
  RequestIds: number[];
  Item: CatalogItem;
  Status: RequestProgressStatus;
  /** Null without a download to measure (nothing grabbed yet, or Seerr isn't connected to Radarr/Sonarr). */
  Percent?: number | null;
  /** Counted from when the server answered, not a time: a TV's clock may be wrong. */
  SecondsLeft?: number | null;
  /** A show with more than one episode in the download queue. */
  EpisodesDone?: number | null;
  EpisodesTotal?: number | null;
  RequestedAt?: string | null;
  /** It became ready since Lumen saw it in flight, and the user hasn't been told yet. */
  Announce: boolean;
}

export interface MyRequests {
  Requests: MyRequest[];
}

export interface RequestResult {
  State: CatalogState;
  NeedsApproval: boolean;
}
