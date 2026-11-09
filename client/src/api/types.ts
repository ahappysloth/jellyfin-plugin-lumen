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
