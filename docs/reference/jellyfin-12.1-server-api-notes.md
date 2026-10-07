# Jellyfin 12.1 server plugin API notes

Sources (read 2026-10-06):
- `jellyfin/jellyfin` tag `v12.1` (commit `ee91c75e`). `SharedVersion.cs` = `12.1.0`. `global.json` SDK `10.0.0` (rollForward latestMinor).
- `jellyfin/jellyfin-plugin-template` `master` (`c93225a`). **It is still on 10.11.5 / net9.0.** The only 12.x/13.x edits are on the renovate/unstable branches.
- `IAmParadox27/jellyfin-plugin-home-sections` `main` (`288a1f6`, `JellyfinVersion=12.1.0`).
- `intro-skipper/intro-skipper` branch `12.0` (`ce8feae`, references `12.1.*`).
- NuGet: `Jellyfin.Controller`, `Jellyfin.Model` and `Jellyfin.Common` are published at 12.0.0, 12.1.0 and **12.2.0**.

Anything not read directly from source is marked **UNVERIFIED**.

---

## 1. Scaffolding

### .csproj (recommended for 12.1: the template's shape with 12.1 values)
The template on `master` is still 10.11. This is its shape with the values from the template's `unstable` branch diff (`net10.0`) and the 12.1 package version:
```xml
<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <TargetFramework>net10.0</TargetFramework>
    <RootNamespace>Jellyfin.Plugin.Lumen</RootNamespace>
    <GenerateDocumentationFile>true</GenerateDocumentationFile>
    <TreatWarningsAsErrors>true</TreatWarningsAsErrors>
    <Nullable>enable</Nullable>
    <AnalysisMode>AllEnabledByDefault</AnalysisMode>
  </PropertyGroup>
  <ItemGroup>
    <PackageReference Include="Jellyfin.Controller" Version="12.1.0">
      <ExcludeAssets>runtime</ExcludeAssets>
    </PackageReference>
    <PackageReference Include="Jellyfin.Model" Version="12.1.0">
      <ExcludeAssets>runtime</ExcludeAssets>
    </PackageReference>
  </ItemGroup>
  <ItemGroup>  <!-- analyzers exactly as in template -->
    <PackageReference Include="SerilogAnalyzer" Version="0.15.0" PrivateAssets="All" />
    <PackageReference Include="StyleCop.Analyzers" Version="1.2.0-beta.556" PrivateAssets="All" />
    <PackageReference Include="SmartAnalyzers.MultithreadingAnalyzer" Version="1.1.31" PrivateAssets="All" />
  </ItemGroup>
  <ItemGroup>
    <None Remove="Configuration\configPage.html" />
    <EmbeddedResource Include="Configuration\configPage.html" />
  </ItemGroup>
</Project>
```
- On `unstable` the template uses `Version="13.*-*"`, `net10.0` and `targetAbi: "13.0.0.0"`. On `renovate/major-jellyfin-12.2.0` it uses `Version="12.2.0"`.
- intro-skipper 12.0 does not use `ExcludeAssets`. It has `Jellyfin.Controller`/`Jellyfin.Model`/`Jellyfin.Database.Implementations` at `12.1.*`, `StyleCop.Analyzers.Unstable` `1.2.0.556`, the same SerilogAnalyzer/MultithreadingAnalyzer, `ImplicitUsings` enabled, and an explicit `AssemblyVersion`/`FileVersion`.
- home-sections does not use `ExcludeAssets` either. It references `Jellyfin.Model`, `Jellyfin.Controller` and `Jellyfin.Extensions` at `$(JellyfinNugetVersion)`, with `GenerateAssemblyInfo=false`.
- NuGet dependency chain for 12.1.0:
  - `Jellyfin.Controller` → `Jellyfin.Naming`, `Jellyfin.Common`, `Jellyfin.Model`, `Jellyfin.MediaEncoding.Keyframes`
  - `Jellyfin.Model` → `Jellyfin.Data`, `Jellyfin.Extensions`
  - `Jellyfin.Data` → `Jellyfin.Database.Implementations` (contains the `User` entity and `SortOrder`)
  - So `User` comes in transitively and no extra reference is needed.
- Tests: the test project needs runtime assets. intro-skipper's test csproj adds `Jellyfin.Database.Implementations` `12.1.*`, `Microsoft.NET.Test.Sdk` 18.10.1, `xunit` 2.9.3, `xunit.runner.visualstudio` 4.0.0 and `coverlet.collector` 10.1.0. **UNVERIFIED**: whether `ExcludeAssets=runtime` on the plugin flows through a ProjectReference. If it does, add `Jellyfin.Controller` without `ExcludeAssets` to the test project.

### Directory.Build.props (template)
```xml
<Project>
    <PropertyGroup>
        <Version>0.0.0.0</Version>
        <AssemblyVersion>0.0.0.0</AssemblyVersion>
        <FileVersion>0.0.0.0</FileVersion>
    </PropertyGroup>
</Project>
```
- The template's lint config is `.editorconfig` only (542 lines, `root = true`, 4-space indentation, `end_of_line = lf`).
- The template has no `stylecop.json`, no `jellyfin.ruleset` and no `BannedSymbols.txt`. The server repo has `stylecop.json` and `BannedSymbols.txt`, but plugins don't copy them.
- The solution file is `Jellyfin.Plugin.Template.slnx`.

### build.yaml (jprm, template)
```yaml
---
name: "Template"
guid: "eb5d7894-8eef-4b36-aa6f-5d124e828ce1"
version: "1.0.0.0"
targetAbi: "10.11.0.0"     # use "12.1.0.0"
framework: "net9.0"        # use "net10.0"
overview: "Short description about your plugin"
description: >
  This is a longer description that can span more than one
  line and include details about your plugin.
category: "General"
owner: "jellyfin"
artifacts:
- "Jellyfin.Plugin.Template.dll"
changelog: >
  changelog
```
CI workflows call `jellyfin/jellyfin-meta-plugins/.github/workflows/{build,test,publish,changelog,scan-codeql}.yaml@master`.

### Repository manifest.json (server model: `MediaBrowser.Model.Updates.PackageInfo` / `VersionInfo`)
The top level is a JSON array of packages:
```json
[{
  "guid": "074fa1cc-...",            // PackageInfo.Id (Guid)
  "name": "…",
  "overview": "…",                   // may be null
  "description": "…",
  "owner": "…",
  "category": "…",
  "imageUrl": "https://…/logo.png",  // string?
  "versions": [{
    "version": "1.0.0.0",            // must parse as System.Version (setter calls Version.Parse)
    "changelog": "…",
    "targetAbi": "12.1.0.0",
    "sourceUrl": "https://…/plugin_1.0.0.0.zip",
    "checksum": "C76262BD65F38E34F6F5CF1FCBCEA82D",  // MD5 hex of the zip, compared case-insensitively
    "timestamp": "2025-11-04T22:59:32",              // string
    "dependencies": ["<guid>"]       // seen in home-sections' manifest; not a VersionInfo property in 12.1 source (ignored by the server)
  }]
}]
```
- `VersionInfo` also has `repositoryName` and `repositoryUrl`, which the server fills in.
- `InstallationManager` hides a version when `ApplicationVersion < targetAbi`. A missing `targetAbi` counts as `0.0.0.1`.
- **There is no upper bound.** A 12.1 plugin will be offered on 12.2 and 13.x.
- `PluginManager` loads the local `meta.json` (`PluginManifest`, which adds `status`, `autoUpdate`, `imagePath` and `assemblies`) and marks the plugin unsupported only when `_appVersion < targetAbi`.

---

## 2. Plugin class, config, web pages

```csharp
// MediaBrowser.Common.Plugins   (MediaBrowser.Common/Plugins/BasePluginOfT.cs, #nullable disable)
public abstract class BasePlugin<TConfigurationType> : BasePlugin, IHasPluginConfiguration
    where TConfigurationType : BasePluginConfiguration
{
    protected BasePlugin(IApplicationPaths applicationPaths, IXmlSerializer xmlSerializer);
    protected IApplicationPaths ApplicationPaths { get; private set; }
    protected IXmlSerializer XmlSerializer { get; private set; }
    public Type ConfigurationType { get; }
    public EventHandler<BasePluginConfiguration> ConfigurationChanged { get; set; }   // a PROPERTY, not an `event`
    public TConfigurationType Configuration { get; protected set; }                  // lazy-loaded from XML
    public virtual string ConfigurationFileName { get; }                             // "<Assembly>.xml"
    public string ConfigurationFilePath { get; }
    public virtual void SaveConfiguration(TConfigurationType config);
    public virtual void SaveConfiguration();
    public virtual void UpdateConfiguration(BasePluginConfiguration configuration);  // VIRTUAL; sets, saves, then invokes ConfigurationChanged
    public override PluginInfo GetPluginInfo();
}
// BasePlugin: abstract string Name; virtual string Description; virtual Guid Id; Version Version; string AssemblyFilePath; string DataFolderPath; virtual void OnUninstalling()
```
- Usings: `MediaBrowser.Common.Configuration` (`IApplicationPaths`), `MediaBrowser.Model.Serialization` (`IXmlSerializer`), `MediaBrowser.Model.Plugins` (`BasePluginConfiguration`, `IHasWebPages`, `PluginPageInfo`).
- The ctor calls `Path.Combine(ApplicationPaths.PluginsPath, …)`. A mock `IApplicationPaths` must return non-null `PluginsPath`, and `PluginConfigurationsPath` too if you touch `Configuration`.
- The plugin instance is created with `ActivatorUtilities.CreateInstance(_appHost.ServiceProvider, type)`, so any DI service can go in its ctor (home-sections and intro-skipper both do this).

```csharp
namespace MediaBrowser.Model.Plugins;
public interface IHasWebPages { IEnumerable<PluginPageInfo> GetPages(); }
public class PluginPageInfo {
    public string Name { get; set; } = string.Empty;
    public string? DisplayName { get; set; }
    public string EmbeddedResourcePath { get; set; } = string.Empty;
    public bool EnableInMainMenu { get; set; }
    public string? MenuSection { get; set; }
    public string? MenuIcon { get; set; }
}
```
- Pages are served by `GET /web/ConfigurationPage?name=<Name>` (no auth) and listed by `GET /web/ConfigurationPages`, which requires `RequiresElevation`.
- Extra JS/CSS files can be registered as extra `PluginPageInfo` entries and referenced as `configurationpage?name=foo.js` (intro-skipper 12.0):
```csharp
new PluginPageInfo { Name = "introskipper.js", EmbeddedResourcePath = GetType().Namespace + ".Configuration.introskipper.js" }
// html: <script type="module" src="configurationpage?name=introskipper.js"></script>
```
Minimal config page (template; home-sections on 12.1 uses the same API calls: `pageshow`, `ApiClient.getPluginConfiguration`, `updatePluginConfiguration` and `Dashboard.processPluginConfigurationUpdateResult`):
```html
<div id="TemplateConfigPage" data-role="page" class="page type-interior pluginConfigurationPage"
     data-require="emby-input,emby-button,emby-select,emby-checkbox">
  <div data-role="content"><div class="content-primary">
    <form id="TemplateConfigForm">
      <div class="inputContainer">
        <label class="inputLabel inputLabelUnfocused" for="AString">A String</label>
        <input id="AString" name="AString" type="text" is="emby-input" />
      </div>
      <button is="emby-button" type="submit" class="raised button-submit block emby-button"><span>Save</span></button>
    </form>
  </div></div>
  <script type="text/javascript">
    var TemplateConfig = { pluginUniqueId: 'eb5d7894-8eef-4b36-aa6f-5d124e828ce1' };
    document.querySelector('#TemplateConfigPage').addEventListener('pageshow', function () {
      Dashboard.showLoadingMsg();
      ApiClient.getPluginConfiguration(TemplateConfig.pluginUniqueId).then(function (config) {
        document.querySelector('#AString').value = config.AString;
        Dashboard.hideLoadingMsg();
      });
    });
    document.querySelector('#TemplateConfigForm').addEventListener('submit', function (e) {
      Dashboard.showLoadingMsg();
      ApiClient.getPluginConfiguration(TemplateConfig.pluginUniqueId).then(function (config) {
        config.AString = document.querySelector('#AString').value;
        ApiClient.updatePluginConfiguration(TemplateConfig.pluginUniqueId, config).then(function (result) {
          Dashboard.processPluginConfigurationUpdateResult(result);
        });
      });
      e.preventDefault(); return false;
    });
  </script>
</div>
```
The config JSON uses PascalCase property names (for example `config.AString`).

---

## 3. IPluginServiceRegistrator
```csharp
namespace MediaBrowser.Controller.Plugins;
public interface IPluginServiceRegistrator
{
    void RegisterServices(IServiceCollection serviceCollection, IServerApplicationHost applicationHost);
}
```
- `IServerApplicationHost` is in `MediaBrowser.Controller`.
- The registrator is instantiated with `Activator.CreateInstance`, so it needs a parameterless ctor.
- It is called from `ApplicationHost.Init(serviceCollection)`, inside `Host.CreateDefaultBuilder().ConfigureServices(services => appHost.Init(services))`. That is the web host's real `IServiceCollection`, so `IHostedService`, `IStartupFilter` and so on registered here take effect.
- If it throws, the plugin is marked `Malfunctioned`.

---

## 4. ILibraryManager (`MediaBrowser.Controller.Library`)
```csharp
event EventHandler<ItemChangeEventArgs>? ItemAdded;
event EventHandler<ItemChangeEventArgs>? ItemUpdated;
event EventHandler<ItemChangeEventArgs>? ItemRemoved;
AggregateFolder RootFolder { get; }
BaseItem? GetItemById(Guid id);
T? GetItemById<T>(Guid id) where T : BaseItem;                 // returns null if the item is not a T
T? GetItemById<T>(Guid id, Guid userId) where T : BaseItem;
T? GetItemById<T>(Guid id, User? user) where T : BaseItem;     // returns null if !ItemIsVisible(item, user)
Folder GetUserRootFolder();                                    // global; takes no user
List<Folder> GetCollectionFolders(BaseItem item);
List<Folder> GetCollectionFolders(BaseItem item, IEnumerable<Folder> allUserRootChildren);
LibraryOptions GetLibraryOptions(BaseItem item);               // MediaBrowser.Model.Configuration
List<VirtualFolderInfo> GetVirtualFolders();                   // MediaBrowser.Model.Entities
IReadOnlyList<Guid> GetItemIds(InternalItemsQuery query);
QueryResult<BaseItem> QueryItems(InternalItemsQuery query);
IReadOnlyList<BaseItem> GetItemList(InternalItemsQuery query);
IReadOnlyList<BaseItem> GetItemList(InternalItemsQuery query, bool allowExternalContent);
IReadOnlyList<BaseItem> GetItemList(InternalItemsQuery query, List<BaseItem> parents);
QueryResult<BaseItem> GetItemsResult(InternalItemsQuery query);
int GetCount(InternalItemsQuery query);
```
```csharp
// MediaBrowser.Controller.Library  (#nullable disable; not derived from EventArgs)
public class ItemChangeEventArgs { public BaseItem Item {get;set;} public BaseItem Parent {get;set;} public ItemUpdateType UpdateReason {get;set;} }
[Flags] public enum ItemUpdateType { None = 1, MetadataImport = 2, ImageUpdate = 4, MetadataDownload = 8, MetadataEdit = 16 }  // MediaBrowser.Controller.Library
```
- `GetItemList` with `query.User` set calls `AddUserToQuery`. That calls `SetUser` (parental rating, blocked/allowed tags), and **only when** `AncestorIds`, `ParentId`, `ChannelIds`, `TopParentIds`, `AncestorWithPresentationUniqueKey`, `SeriesPresentationUniqueKey`, `ItemIds` and `OwnerIds` are all empty, it sets `TopParentIds` to the user's views. In practice that means the query is limited to the libraries the user can access.
- A user's libraries can be read in two ways:
  - `libraryManager.GetUserRootFolder().GetChildren(user, true).OfType<Folder>()` (used by `ItemsController`)
  - `IUserViewManager.GetUserViews(new UserViewQuery { User = user })` (see §15)

---

## 5. InternalItemsQuery (`MediaBrowser.Controller.Entities`)
Constructors: `InternalItemsQuery()` and `InternalItemsQuery(User? user)`. The second calls `SetUser(user)` when the user is non-null. The parameterless constructor sets `DtoOptions = new DtoOptions()`, `EnableTotalRecordCount = true` and `GroupByPresentationUniqueKey = true`; all arrays start empty.
```csharp
public BaseItemKind[] IncludeItemTypes { get; set; }
public BaseItemKind[] ExcludeItemTypes { get; set; }
public bool? IsResumable { get; set; }
public bool? IsPlayed { get; set; }
public IReadOnlyList<(ItemSortBy OrderBy, SortOrder SortOrder)> OrderBy { get; set; }
public int? Limit { get; set; }
public int? StartIndex { get; set; }
public bool Recursive { get; set; }
public IReadOnlyList<string> Genres { get; set; }        // OR-match on cleaned value
public IReadOnlyList<Guid> GenreIds { get; set; }
public DateTime? MinDateCreated { get; set; }
public Guid ParentId { get; set; }                       // non-nullable Guid; there is also a set-only `BaseItem? Parent`
public Guid[] AncestorIds { get; set; }
public Guid[] TopParentIds { get; set; }
public string[] Tags { get; set; }                       // OR-match on cleaned value (case/diacritic-insensitive)
public string[] ExcludeTags { get; set; }
public DtoOptions DtoOptions { get; set; }
public bool? IsVirtualItem { get; set; }
public bool EnableTotalRecordCount { get; set; }
public string? SeriesPresentationUniqueKey { get; set; }
public User? User { get; set; }
public Guid[] ItemIds { get; set; }
public Guid[] ExcludeItemIds { get; set; }
public bool? IsFolder { get; set; }
public bool? HasTrailer { get; set; }                    // LOCAL trailers only: extras with ExtraType==Trailer (RemoteTrailers are not considered)
public TrailerType[] TrailerTypes { get; set; }
public ImageType[] ImageTypes { get; set; }              // ANY-of: Images.Any(t in ImageTypes). To require BOTH Backdrop AND Logo, filter afterwards with HasImage()
public Guid[] OwnerIds { get; set; }  public ExtraType[] ExtraTypes { get; set; }  public bool IncludeExtras { get; set; }
public bool? IsFavorite { get; set; } public double? MinCommunityRating { get; set; } public MediaType[] MediaTypes { get; set; }
public bool? CollapseBoxSetItems { get; set; } public bool IncludeOwnedItems { get; set; } public bool GroupByPresentationUniqueKey { get; set; }
public bool? HasOverview { get; set; } public int[] Years { get; set; } public Guid[] LinkedChildAncestorIds { get; set; }
public void SetUser(User user);
public void ApplyFilters(ItemFilter[] filters);
```
Enum namespaces:
- `BaseItemKind` and `ItemSortBy` are in `Jellyfin.Data.Enums`.
- `SortOrder` is in **`Jellyfin.Database.Implementations.Enums`** (`Ascending = 0`, `Descending = 1`).
- `ImageType`, `ExtraType` and `UserDataSaveReason` are in `MediaBrowser.Model.Entities`.
- `ItemFields` and `ItemFilter` are in `MediaBrowser.Model.Querying`.

`ItemSortBy` values: `Default, AiredEpisodeOrder, Album, AlbumArtist, Artist, DateCreated, OfficialRating, DatePlayed, PremiereDate, StartDate, SortName, Name, Random, Runtime, CommunityRating, ProductionYear, PlayCount, CriticRating, IsFolder, IsUnplayed, IsPlayed, SeriesSortName, VideoBitRate, AirTime, Studio, IsFavoriteOrLiked, DateLastContentAdded, SeriesDatePlayed, ParentIndexNumber, IndexNumber`.

The server's own resume query (`ItemsController.GetResumeItems`):
```csharp
_libraryManager.GetItemsResult(new InternalItemsQuery(user) {
    OrderBy = [(ItemSortBy.DatePlayed, SortOrder.Descending)], IsResumable = true, Limit = limit,
    Recursive = true, DtoOptions = dtoOptions, MediaTypes = mediaTypes, IsVirtualItem = false,
    CollapseBoxSetItems = false, IncludeOwnedItems = true, IncludeItemTypes = includeItemTypes, ... });
```

---

## 6. IUserDataManager (`MediaBrowser.Controller.Library`)
```csharp
event EventHandler<UserDataSaveEventArgs>? UserDataSaved;
UserItemData? GetUserData(User user, BaseItem item);
Dictionary<Guid, UserItemData> GetUserDataBatch(IReadOnlyList<BaseItem> items, User user);
UserItemDataDto? GetUserDataDto(BaseItem item, User user);
void SaveUserData(User user, BaseItem item, UserItemData userData, UserDataSaveReason reason, CancellationToken cancellationToken);

public class UserDataSaveEventArgs : EventArgs {   // MediaBrowser.Controller.Library, #nullable disable
    public Guid UserId { get; set; }
    public List<string> Keys { get; set; }
    public UserDataSaveReason SaveReason { get; set; }
    public UserItemData UserData { get; set; }     // MediaBrowser.Controller.Entities
    public BaseItem Item { get; set; }
}
public enum UserDataSaveReason { PlaybackStart = 1, PlaybackProgress = 2, PlaybackFinished = 3, TogglePlayed = 4,
                                 UpdateUserRating = 5, Import = 6, UpdateUserData = 7 }   // MediaBrowser.Model.Entities
```
`BaseItem.IsPlayed(User user, UserItemData userItemData)` is virtual. home-sections passes `null` for the user data.

---

## 7. IUserManager / User
- `User? GetUserById(Guid id);` (`MediaBrowser.Controller.Library.IUserManager`). There are also `IEnumerable<User> GetUsers()`, `IEnumerable<Guid> GetUsersIds()` and `User? GetUserByName(string)`.
- The entity is `Jellyfin.Database.Implementations.Entities.User`:
```csharp
public User(string username, string authenticationProviderId, string passwordResetProviderId)
// each argument is checked with ArgumentException.ThrowIfNullOrEmpty; sets Id = Guid.NewGuid(); Id has a public setter
```
- It can be constructed in tests, for example `new User("alice", "auth", "reset") { Id = someGuid }`.
- `new InternalItemsQuery(user)` reads `user.GetPreference(...)`, `MaxParentalRatingScore` and `HasContentRestrictions()`. These work on a fresh `User` because the preference sets are initialised empty in the ctor.

---

## 8. IDtoService / DtoOptions (`MediaBrowser.Controller.Dto`)
```csharp
BaseItemDto GetBaseItemDto(BaseItem item, DtoOptions options, User? user = null, BaseItem? owner = null);
IReadOnlyList<BaseItemDto> GetBaseItemDtos(IReadOnlyList<BaseItem> items, DtoOptions options, User? user = null,
                                           BaseItem? owner = null, bool skipVisibilityCheck = false);
double? GetPrimaryImageAspectRatio(BaseItem item);

public class DtoOptions {
    public DtoOptions();                 // == DtoOptions(true): ALL fields except SeasonUserData and RefreshState
    public DtoOptions(bool allFields);   // false => Fields = []
    public static DtoOptions StoredColumnsOnly { get; }  // new(false){ EnableImages=false, EnableUserData=false }
    public IReadOnlyList<ItemFields> Fields { get; set; }
    public IReadOnlyList<ImageType> ImageTypes { get; set; }   // default: all
    public int ImageTypeLimit { get; set; }                    // default: int.MaxValue
    public bool EnableImages { get; set; }                     // default: true
    public bool EnableUserData { get; set; }                   // default: true
    public bool AddProgramRecordingInfo { get; set; }
    public bool AddCurrentProgram { get; set; }
    public bool ContainsField(ItemFields field);
    public int GetImageLimit(ImageType type);
}
// Restrict fields: new DtoOptions(false) { Fields = [ItemFields.PrimaryImageAspectRatio, ItemFields.Overview], ImageTypeLimit = 1,
//                                          ImageTypes = [ImageType.Primary, ImageType.Backdrop, ImageType.Logo, ImageType.Thumb] }
```
- `ItemFields` values: `AirTime, CanDelete, CanDownload, ChannelInfo, Chapters, Trickplay, ChildCount, CumulativeRunTimeTicks, CustomRating, DateCreated, DateLastMediaAdded, DisplayPreferencesId, Etag, ExternalUrls, Genres, ItemCounts, MediaSourceCount, MediaSources, OriginalTitle, Overview, ParentId, Path, People, PlayAccess, ProductionLocations, ProviderIds, PrimaryImageAspectRatio, RecursiveItemCount, Settings, SeriesStudio, SortName, SpecialEpisodeNumbers, Studios, Taglines, Tags, RemoteTrailers, MediaStreams, SeasonUserData, DateLastRefreshed, DateLastSaved, RefreshState, ChannelImage, EnableMediaSourceDisplay, Width, Height, ExtraIds, LocalTrailerCount, IsHD, SpecialFeatureCount`.
- `ImageType` values: `Primary=0, Art, Backdrop, Banner, Logo, Thumb, Disc, Box, Screenshot, Menu, Chapter, BoxRear, Profile`.
- The query's `DtoOptions.EnableImages` controls whether the repository loads `Images`. If you need `HasImage` on query results, keep `EnableImages = true` (the default).

---

## 9. ITVSeriesManager (`MediaBrowser.Controller.TV`)
```csharp
QueryResult<BaseItem> GetNextUp(NextUpQuery query, DtoOptions options);
QueryResult<BaseItem> GetNextUp(NextUpQuery request, BaseItem[] parentsFolders, DtoOptions options);

namespace MediaBrowser.Model.Querying;
public class NextUpQuery {        // ctor defaults: EnableTotalRecordCount=true, NextUpDateCutoff=DateTime.MinValue, EnableResumable=false, EnableRewatching=false
    public required User User { get; set; }   // User entity, not a UserId
    public Guid? ParentId { get; set; }
    public Guid? SeriesId { get; set; }
    public int? StartIndex { get; set; }
    public int? Limit { get; set; }
    public ImageType[] EnableImageTypes { get; set; }
    public bool EnableTotalRecordCount { get; set; }
    public DateTime NextUpDateCutoff { get; set; }
    public bool EnableResumable { get; set; }
    public bool EnableRewatching { get; set; }
}
```
The HTTP endpoint `/Shows/NextUp` defaults `enableResumable` to **true**; the class defaults it to `false`.

---

## 10. ISimilarItemsManager (`MediaBrowser.Controller.Library`, new in 12.x)
```csharp
Task<IReadOnlyList<BaseItem>> GetSimilarItemsAsync(BaseItem item, IReadOnlyList<Guid> excludeArtistIds, User? user,
    DtoOptions dtoOptions, int? limit, LibraryOptions? libraryOptions, CancellationToken cancellationToken);
Task<IReadOnlyList<SimilarItemsRecommendation>> GetMovieRecommendationsAsync(User? user, Guid parentId,
    int categoryLimit, int itemLimit, DtoOptions dtoOptions, CancellationToken cancellationToken);

public sealed class SimilarItemsRecommendation {
    public required string BaselineItemName { get; init; }
    public required Guid CategoryId { get; init; }
    public required RecommendationType RecommendationType { get; init; }   // MediaBrowser.Model.Dto
    public required IReadOnlyList<BaseItem> Items { get; init; }
}
public enum RecommendationType { SimilarToRecentlyPlayed = 0, SimilarToLikedItem = 1, HasDirectorFromRecentlyPlayed = 2,
                                 HasActorFromRecentlyPlayed = 3, HasLikedDirector = 4, HasLikedActor = 5 }
```
- For a Series, call `GetSimilarItemsAsync(series, Array.Empty<Guid>(), user, dtoOptions, limit, libraryManager.GetLibraryOptions(series), ct)`.
- `excludeArtistIds` must be non-null; it is checked with `ThrowIfNull`.
- `libraryOptions` **may be null**. Local providers always run; remote providers run only if they are enabled in `libraryOptions.GetTypeOptions(type).SimilarItemProviders`. home-sections passes null.
- `limit` defaults to 50.
- The call **mutates** `dtoOptions.Fields` by appending `ItemFields.ProviderIds`.
- `LibraryController` returns empty results for `Episode` and for `IItemByName` items other than `MusicArtist`. The server's `/Movies/Recommendations` passes `parentId ?? Guid.Empty`.

---

## 11. Trailers
- There is no `BaseItem.ExtraIds` property in 12.1. Extras are child rows with `OwnerId`/`ExtraType`. `ItemFields.ExtraIds` still exists as an enum value.
```csharp
// BaseItem (#nullable disable)
public IEnumerable<BaseItem> GetExtras(User user = null);
public IEnumerable<BaseItem> GetExtras(IReadOnlyCollection<ExtraType> extraTypes, User user = null);   // GetItemList with OwnerIds + ExtraTypes, ordered by SortName
public IReadOnlyList<MediaUrl> RemoteTrailers { get; set; }   // MediaUrl { string Url; string Name; } (MediaBrowser.Model.Entities)
// IHasTrailers (Movie, Series, Episode, BoxSet): IReadOnlyList<BaseItem> LocalTrailers => GetExtras([ExtraType.Trailer]).ToArray();
// HasTrailerExtensions.GetTrailerCount(this IHasTrailers) = LocalTrailers.Count + RemoteTrailers.Count
```
The server's `/Items/{id}/LocalTrailers` handler is `item.GetExtras([ExtraType.Trailer], user).Select(i => _dtoService.GetBaseItemDto(i, new DtoOptions(), user, item))`.

---

## 12. Collections / playlists / tags
- In 12.x links are stored in the `LinkedChildren` table. `BaseItemMapper` fills `Folder.LinkedChildren` (ordered by `SortOrder`) when the query included `LinkedChildEntities`.
  - `GetItemById` (`RetrieveItem`) always includes them.
  - `GetItemList` includes them when `IncludeItemTypes` is empty or contains BoxSet, Playlist, CollectionFolder, Video, Movie, Episode, MusicVideo or Trailer.
- `Folder.LinkedChildrenLoaded` is false when they were not loaded. **Don't save an item that has `LinkedChildrenLoaded == false`.**
```csharp
// Folder (MediaBrowser.Controller.Entities)
public LinkedChild[] LinkedChildren { get; set; }      // LinkedChild { string Path; LinkedChildType Type; string LibraryItemId; Guid? ItemId; }
public List<BaseItem> GetLinkedChildren();             // new DtoOptions()
public List<BaseItem> GetLinkedChildren(DtoOptions options);
public List<BaseItem> GetLinkedChildren(User user);    // per-user library filtering
public IReadOnlyList<Tuple<LinkedChild, BaseItem>> GetLinkedChildrenInfos();
public virtual IReadOnlyList<BaseItem> GetChildren(User user, bool includeLinkedChildren, InternalItemsQuery query = null);
// BoxSet (MediaBrowser.Controller.Entities.Movies): GetChildren(user, true) => visible children, SORTED by DisplayOrder (default PremiereDate)
// Playlist (MediaBrowser.Controller.Playlists):
public IReadOnlyList<Tuple<LinkedChild, BaseItem>> GetManageableItems();   // == GetLinkedChildrenInfos(): stored order, keeps duplicates, NOT user-filtered
// Playlist.GetChildren(user, true, query) => non-folder linked items, IsVisible(user)-filtered, de-duplicated by Id
```
- Collection order: `libraryManager.GetItemById<BoxSet>(id, user)?.GetChildren(user, true)`. Use `GetLinkedChildren(user)` for the raw link order.
- Playlist order: `playlist.GetManageableItems().Select(t => t.Item2).Where(i => i is not null && i.IsVisible(user))`.
- By tag: `new InternalItemsQuery(user) { Tags = ["lumen"], Recursive = true, IncludeItemTypes = [...] }`.
- `ICollectionManager` (`MediaBrowser.Controller.Collections`) has no public `GetCollections(user)`; home-sections calls the private method by reflection. To list collections, query `IncludeItemTypes = [BaseItemKind.BoxSet], Recursive = true`.

---

## 13. BaseItem members (`MediaBrowser.Controller.Entities`, file is `#nullable disable`)
```csharp
public virtual string Name { get; set; }        public Guid Id { get; set; }   (public setter)
public string[] Genres { get; set; }            public string[] Tags { get; set; }
public float? CommunityRating { get; set; }     public float? CriticRating { get; set; }
public DateTime DateCreated { get; set; }       public DateTime? PremiereDate { get; set; }   public int? ProductionYear { get; set; }
public int? IndexNumber { get; set; }           public int? ParentIndexNumber { get; set; }
public string Overview { get; set; }            public long? RunTimeTicks { get; set; }        public bool IsVirtualItem { get; set; }
public ItemImageInfo[] ImageInfos { get; set; }
public bool HasImage(ImageType type, int imageIndex);               // GetImageInfo(...) is not null
public ItemImageInfo GetImageInfo(ImageType imageType, int imageIndex);   // Chapter => static ChapterManager; otherwise ImageInfos only
public IEnumerable<ItemImageInfo> GetImages(ImageType imageType);
public BaseItemKind GetBaseItemKind();
public virtual bool IsVisible(User user, bool skipAllowedTagsCheck = false);
// ItemImageInfo { required string Path; ImageType Type; DateTime DateModified; int Width; int Height; string? BlurHash; }
// Episode (…Entities.TV): Guid SeriesId {get;set;}  Guid SeasonId {get;set;}  string SeriesName {get;set;}
//   Series Series => LibraryManager.GetItemById(SeriesId) as Series   (static LibraryManager!)
```
Test pitfalls:
- `new Movie { Name = "x", Genres = [...], CommunityRating = 7f }` works without any static setup; the ctor only initialises arrays. Jellyfin's own tests do `new Movie { PremiereDate = … }`, and intro-skipper does `new Series { Name = … }` and `new Episode { … }`.
- **These members hit static services and throw NRE in tests unless the statics are set:**
  - `SortName` getter → `ConfigurationManager.Configuration`
  - `Episode.Series` / `Season`, `GetParent()`, `GetExtras()` / `LocalTrailers`, `GetCollectionFolders`, `Folder.GetChildren` / `GetLinkedChildren` → `LibraryManager`
  - `GetImageInfo(Chapter)` → `ChapterManager`
  - `LocationType` → `FileSystem`
- The statics are `public static ILibraryManager LibraryManager {get;set;}`, plus `Logger`, `ConfigurationManager`, `ProviderManager`, `LocalizationManager`, `ItemRepository`, `ItemCountService`, `ChapterManager`, `FileSystem`, `UserDataManager`, `ChannelManager`, `MediaSourceManager` and `MediaSegmentManager`.
- How tests deal with this:
  - Jellyfin tests assign `BaseItem.LibraryManager = mock.Object` and restore the previous value afterwards.
  - intro-skipper uses `DispatchProxy` stubs (`BaseItem.FileSystem ??= FileSystemProxy.Create()`) and does not use Moq.
- Prefer passing `SeriesId` / `SeriesName` instead of `Episode.Series`, and use `HasImage` (backed by `ImageInfos`) in testable code.

---

## 14. Controllers
- Plugin assemblies that contain a `ControllerBase` subclass are added via `AddApplicationPart`. Controllers are registered as services (`AddControllersAsServices`), so constructor DI works.
- `BaseJellyfinApiController` is in `Jellyfin.Api.dll`, which is **not on NuGet**. Plugins inherit `ControllerBase`.
- The `Policies` constants are in `MediaBrowser.Common` (from the `Jellyfin.Common` package):
```csharp
using MediaBrowser.Common.Api;          // Policies
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

[ApiController]
[Authorize]                                           // DefaultPolicy = CustomAuthentication + DefaultAuthorizationRequirement (any logged-in user)
[Route("Lumen")]
[Produces(MediaTypeNames.Application.Json)]
public class LumenController : ControllerBase
{
    [HttpGet("Rows")] public ActionResult<...> GetRows() { ... }
    [HttpPost("Admin/X")]
    [Authorize(Policy = Policies.RequiresElevation)]   // requires ClaimTypes.Role == UserRoles.Administrator
    public ActionResult DoAdmin() { ... }
}
```
- `Policies` constants: `FirstTimeSetupOrElevated, RequiresElevation, LocalAccessOnly, IgnoreParentalControl, Download, FirstTimeSetupOrDefault, LocalAccessOrRequiresElevation, AnonymousLanAccessPolicy, FirstTimeSetupOrIgnoreParentalControl, SyncPlayHasAccess, SyncPlayCreateGroup, SyncPlayJoinGroup, SyncPlayIsInGroup, CollectionManagement, LiveTvAccess, LiveTvManagement, SubtitleManagement, LyricManagement`.
- The `User.GetUserId()` extension lives in `Jellyfin.Api.Extensions.ClaimsPrincipalExtensions` (Jellyfin.Api.dll), which plugins **can't reference**. Read the claim yourself instead (home-sections does exactly this):
```csharp
var s = User.Claims.FirstOrDefault(c => c.Type.Equals("Jellyfin-UserId", StringComparison.OrdinalIgnoreCase))?.Value;
Guid.TryParse(s, out var userId);   // InternalClaimTypes.UserId = "Jellyfin-UserId"
```
  The alternative is `MediaBrowser.Controller.Net.IAuthorizationContext.GetAuthorizationInfo(HttpContext)` → `Task<AuthorizationInfo>`, which has `User? User`, `bool IsAuthenticated`, `bool IsApiKey`, `string? Token` and so on.
- MVC JSON output is **PascalCase** by default (`JsonDefaults.PascalCaseOptions`). Clients can ask for camelCase through the Accept-header profile formatters.

---

## 15. Library views
```csharp
namespace MediaBrowser.Controller.Library;
public interface IUserViewManager {
    Folder[] GetUserViews(UserViewQuery query);
    UserView GetUserSubView(Guid parentId, CollectionType? type, string localizationKey, string sortName);
    List<Tuple<BaseItem, List<BaseItem>>> GetLatestItems(LatestItemsQuery request, DtoOptions options);
}
namespace MediaBrowser.Model.Library;
public class UserViewQuery { public required User User {get;set;} public bool IncludeExternalContent {get;set;} = true;
                             public bool IncludeHidden {get;set;} public CollectionType?[] PresetViews {get;set;} }
```
Endpoints confirmed in `docs/reference/jellyfin-openapi-12.1.0.json` (x-jellyfin-version 12.1.0):

| Endpoint | operationId | Auth |
|---|---|---|
| `GET /Library/VirtualFolders` | `GetVirtualFolders` | `FirstTimeSetupOrElevated` |
| `GET /UserViews` | `GetUserViews` | `DefaultAuthorization` |
| `GET/POST /Plugins/{pluginId}/Configuration` | | `RequiresElevation` |
| `GET /Shows/NextUp` | | default |
| `GET /Items/{itemId}/LocalTrailers` | | default |
| `GET /Items/{itemId}/Similar` | | default |
| `GET /Movies/Recommendations` | | default |

`VirtualFolderInfo` fields: `Name`, `Locations`, `CollectionType`, `LibraryOptions`, `ItemId` (string), `PrimaryImageItemId`, `RefreshProgress`, `RefreshStatus`.

---

## 16. Logging / host info
- `ILogger<T>` injection works in plugin services, controllers and the plugin ctor (intro-skipper injects `ILogger<VisualizationController>`).
- `IServerApplicationHost` (`MediaBrowser.Controller`, derived from `MediaBrowser.Common.IApplicationHost`) provides `Version ApplicationVersion`, `string ApplicationVersionString`, `string Name`, `string SystemId` and `string FriendlyName`.
- `IApplicationPaths` (`MediaBrowser.Common.Configuration`) provides `WebPath`, `PluginsPath`, `PluginConfigurationsPath`, `DataPath`, `CachePath` and `ProgramDataPath`.
- The plugin's own version is `BasePlugin.Version`, taken from the assembly version.
- Hosted services: intro-skipper registers them with `serviceCollection.AddSingleton<IHostedService>(sp => sp.GetRequiredService<X>())`.

---

## 17. /web serving and middleware order (`Jellyfin.Server/Startup.cs` @ v12.1)
- `ConfigureServices` calls `services.AddResponseCompression()` with **default options**: Brotli + Gzip, the default MIME list (which includes text/html), and `EnableForHttps = false`.
- `Configure(app, …)`:
```
app.UseBaseUrlRedirection();                 // redirects paths outside BaseUrl
app.Map(config.BaseUrl, mainApp => {         // PathBase = BaseUrl from here on
  [dev] UseDeveloperExceptionPage
  UseForwardedHeaders
  UseMiddleware<ExceptionMiddleware>
  UseMiddleware<ResponseTimeMiddleware>
  UseWebSockets
  UseResponseCompression
  UseCors
  UseRequestLocalization
  [RequireHttps && ListenWithHttps] UseHttpsRedirection
  if (appConfig.HostWebClient()):            // config key "hostwebclient"
     UseDefaultFiles(new DefaultFilesOptions { FileProvider = new PhysicalFileProvider(ApplicationPaths.WebPath), RequestPath = "/web" })
     UseStaticFiles(new StaticFileOptions { FileProvider = new PhysicalFileProvider(ApplicationPaths.WebPath), RequestPath = "/web",
         ContentTypeProvider = (+ .data, .mem), OnPrepareResponse: index.html => Cache-Control: no-cache })
     UseRobotsRedirection
  UseStaticFiles(); UseAuthentication(); UseJellyfinApiSwagger; UseQueryStringDecoding; UseRouting(); UseAuthorization();
  UseIPBasedAccessValidation; UseWebSocketHandler; UseServerStartupMessage; [EnableMetrics] UseHttpMetrics; UseEndpoints(MapControllers, /health)
});
```
- **Jellyfin sets no custom ETag for /web.** `index.html` is served by the stock ASP.NET `StaticFileMiddleware`. That middleware:
  - sets `Content-Length`, `Last-Modified` and an `ETag` derived from last-modified time and length (ASP.NET behaviour, not Jellyfin code)
  - answers `If-None-Match` / `If-Modified-Since` with **304**, and supports Range and HEAD
  - Jellyfin only adds `Cache-Control: no-cache`, so browsers always revalidate.
- Middleware from an `IStartupFilter` registered through `IPluginServiceRegistrator` wraps the **whole** `Startup.Configure`. It runs before `UseBaseUrlRedirection`, `Map(BaseUrl)`, `ForwardedHeaders`, `ExceptionMiddleware` and `ResponseCompression`. Consequences for an index.html rewriter:
  - `Request.Path` still includes the BaseUrl prefix (for example `/jellyfin/web/index.html`) and `PathBase` is empty. Match on `<BaseUrl>/web/`, `<BaseUrl>/web/index.html` and `<BaseUrl>/web`; the last one is redirected to `/web/` by DefaultFiles.
  - The body it sees is **already compressed** (br/gzip) when the request is not HTTPS at Kestrel and the client sent `Accept-Encoding`; `ResponseCompression` also removes `Content-Length`. Clear `Request.Headers.AcceptEncoding` for these paths before calling `next`.
  - Strip `If-None-Match`, `If-Modified-Since` and `Range` from the request, or the inner middleware may return 304/206. After rewriting, set `Response.ContentLength` to the new length and remove or replace `ETag` and `Last-Modified`.
  - Swapping `Response.Body` for a buffer is safe with `StaticFileMiddleware`'s `SendFileAsync`, because since ASP.NET Core 3.0 the `HttpResponse.Body` setter installs a `StreamResponseBodyFeature`. **UNVERIFIED** against the .NET 10 source.
  - Exceptions thrown in the filter middleware are not caught by Jellyfin's `ExceptionMiddleware`.
- No surveyed 12.x plugin uses `IStartupFilter`. home-sections injects its JS/CSS through the separate **File Transformation** plugin (GUID `5e87cc92-571a-4d8d-8d98-d2d4147f9f90`, declared as a manifest `dependencies` entry and called via reflection on `Jellyfin.Plugin.FileTransformation.PluginInterface`). That the `IStartupFilter` approach works is an inference from the host wiring (`Host.CreateDefaultBuilder().ConfigureServices(appHost.Init)` → `ConfigureWebHostDefaults` → `UseStartup`). **UNVERIFIED at runtime.**
