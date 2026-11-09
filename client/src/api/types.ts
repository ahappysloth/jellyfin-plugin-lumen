/** Subsets of Jellyfin DTOs (PascalCase, as served). Only fields Lumen reads are listed. */
export interface UserData {
  PlaybackPositionTicks?: number;
  PlayedPercentage?: number;
  Played?: boolean;
  IsFavorite?: boolean;
  UnplayedItemCount?: number;
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
  IndexNumber?: number;
  ParentIndexNumber?: number;
  LocalTrailerCount?: number;
  UserData?: UserData;
  MediaStreams?: MediaStream[];
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
  BuildHash: string;
}

export interface SessionInfo {
  Id: string;
  DeviceId: string;
  UserId?: string;
}

/** The signed-in user (Jellyfin's UserDto subset). */
export interface UserInfo {
  Id: string;
  Name: string;
  ServerName?: string;
  PrimaryImageTag?: string;
  HasPassword?: boolean;
  Policy?: { IsAdministrator?: boolean };
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
