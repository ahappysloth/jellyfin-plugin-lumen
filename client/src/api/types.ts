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
}

export interface HomeRowEntry {
  Item?: BaseItem | null;
  Catalog?: CatalogItem | null;
}

export interface HeroItem {
  Item: BaseItem;
  TrailerItemId: string | null;
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
  Policy?: { IsAdministrator?: boolean; SyncPlayAccess?: 'CreateAndJoinGroups' | 'JoinGroups' | 'None' };
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

export interface RequestResult {
  State: CatalogState;
  NeedsApproval: boolean;
}
