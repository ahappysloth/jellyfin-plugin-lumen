# Lumen Foundation + Home & Details UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build Lumen sub-project 1. It is a self-contained Jellyfin 12.1+ plugin that injects a Preact client into jellyfin-web and replaces the Home and Movie/Series details pages with a cinematic hero, admin-configurable personalized rows, and a redesigned details page. Any failure falls back to the stock UI.

**Architecture:**
- **C# plugin (.NET 10).**
  - An `IStartupFilter` middleware rewrites `/web/index.html` to load an embedded client bundle.
  - Server-side section providers compute home rows behind `GET /Lumen/Home`, with per-user caching.
  - An admin page (also a Preact bundle) edits a data-driven section list through admin-only endpoints.
- **Client.** It renders into its own `#lmn-root` and only toggles classes on `<html>` to hide the stock page. It never touches jellyfin-web's React DOM.

**Tech Stack:**
- Server: C# / .NET 10 / ASP.NET Core, Jellyfin.Controller 12.1.0, xUnit + NSubstitute + ASP.NET TestHost + FakeTimeProvider.
- Client: TypeScript + Preact + Vite (IIFE lib build), Vitest + Testing Library + jsdom, ESLint + Prettier.
- E2E and release: Playwright, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-10-04-lumen-home-ui-design.md`. Reference notes: `docs/reference/jellyfin-12.1-server-api-notes.md`, `docs/reference/jellyfin-web-12.1-notes.md`, `docs/reference/jellyfin-openapi-12.1.0.json`.

## Global Constraints

- Build against `Jellyfin.Controller` / `Jellyfin.Model` **12.1.0** with `ExcludeAssets="runtime"`, `TargetFramework` **net10.0**, plugin `targetAbi` **12.1.0.0**. `targetAbi` is a lower bound, so 12.2 is supported.
- Plugin name **Lumen**, plugin GUID **`186f9cb8-ba8e-4555-a700-ffa619f48264`**, license **GPL-3.0**, repo `ahappysloth/jellyfin-plugin-lumen`.
- Identifiers:
  - CSS/DOM prefix **`lmn-`** (root element `#lmn-root`, `<html>` classes `lmn-active`, `lmn-home`, `lmn-details`).
  - HTTP routes under **`/Lumen/`**.
  - C# root namespace **`Jellyfin.Plugin.Lumen`**.
- **No third-party streaming-service brand names or brand colors anywhere** (code, CSS, docs, commit messages). Default accent color **`#f5a524`**.
- Public interfaces only. The client may not mutate jellyfin-web's DOM except adding/removing classes on `<html>` and owning `#lmn-root`. Every jellyfin-web selector, global, and route shape lives in `client/src/compat/jellyfin.ts`.
- **Fail open:** any Lumen failure shows the stock Jellyfin UI. Never a blank page.
- Client bundle `lumen.js` + `lumen.css` ≤ **60 KB gzipped** (the admin bundle is excluded).
- Home performance limits:
  - One `GET /Lumen/Home` per home load.
  - Section provider timeout **3 s**.
  - **20** items per row.
  - Home cache TTL **60 s**.
  - Library-change invalidation debounced to at most once per **30 s**.
- Lumen API JSON is Jellyfin's default **PascalCase**.
- UI strings are English-only and centralized in `client/src/strings.ts`.
- Local dev has **no Docker and no sudo**:
  - .NET SDK lives in `~/.dotnet`.
  - The portable Jellyfin dev server lives in `~/.local/share/lumen-dev` and listens on **http://localhost:8096**.
  - Every shell step starts with `source scripts/env.sh` (created in Task 1) from the repo root `~/projects/jellyfin-plugin-lumen`.
- C# style:
  - File-scoped namespaces and classic constructors (no primary constructors; StyleCop misreports them).
  - `sealed` classes unless designed for inheritance.
  - `TreatWarningsAsErrors`. Fix analyzer findings in code. Suppress only with a `Justification` when a framework requirement forces it (e.g. XML-serialized settable lists).
- Commits are conventional (`feat:`, `test:`, `chore:`, `docs:`, `ci:`). Every commit message ends with the trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Commit commands below pass it as a second `-m`.

## Review Focus

These five inputs aren't exercised by any task's main-path tests, and they're the ones most likely to bite a real user. Each has a pinned test in the owning task.

1. **Server configured with a BaseUrl (e.g. `/jellyfin`).** Injection must still happen at `/jellyfin/web/index.html`, and asset URLs must resolve under the BaseUrl. Pinned in Task 7 (`Injects_WhenServerUsesBaseUrl`) and Task 6 (relative asset URLs).
2. **A user with restricted library access or parental controls.** Rows must never contain items from libraries they can't see, including a `RecentlyAdded` section pinned to a library they lack. Pinned in Task 13 (`RecentlyAdded_ReturnsNothing_WhenUserCannotSeeLibrary`) and Task 28 (`restricted-user.spec.ts`).
3. **A brand-new user or an empty library.** Empty rows are omitted. If there is no hero and no rows, the client shows the stock home, not an empty Lumen page. Pinned in Task 12 (`OmitsEmptyRows`) and Task 24 (`falls back to stock when home is empty`).
4. **Items with missing artwork.** Cards render a title placeholder, and the hero skips items without a backdrop. Pinned in Task 22 (`renders a title placeholder when the item has no image`) and Task 17 (`Rank_ExcludesItemsWithoutBackdrop`).
5. **Signing out, or switching users, in the same tab.** Lumen releases the page on sign-out and never shows the previous user's cached home. Pinned in Task 21 (`releases takeover when the user signs out`) and Task 24 (`does not show another user's cached home`).

## Plan-time adjustments to the spec

The spec will be amended to match in Task 30:
- No `build.yaml`. The release workflow (Task 30) builds the zip and `manifest.json` directly.
- The dev server uses the default port **8096**, not 8097. Changing the port needs a `network.xml` edit, and nothing else on this machine uses 8096.
- The admin page logic is a second Vite bundle (`lumen-admin.js`, TypeScript + Preact, unit-tested). `configPage.html` is a thin shell that loads it from `/Lumen/Assets`. This replaces a hand-written `configPage.js`.
- Home is served by a dedicated `HomeController`. `LumenController` serves assets, client config, and diagnostics. `AdminController` serves admin endpoints.
- Collection/playlist reading and trailer lookup sit behind small adapters (`ILinkedItemsReader`, `ITrailerLookup`). Jellyfin implements those operations through static service locators that can't be unit-tested.

## File Structure

```
jellyfin-plugin-lumen/
├── Jellyfin.Plugin.Lumen.slnx
├── Directory.Build.props            # shared C# settings, version
├── Directory.Packages.props         # central package versions + StyleCop
├── .editorconfig  stylecop.json  .gitignore  LICENSE  README.md  CHANGELOG.md  manifest.json
├── scripts/
│   ├── env.sh                       # PATH for ~/.dotnet
│   ├── setup-dev.sh                 # one-time: .NET SDK, portable Jellyfin + ffmpeg
│   ├── dev.sh                       # build + deploy plugin + (re)start dev server
│   ├── gen-test-media.sh            # E2E fixture media (VP9/Opus webm, NFO, images)
│   └── update-manifest.mjs          # release: add version entry to manifest.json
├── src/Jellyfin.Plugin.Lumen/
│   ├── Jellyfin.Plugin.Lumen.csproj # includes client build + embed targets
│   ├── LumenPlugin.cs               # BasePlugin + IHasWebPages
│   ├── ServiceRegistrator.cs        # all DI
│   ├── Api/ LumenController.cs  HomeController.cs  AdminController.cs  ClaimsPrincipalExtensions.cs  Dtos.cs
│   ├── Assets/ AssetCatalog.cs
│   ├── Configuration/ PluginConfiguration.cs  SectionDefinition.cs  SectionTypes.cs  DefaultSections.cs
│   │                  ConfigMigrator.cs  ConfigValidator.cs  ILumenConfigStore.cs  LumenConfigStore.cs
│   │                  LibraryCatalog.cs  LumenPluginPersistence.cs  configPage.html
│   ├── Diagnostics/ DiagnosticsStore.cs
│   ├── Injection/ HtmlInjector.cs  IndexHtmlMiddleware.cs  LumenStartupFilter.cs
│   └── Home/
│       ├── IHomeSectionProvider.cs  SectionParameter.cs  HomeRow.cs  HomeContext.cs  WatchHistory.cs  QueryOptions.cs
│       ├── HomeService.cs  HomeCache.cs  HomeDtoMapper.cs  HeroService.cs  WatchHistoryService.cs  GenreWeighting.cs
│       ├── LinkedItemsReader.cs  TrailerLookup.cs
│       └── Providers/ ContinueWatchingProvider.cs  NextUpProvider.cs  RecentlyAddedProvider.cs  GenreProvider.cs
│                      NewForYouProvider.cs  BecauseYouWatchedProvider.cs  CuratedProvider.cs
├── tests/Jellyfin.Plugin.Lumen.Tests/   (one test file per unit + TestData.cs)
├── client/
│   ├── package.json  tsconfig.json  vite.config.ts  vite.admin.config.ts  eslint.config.js  .prettierrc.json
│   ├── scripts/check-size.mjs
│   ├── test/setup.ts
│   └── src/
│       ├── main.tsx  strings.ts
│       ├── compat/jellyfin.ts
│       ├── api/types.ts  api/lumenApi.ts
│       ├── takeover/routes.ts  takeover/navigation.ts  takeover/takeover.ts  takeover/bootstrap.ts
│       ├── playback/play.ts
│       ├── components/ ErrorBoundary.tsx  Card.tsx  ProgressBar.tsx  images.ts  useAutoFocus.ts
│       ├── views/App.tsx  views/context.ts
│       ├── views/home/ HomeView.tsx  Row.tsx  Hero.tsx  TrailerPreview.tsx  homeStore.ts
│       ├── views/details/ DetailsView.tsx  DetailsHeader.tsx  MovieDetails.tsx  SeriesDetails.tsx
│       │                  EpisodeList.tsx  CastRow.tsx  SimilarRow.tsx  badges.ts  smartPlay.ts
│       ├── admin/ main.tsx  AdminApp.tsx  adminApi.ts  configModel.ts
│       └── styles/lumen.css
├── e2e/ package.json  playwright.config.ts  tsconfig.json  support/*.ts  specs/*.spec.ts
└── .github/ workflows/{ci.yml,e2e.yml,nightly.yml,release.yml}  dependabot.yml
```

---

## Phase A: Toolchain and plugin foundation

### Task 1: Dev toolchain scripts

**Files:**
- Create: `scripts/env.sh`, `scripts/setup-dev.sh`, `.gitignore`

**Interfaces:**
- Produces:
  - `source scripts/env.sh` puts `dotnet` on PATH.
  - The dev server binary is at `$LUMEN_DEV_HOME/jellyfin/jellyfin` (default `~/.local/share/lumen-dev`) and ffmpeg at `$LUMEN_DEV_HOME/ffmpeg/ffmpeg`.

- [ ] **Step 1: Create `scripts/env.sh`**

```bash
# Source me: `source scripts/env.sh`
export DOTNET_ROOT="$HOME/.dotnet"
export PATH="$HOME/.dotnet:$HOME/.dotnet/tools:$PATH"
export DOTNET_CLI_TELEMETRY_OPTOUT=1
export DOTNET_NOLOGO=1
export LUMEN_DEV_HOME="${LUMEN_DEV_HOME:-$HOME/.local/share/lumen-dev}"
```

- [ ] **Step 2: Create `scripts/setup-dev.sh`**

```bash
#!/usr/bin/env bash
# One-time local setup without sudo or Docker: .NET 10 SDK, portable Jellyfin, portable jellyfin-ffmpeg.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
source "$ROOT/scripts/env.sh"

JELLYFIN_VERSION="${JELLYFIN_VERSION:-12.2}"
FFMPEG_TARBALL="${FFMPEG_TARBALL:-jellyfin-ffmpeg_8.1.3-1_portable_linux64-gpl.tar.xz}"

if ! command -v dotnet >/dev/null || ! dotnet --list-sdks | grep -q '^10\.'; then
  echo "Installing .NET 10 SDK into ~/.dotnet"
  curl -sSL https://dot.net/v1/dotnet-install.sh -o /tmp/dotnet-install.sh
  bash /tmp/dotnet-install.sh --channel 10.0 --install-dir "$HOME/.dotnet"
fi

mkdir -p "$LUMEN_DEV_HOME"/{data,config,cache,log,ffmpeg}

if [[ ! -x "$LUMEN_DEV_HOME/jellyfin/jellyfin" ]]; then
  echo "Downloading Jellyfin $JELLYFIN_VERSION (portable)"
  curl -fSL "https://repo.jellyfin.org/files/server/linux/stable/v${JELLYFIN_VERSION}/amd64/jellyfin_${JELLYFIN_VERSION}-amd64.tar.gz" \
    -o /tmp/jellyfin.tar.gz
  tar -xzf /tmp/jellyfin.tar.gz -C "$LUMEN_DEV_HOME"
fi

if [[ ! -x "$LUMEN_DEV_HOME/ffmpeg/ffmpeg" ]]; then
  echo "Downloading jellyfin-ffmpeg (portable)"
  curl -fSL "https://repo.jellyfin.org/files/ffmpeg/linux/latest-8.x/amd64/${FFMPEG_TARBALL}" -o /tmp/jffmpeg.tar.xz
  tar -xJf /tmp/jffmpeg.tar.xz -C "$LUMEN_DEV_HOME/ffmpeg"
fi

echo "dotnet: $(dotnet --version)"
echo "jellyfin: $LUMEN_DEV_HOME/jellyfin/jellyfin"
echo "ffmpeg: $("$LUMEN_DEV_HOME/ffmpeg/ffmpeg" -hide_banner -version | head -1)"
```

- [ ] **Step 3: Create `.gitignore`**

```gitignore
bin/
obj/
artifacts/
*.user
.vs/
.idea/
node_modules/
client/dist/
e2e/test-results/
e2e/playwright-report/
e2e/fixtures/media/
e2e/.state.json
```

- [ ] **Step 4: Run setup and verify**

Run:
```bash
chmod +x scripts/*.sh && ./scripts/setup-dev.sh
```
Expected output ends with three lines:
- `dotnet: 10.0.x`
- the Jellyfin binary path
- `ffmpeg version ...-Jellyfin`

If the tarball layout differs (no `jellyfin/jellyfin`), run `ls "$LUMEN_DEV_HOME"`, then fix the `-x` checks and the paths in this script and in Task 2's `dev.sh` to match the extracted folder.

- [ ] **Step 5: Smoke-run the portable server**

Run:
```bash
source scripts/env.sh
"$LUMEN_DEV_HOME/jellyfin/jellyfin" --datadir "$LUMEN_DEV_HOME/data" --configdir "$LUMEN_DEV_HOME/config" \
  --cachedir "$LUMEN_DEV_HOME/cache" --logdir "$LUMEN_DEV_HOME/log" --ffmpeg "$LUMEN_DEV_HOME/ffmpeg/ffmpeg" \
  > "$LUMEN_DEV_HOME/log/console.log" 2>&1 &
echo $! > "$LUMEN_DEV_HOME/jellyfin.pid"
for i in $(seq 1 90); do curl -sf http://localhost:8096/health && break; sleep 1; done; echo
curl -s http://localhost:8096/System/Info/Public
kill "$(cat "$LUMEN_DEV_HOME/jellyfin.pid")"
```
Expected:
- `Healthy`
- then JSON containing `"Version":"12.2.0"` and `"StartupWizardCompleted":false`

If the server says it can't find the web client, add `--webdir "$LUMEN_DEV_HOME/jellyfin/jellyfin-web"` (adjust to the extracted folder name) here and in `dev.sh`.

- [ ] **Step 6: Commit**

```bash
git add scripts/env.sh scripts/setup-dev.sh .gitignore
git commit -m "chore: add sudo-free dev toolchain setup" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: C# solution scaffold, plugin class, dev deploy script

**Files:**
- Create:
  - `Directory.Build.props`, `Directory.Packages.props`, `.editorconfig`, `stylecop.json`, `LICENSE`
  - `Jellyfin.Plugin.Lumen.slnx`
  - `src/Jellyfin.Plugin.Lumen/Jellyfin.Plugin.Lumen.csproj`
  - `src/Jellyfin.Plugin.Lumen/LumenPlugin.cs`
  - `src/Jellyfin.Plugin.Lumen/Configuration/PluginConfiguration.cs` (minimal; expanded in Task 3)
  - `src/Jellyfin.Plugin.Lumen/ServiceRegistrator.cs` (empty; filled in later tasks)
  - `tests/Jellyfin.Plugin.Lumen.Tests/Jellyfin.Plugin.Lumen.Tests.csproj`
  - `tests/Jellyfin.Plugin.Lumen.Tests/LumenPluginTests.cs`
  - `scripts/dev.sh`
- Test: `tests/Jellyfin.Plugin.Lumen.Tests/LumenPluginTests.cs`

**Interfaces:**
- Produces:
  - `LumenPlugin.PluginId` (`Guid`)
  - `LumenPlugin.Instance` (`LumenPlugin?`, static)
  - `class PluginConfiguration : BasePluginConfiguration`
  - `class ServiceRegistrator : IPluginServiceRegistrator`
  - `./scripts/dev.sh` builds, deploys, and restarts the dev server

- [ ] **Step 1: Create `Directory.Build.props`**

```xml
<Project>
  <PropertyGroup>
    <Version>0.1.0.0</Version>
    <AssemblyVersion>0.1.0.0</AssemblyVersion>
    <FileVersion>0.1.0.0</FileVersion>
    <LangVersion>latest</LangVersion>
    <Nullable>enable</Nullable>
    <ImplicitUsings>enable</ImplicitUsings>
    <TreatWarningsAsErrors>true</TreatWarningsAsErrors>
    <AnalysisLevel>latest-recommended</AnalysisLevel>
    <EnforceCodeStyleInBuild>true</EnforceCodeStyleInBuild>
    <GenerateDocumentationFile>true</GenerateDocumentationFile>
  </PropertyGroup>
  <ItemGroup>
    <AdditionalFiles Include="$(MSBuildThisFileDirectory)stylecop.json" Link="stylecop.json" />
  </ItemGroup>
</Project>
```

- [ ] **Step 2: Create `Directory.Packages.props`**

These versions were current on 2026-10-06. If `dotnet restore` reports a version that doesn't exist, run `dotnet package search <Id> --exact-match` and use the latest stable version.

```xml
<Project>
  <PropertyGroup>
    <ManagePackageVersionsCentrally>true</ManagePackageVersionsCentrally>
  </PropertyGroup>
  <ItemGroup>
    <GlobalPackageReference Include="StyleCop.Analyzers" Version="1.2.0-beta.556" />
  </ItemGroup>
  <ItemGroup>
    <PackageVersion Include="Jellyfin.Controller" Version="12.1.0" />
    <PackageVersion Include="Jellyfin.Model" Version="12.1.0" />
    <PackageVersion Include="Microsoft.NET.Test.Sdk" Version="18.10.1" />
    <PackageVersion Include="xunit" Version="2.9.3" />
    <PackageVersion Include="xunit.runner.visualstudio" Version="4.0.0" />
    <PackageVersion Include="coverlet.collector" Version="10.1.0" />
    <PackageVersion Include="NSubstitute" Version="5.3.0" />
    <PackageVersion Include="Microsoft.AspNetCore.TestHost" Version="10.0.12" />
    <PackageVersion Include="Microsoft.Extensions.TimeProvider.Testing" Version="10.0.0" />
  </ItemGroup>
</Project>
```

- [ ] **Step 3: Create `.editorconfig` and `stylecop.json`**

`.editorconfig`:
```ini
root = true

[*]
indent_style = space
indent_size = 4
end_of_line = lf
charset = utf-8
insert_final_newline = true
trim_trailing_whitespace = true

[*.{json,yml,yaml,ts,tsx,js,mjs,css,html,md}]
indent_size = 2

[*.cs]
csharp_style_namespace_declarations = file_scoped:warning
dotnet_sort_system_directives_first = true
# Rules disabled for this codebase (rationale in parentheses)
dotnet_diagnostic.SA1101.severity = none   # (no `this.` prefix; we use _fields)
dotnet_diagnostic.SA1309.severity = none   # (_field naming is our convention)
dotnet_diagnostic.SA1633.severity = none   # (no per-file license headers; LICENSE covers the repo)
dotnet_diagnostic.SA1600.severity = none   # (docs not required on every member)
dotnet_diagnostic.SA1602.severity = none
dotnet_diagnostic.SA1611.severity = none
dotnet_diagnostic.SA1615.severity = none
dotnet_diagnostic.SA1623.severity = none
dotnet_diagnostic.SA1413.severity = none   # (trailing commas optional)
dotnet_diagnostic.SA1200.severity = none   # (usings outside file-scoped namespace)
dotnet_diagnostic.CS1591.severity = none   # (missing XML comment on public member)
dotnet_diagnostic.CA1848.severity = none   # (LoggerMessage delegates are overkill for warn-level logs)
dotnet_diagnostic.CA2007.severity = none   # (ASP.NET Core has no SynchronizationContext)
dotnet_diagnostic.CA1515.severity = none   # (plugin types must be public for Jellyfin discovery)

[tests/**.cs]
dotnet_diagnostic.CA1707.severity = none   # (underscores in test names)
dotnet_diagnostic.CA2000.severity = none
```

`stylecop.json`:
```json
{
  "$schema": "https://raw.githubusercontent.com/DotNetAnalyzers/StyleCopAnalyzers/master/StyleCop.Analyzers/StyleCop.Analyzers/Settings/stylecop.schema.json",
  "settings": {
    "orderingRules": { "usingDirectivesPlacement": "outsideNamespace" },
    "documentationRules": { "documentInternalElements": false }
  }
}
```

- [ ] **Step 4: Create `LICENSE`**

Run:
```bash
curl -fsSL https://www.gnu.org/licenses/gpl-3.0.txt -o LICENSE && head -3 LICENSE
```
Expected: the first lines show `GNU GENERAL PUBLIC LICENSE` / `Version 3, 29 June 2007`.

- [ ] **Step 5: Create the plugin project**

`src/Jellyfin.Plugin.Lumen/Jellyfin.Plugin.Lumen.csproj`:
```xml
<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <TargetFramework>net10.0</TargetFramework>
    <RootNamespace>Jellyfin.Plugin.Lumen</RootNamespace>
    <AssemblyName>Jellyfin.Plugin.Lumen</AssemblyName>
  </PropertyGroup>
  <ItemGroup>
    <FrameworkReference Include="Microsoft.AspNetCore.App" />
    <PackageReference Include="Jellyfin.Controller" ExcludeAssets="runtime" />
    <PackageReference Include="Jellyfin.Model" ExcludeAssets="runtime" />
  </ItemGroup>
  <ItemGroup>
    <InternalsVisibleTo Include="Jellyfin.Plugin.Lumen.Tests" />
  </ItemGroup>
</Project>
```

`src/Jellyfin.Plugin.Lumen/Configuration/PluginConfiguration.cs`:
```csharp
using MediaBrowser.Model.Plugins;

namespace Jellyfin.Plugin.Lumen.Configuration;

/// <summary>Lumen settings, persisted by Jellyfin as XML.</summary>
public class PluginConfiguration : BasePluginConfiguration
{
}
```

`src/Jellyfin.Plugin.Lumen/LumenPlugin.cs`:
```csharp
using Jellyfin.Plugin.Lumen.Configuration;
using MediaBrowser.Common.Configuration;
using MediaBrowser.Common.Plugins;
using MediaBrowser.Model.Plugins;
using MediaBrowser.Model.Serialization;

namespace Jellyfin.Plugin.Lumen;

/// <summary>Lumen plugin entry point.</summary>
public class LumenPlugin : BasePlugin<PluginConfiguration>, IHasWebPages
{
    public static readonly Guid PluginId = Guid.Parse("186f9cb8-ba8e-4555-a700-ffa619f48264");

    public LumenPlugin(IApplicationPaths applicationPaths, IXmlSerializer xmlSerializer)
        : base(applicationPaths, xmlSerializer)
    {
        Instance = this;
    }

    /// <summary>Gets the running plugin instance (set by Jellyfin when it constructs the plugin).</summary>
    public static LumenPlugin? Instance { get; private set; }

    public override string Name => "Lumen";

    public override Guid Id => PluginId;

    public override string Description => "A cinematic home screen and details pages for Jellyfin.";

    public IEnumerable<PluginPageInfo> GetPages() => [];
}
```

`src/Jellyfin.Plugin.Lumen/ServiceRegistrator.cs`:
```csharp
using MediaBrowser.Controller;
using MediaBrowser.Controller.Plugins;
using Microsoft.Extensions.DependencyInjection;

namespace Jellyfin.Plugin.Lumen;

/// <summary>Registers Lumen services with Jellyfin's web host container.</summary>
public sealed class ServiceRegistrator : IPluginServiceRegistrator
{
    public void RegisterServices(IServiceCollection serviceCollection, IServerApplicationHost applicationHost)
    {
    }
}
```

- [ ] **Step 6: Create the test project with a failing test**

`tests/Jellyfin.Plugin.Lumen.Tests/Jellyfin.Plugin.Lumen.Tests.csproj`:
```xml
<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <TargetFramework>net10.0</TargetFramework>
    <IsPackable>false</IsPackable>
    <GenerateDocumentationFile>false</GenerateDocumentationFile>
  </PropertyGroup>
  <ItemGroup>
    <FrameworkReference Include="Microsoft.AspNetCore.App" />
    <PackageReference Include="Jellyfin.Controller" />
    <PackageReference Include="Jellyfin.Model" />
    <PackageReference Include="Microsoft.NET.Test.Sdk" />
    <PackageReference Include="xunit" />
    <PackageReference Include="xunit.runner.visualstudio" />
    <PackageReference Include="coverlet.collector" />
    <PackageReference Include="NSubstitute" />
    <PackageReference Include="Microsoft.AspNetCore.TestHost" />
    <PackageReference Include="Microsoft.Extensions.TimeProvider.Testing" />
  </ItemGroup>
  <ItemGroup>
    <ProjectReference Include="../../src/Jellyfin.Plugin.Lumen/Jellyfin.Plugin.Lumen.csproj" />
  </ItemGroup>
</Project>
```

`tests/Jellyfin.Plugin.Lumen.Tests/LumenPluginTests.cs`:
```csharp
using MediaBrowser.Common.Configuration;
using MediaBrowser.Model.Serialization;
using NSubstitute;
using Xunit;

namespace Jellyfin.Plugin.Lumen.Tests;

public class LumenPluginTests
{
    [Fact]
    public void Plugin_HasStableIdentity()
    {
        var paths = Substitute.For<IApplicationPaths>();
        paths.PluginsPath.Returns("/tmp/lumen-tests/plugins");
        paths.PluginConfigurationsPath.Returns("/tmp/lumen-tests/config");

        var plugin = new LumenPlugin(paths, Substitute.For<IXmlSerializer>());

        Assert.Equal("Lumen", plugin.Name);
        Assert.Equal(Guid.Parse("186f9cb8-ba8e-4555-a700-ffa619f48264"), plugin.Id);
        Assert.Same(plugin, LumenPlugin.Instance);
    }
}
```

Create the solution:
```bash
source scripts/env.sh
dotnet new sln --format slnx -n Jellyfin.Plugin.Lumen
dotnet sln Jellyfin.Plugin.Lumen.slnx add src/Jellyfin.Plugin.Lumen tests/Jellyfin.Plugin.Lumen.Tests
```

- [ ] **Step 7: Run the tests**

Run: `source scripts/env.sh && dotnet test --nologo`

Expected: `Passed! - Failed: 0, Passed: 1`. The test passes immediately because the code was written in Step 5. Confirm it can fail by temporarily changing `"Lumen"` in the test to `"X"`, run again, see `Assert.Equal() Failure`, then revert.

If the build fails on analyzer warnings, fix them in the code. Typical fixes: add `sealed`, or put `using` directives in the order the analyzer asks for.

- [ ] **Step 8: Create `scripts/dev.sh`**

```bash
#!/usr/bin/env bash
# Build the plugin, deploy it into the portable dev server, and (re)start the server on :8096.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
source "$ROOT/scripts/env.sh"

VERSION="$(grep -oP '(?<=<Version>)[^<]+' "$ROOT/Directory.Build.props")"
dotnet publish "$ROOT/src/Jellyfin.Plugin.Lumen" -c Debug -o "$ROOT/artifacts/plugin" --nologo -v quiet

rm -rf "$LUMEN_DEV_HOME/data/plugins"/Lumen_*
PLUGIN_DIR="$LUMEN_DEV_HOME/data/plugins/Lumen_$VERSION"
mkdir -p "$PLUGIN_DIR"
cp "$ROOT/artifacts/plugin/Jellyfin.Plugin.Lumen.dll" "$PLUGIN_DIR/"

PID_FILE="$LUMEN_DEV_HOME/jellyfin.pid"
if [[ -f "$PID_FILE" ]] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
  kill "$(cat "$PID_FILE")"
  while kill -0 "$(cat "$PID_FILE")" 2>/dev/null; do sleep 0.5; done
fi

"$LUMEN_DEV_HOME/jellyfin/jellyfin" \
  --datadir "$LUMEN_DEV_HOME/data" --configdir "$LUMEN_DEV_HOME/config" \
  --cachedir "$LUMEN_DEV_HOME/cache" --logdir "$LUMEN_DEV_HOME/log" \
  --ffmpeg "$LUMEN_DEV_HOME/ffmpeg/ffmpeg" > "$LUMEN_DEV_HOME/log/console.log" 2>&1 &
echo $! > "$PID_FILE"

for _ in $(seq 1 90); do curl -sf http://localhost:8096/health >/dev/null && break; sleep 1; done
curl -sf http://localhost:8096/health >/dev/null || { echo "Server did not become healthy; see $LUMEN_DEV_HOME/log/console.log"; exit 1; }
echo "Jellyfin dev server: http://localhost:8096  (plugin Lumen $VERSION)"
```

- [ ] **Step 9: Deploy and verify the plugin loads**

Run:
```bash
chmod +x scripts/dev.sh && ./scripts/dev.sh && grep -h "Lumen" "$LUMEN_DEV_HOME"/log/*.log | tail -5
```
Expected: the script prints `Jellyfin dev server: http://localhost:8096  (plugin Lumen 0.1.0.0)`, and a log line contains `Loaded plugin: Lumen 0.1.0.0`.

- [ ] **Step 10: Commit**

```bash
git add Directory.Build.props Directory.Packages.props .editorconfig stylecop.json LICENSE Jellyfin.Plugin.Lumen.slnx src tests scripts/dev.sh
git commit -m "feat: scaffold Lumen plugin, test project, and dev deploy script" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Configuration model and migrator

**Files:**
- Modify: `src/Jellyfin.Plugin.Lumen/Configuration/PluginConfiguration.cs`
- Create:
  - `src/Jellyfin.Plugin.Lumen/Configuration/SectionDefinition.cs`
  - `src/Jellyfin.Plugin.Lumen/Configuration/SectionTypes.cs`
  - `src/Jellyfin.Plugin.Lumen/Configuration/DefaultSections.cs`
  - `src/Jellyfin.Plugin.Lumen/Configuration/ConfigMigrator.cs`
- Test: `tests/Jellyfin.Plugin.Lumen.Tests/Configuration/ConfigMigratorTests.cs`, `tests/Jellyfin.Plugin.Lumen.Tests/Configuration/SectionDefinitionTests.cs`

**Interfaces:**
- Produces:
  - `PluginConfiguration` properties: `SchemaVersion`, `ConfigVersion`, `Enabled`, `HomeTakeover`, `DetailsTakeover`, `AccentColor`, `HeroSource`, `HeroCollectionId`, `HeroCount`, `HeroIntervalSeconds`, `TrailerPreview`, `TrailerDelaySeconds`, `Sections`.
  - `PluginConfiguration.CurrentSchemaVersion` (`const int` = 1).
  - `enum HeroSource { RecentlyAdded, TopRatedUnplayed, Collection }`
  - `SectionDefinition { Guid Id; string Type; bool Enabled; string? Title; List<SectionParam> Params; string? GetParam(string); int GetIntParam(string,int); Guid? GetGuidParam(string) }`
  - `SectionParam { string Name; string Value }`
  - `static class SectionTypes`: `ContinueWatching`, `NextUp`, `RecentlyAdded`, `BecauseYouWatched`, `Genre`, `NewForYou`, `Curated`.
  - `sealed record LibraryInfo(Guid Id, string Name, string? CollectionType)`
  - `static List<SectionDefinition> DefaultSections.Create(IReadOnlyList<LibraryInfo>)`
  - `static bool ConfigMigrator.Migrate(PluginConfiguration, IReadOnlyList<LibraryInfo>)` returns true if it changed anything.

- [ ] **Step 1: Write the failing tests**

`tests/Jellyfin.Plugin.Lumen.Tests/Configuration/ConfigMigratorTests.cs`:
```csharp
using Jellyfin.Plugin.Lumen.Configuration;
using Xunit;

namespace Jellyfin.Plugin.Lumen.Tests.Configuration;

public class ConfigMigratorTests
{
    private static readonly LibraryInfo Movies = new(Guid.NewGuid(), "Movies", "Movies");
    private static readonly LibraryInfo Shows = new(Guid.NewGuid(), "Shows", "TvShows");
    private static readonly LibraryInfo Music = new(Guid.NewGuid(), "Music", "Music");

    [Fact]
    public void FreshConfig_IsSeededWithDefaultSections()
    {
        var config = new PluginConfiguration();

        var changed = ConfigMigrator.Migrate(config, [Movies, Shows, Music]);

        Assert.True(changed);
        Assert.Equal(PluginConfiguration.CurrentSchemaVersion, config.SchemaVersion);
        Assert.Equal(
            [SectionTypes.ContinueWatching, SectionTypes.NextUp, SectionTypes.BecauseYouWatched, SectionTypes.NewForYou,
             SectionTypes.RecentlyAdded, SectionTypes.RecentlyAdded, SectionTypes.Genre],
            config.Sections.Select(s => s.Type));
        var recent = config.Sections.Where(s => s.Type == SectionTypes.RecentlyAdded).ToList();
        Assert.Equal(Movies.Id, recent[0].GetGuidParam("libraryId"));
        Assert.Equal(Shows.Id, recent[1].GetGuidParam("libraryId"));
        Assert.All(config.Sections, s => Assert.NotEqual(Guid.Empty, s.Id));
        Assert.Equal(config.Sections.Count, config.Sections.Select(s => s.Id).Distinct().Count());
    }

    [Fact]
    public void NoVideoLibraries_AddsSingleAllLibrariesRecentlyAdded()
    {
        var config = new PluginConfiguration();

        ConfigMigrator.Migrate(config, [Music]);

        var recent = Assert.Single(config.Sections, s => s.Type == SectionTypes.RecentlyAdded);
        Assert.Null(recent.GetParam("libraryId"));
    }

    [Fact]
    public void CurrentConfig_IsUntouched()
    {
        var config = new PluginConfiguration { SchemaVersion = PluginConfiguration.CurrentSchemaVersion };

        var changed = ConfigMigrator.Migrate(config, [Movies]);

        Assert.False(changed);
        Assert.Empty(config.Sections);
    }

    [Fact]
    public void LegacyConfigWithSections_KeepsThem()
    {
        var existing = new SectionDefinition { Id = Guid.NewGuid(), Type = SectionTypes.NextUp };
        var config = new PluginConfiguration { SchemaVersion = 0, Sections = [existing] };

        ConfigMigrator.Migrate(config, [Movies]);

        Assert.Same(existing, Assert.Single(config.Sections));
        Assert.Equal(PluginConfiguration.CurrentSchemaVersion, config.SchemaVersion);
    }

    [Fact]
    public void Defaults_MatchSpec()
    {
        var config = new PluginConfiguration();

        Assert.True(config.Enabled);
        Assert.True(config.HomeTakeover);
        Assert.True(config.DetailsTakeover);
        Assert.Equal("#f5a524", config.AccentColor);
        Assert.Equal(HeroSource.RecentlyAdded, config.HeroSource);
        Assert.Equal(5, config.HeroCount);
        Assert.Equal(8, config.HeroIntervalSeconds);
        Assert.True(config.TrailerPreview);
        Assert.Equal(4, config.TrailerDelaySeconds);
    }
}
```

`tests/Jellyfin.Plugin.Lumen.Tests/Configuration/SectionDefinitionTests.cs`:
```csharp
using Jellyfin.Plugin.Lumen.Configuration;
using Xunit;

namespace Jellyfin.Plugin.Lumen.Tests.Configuration;

public class SectionDefinitionTests
{
    private static SectionDefinition With(params (string Name, string Value)[] ps) =>
        new() { Params = ps.Select(p => new SectionParam { Name = p.Name, Value = p.Value }).ToList() };

    [Fact]
    public void GetParam_IsCaseInsensitive_AndTreatsEmptyAsMissing()
    {
        var def = With(("LibraryId", "abc"), ("tag", ""));

        Assert.Equal("abc", def.GetParam("libraryId"));
        Assert.Null(def.GetParam("tag"));
        Assert.Null(def.GetParam("missing"));
    }

    [Fact]
    public void TypedGetters_FallBackOnBadValues()
    {
        var id = Guid.NewGuid();
        var def = With(("count", "7"), ("bad", "x"), ("id", id.ToString()));

        Assert.Equal(7, def.GetIntParam("count", 3));
        Assert.Equal(3, def.GetIntParam("bad", 3));
        Assert.Equal(id, def.GetGuidParam("id"));
        Assert.Null(def.GetGuidParam("bad"));
    }
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `source scripts/env.sh && dotnet test --nologo --filter "FullyQualifiedName~Configuration"`

Expected: build FAILS with errors such as `The type or namespace name 'LibraryInfo' could not be found` and `'PluginConfiguration' does not contain a definition for 'Sections'`.

- [ ] **Step 3: Implement**

`src/Jellyfin.Plugin.Lumen/Configuration/PluginConfiguration.cs`:
```csharp
using System.Diagnostics.CodeAnalysis;
using MediaBrowser.Model.Plugins;

namespace Jellyfin.Plugin.Lumen.Configuration;

/// <summary>Where the home hero banner takes its items from.</summary>
public enum HeroSource
{
    RecentlyAdded,
    TopRatedUnplayed,
    Collection,
}

/// <summary>Lumen settings, persisted by Jellyfin as XML.</summary>
public class PluginConfiguration : BasePluginConfiguration
{
    public const int CurrentSchemaVersion = 1;

    /// <summary>Gets or sets the stored schema version; 0 means "never migrated".</summary>
    public int SchemaVersion { get; set; }

    /// <summary>Gets or sets a counter bumped on every save; used as a cache key.</summary>
    public int ConfigVersion { get; set; }

    public bool Enabled { get; set; } = true;

    public bool HomeTakeover { get; set; } = true;

    public bool DetailsTakeover { get; set; } = true;

    public string AccentColor { get; set; } = "#f5a524";

    public HeroSource HeroSource { get; set; } = HeroSource.RecentlyAdded;

    public Guid? HeroCollectionId { get; set; }

    public int HeroCount { get; set; } = 5;

    public int HeroIntervalSeconds { get; set; } = 8;

    public bool TrailerPreview { get; set; } = true;

    public int TrailerDelaySeconds { get; set; } = 4;

    [SuppressMessage("Usage", "CA2227:Collection properties should be read only", Justification = "XML serialization requires a setter.")]
    [SuppressMessage("Design", "CA1002:Do not expose generic lists", Justification = "XML serialization requires a concrete List.")]
    public List<SectionDefinition> Sections { get; set; } = [];
}
```

`src/Jellyfin.Plugin.Lumen/Configuration/SectionDefinition.cs`:
```csharp
using System.Diagnostics.CodeAnalysis;
using System.Globalization;

namespace Jellyfin.Plugin.Lumen.Configuration;

/// <summary>One configured home section. Parameters are name/value strings because the config is XML-serialized.</summary>
public class SectionDefinition
{
    public Guid Id { get; set; }

    public string Type { get; set; } = string.Empty;

    public bool Enabled { get; set; } = true;

    public string? Title { get; set; }

    [SuppressMessage("Usage", "CA2227:Collection properties should be read only", Justification = "XML serialization requires a setter.")]
    [SuppressMessage("Design", "CA1002:Do not expose generic lists", Justification = "XML serialization requires a concrete List.")]
    public List<SectionParam> Params { get; set; } = [];

    /// <summary>Returns the parameter value, or null when absent or empty.</summary>
    public string? GetParam(string name)
    {
        var value = Params.FirstOrDefault(p => string.Equals(p.Name, name, StringComparison.OrdinalIgnoreCase))?.Value;
        return string.IsNullOrWhiteSpace(value) ? null : value.Trim();
    }

    public int GetIntParam(string name, int fallback) =>
        int.TryParse(GetParam(name), NumberStyles.Integer, CultureInfo.InvariantCulture, out var value) ? value : fallback;

    public Guid? GetGuidParam(string name) => Guid.TryParse(GetParam(name), out var value) ? value : null;
}

/// <summary>A single section parameter.</summary>
public class SectionParam
{
    public string Name { get; set; } = string.Empty;

    public string Value { get; set; } = string.Empty;
}
```

`src/Jellyfin.Plugin.Lumen/Configuration/SectionTypes.cs`:
```csharp
namespace Jellyfin.Plugin.Lumen.Configuration;

/// <summary>Section type keys shared by config, providers, and the admin UI.</summary>
public static class SectionTypes
{
    public const string ContinueWatching = "ContinueWatching";
    public const string NextUp = "NextUp";
    public const string RecentlyAdded = "RecentlyAdded";
    public const string BecauseYouWatched = "BecauseYouWatched";
    public const string Genre = "Genre";
    public const string NewForYou = "NewForYou";
    public const string Curated = "Curated";
}
```

`src/Jellyfin.Plugin.Lumen/Configuration/DefaultSections.cs`:
```csharp
using System.Globalization;

namespace Jellyfin.Plugin.Lumen.Configuration;

/// <summary>A library as seen by configuration code.</summary>
public sealed record LibraryInfo(Guid Id, string Name, string? CollectionType);

/// <summary>Builds the default section list for a fresh install.</summary>
public static class DefaultSections
{
    public static List<SectionDefinition> Create(IReadOnlyList<LibraryInfo> libraries)
    {
        var sections = new List<SectionDefinition>
        {
            New(SectionTypes.ContinueWatching),
            New(SectionTypes.NextUp),
            New(SectionTypes.BecauseYouWatched, ("maxRows", "2")),
            New(SectionTypes.NewForYou, ("days", "14")),
        };

        var videoLibraries = libraries.Where(IsVideoLibrary).ToList();
        if (videoLibraries.Count == 0)
        {
            sections.Add(New(SectionTypes.RecentlyAdded));
        }
        else
        {
            foreach (var library in videoLibraries)
            {
                var section = New(SectionTypes.RecentlyAdded, ("libraryId", library.Id.ToString("N", CultureInfo.InvariantCulture)));
                section.Title = $"Recently Added in {library.Name}";
                sections.Add(section);
            }
        }

        sections.Add(New(SectionTypes.Genre, ("genreCount", "3")));
        return sections;
    }

    private static bool IsVideoLibrary(LibraryInfo library) =>
        string.Equals(library.CollectionType, "movies", StringComparison.OrdinalIgnoreCase)
        || string.Equals(library.CollectionType, "tvshows", StringComparison.OrdinalIgnoreCase);

    private static SectionDefinition New(string type, params (string Name, string Value)[] parameters) => new()
    {
        Id = Guid.NewGuid(),
        Type = type,
        Enabled = true,
        Params = parameters.Select(p => new SectionParam { Name = p.Name, Value = p.Value }).ToList(),
    };
}
```

`src/Jellyfin.Plugin.Lumen/Configuration/ConfigMigrator.cs`:
```csharp
namespace Jellyfin.Plugin.Lumen.Configuration;

/// <summary>Upgrades stored configuration to <see cref="PluginConfiguration.CurrentSchemaVersion"/>. Pure.</summary>
public static class ConfigMigrator
{
    /// <returns>True when the configuration was changed and must be saved.</returns>
    public static bool Migrate(PluginConfiguration config, IReadOnlyList<LibraryInfo> libraries)
    {
        var changed = false;

        if (config.SchemaVersion < 1)
        {
            if (config.Sections.Count == 0)
            {
                config.Sections = DefaultSections.Create(libraries);
            }

            config.SchemaVersion = 1;
            changed = true;
        }

        // Future migrations: `if (config.SchemaVersion < 2) { ...; config.SchemaVersion = 2; changed = true; }`
        return changed;
    }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `source scripts/env.sh && dotnet test --nologo --filter "FullyQualifiedName~Configuration"`

Expected: `Passed! - Failed: 0, Passed: 7`.

- [ ] **Step 5: Commit**

```bash
git add src tests
git commit -m "feat: add configuration model, defaults, and schema migrator" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Section provider contracts and config validator

**Files:**
- Create:
  - `src/Jellyfin.Plugin.Lumen/Home/IHomeSectionProvider.cs`
  - `src/Jellyfin.Plugin.Lumen/Home/SectionParameter.cs`
  - `src/Jellyfin.Plugin.Lumen/Home/HomeRow.cs`
  - `src/Jellyfin.Plugin.Lumen/Home/HomeContext.cs`
  - `src/Jellyfin.Plugin.Lumen/Home/WatchHistory.cs`
  - `src/Jellyfin.Plugin.Lumen/Home/QueryOptions.cs`
  - `src/Jellyfin.Plugin.Lumen/Configuration/ConfigValidator.cs`
  - `tests/Jellyfin.Plugin.Lumen.Tests/TestData.cs`
  - `tests/Jellyfin.Plugin.Lumen.Tests/FakeSectionProvider.cs`
- Test: `tests/Jellyfin.Plugin.Lumen.Tests/Configuration/ConfigValidatorTests.cs`

**Interfaces:**
- Consumes: `PluginConfiguration`, `SectionDefinition`, `HeroSource` (Task 3).
- Produces:
  - `IHomeSectionProvider { string Type; string DisplayName; IReadOnlyList<SectionParameter> Parameters; IReadOnlyList<string> Validate(SectionDefinition); Task<IReadOnlyList<HomeRow>> GetRowsAsync(HomeContext, SectionDefinition, CancellationToken) }`
  - `enum SectionParameterKind { Library, Collection, Playlist, Text, Integer }`
  - `sealed record SectionParameter(string Name, string Label, SectionParameterKind Kind, bool Required = false, string? DefaultValue = null, int? Min = null, int? Max = null)`
  - `sealed record HomeRow(string Id, string Type, string Title, IReadOnlyList<BaseItem> Items)` with `static IReadOnlyList<HomeRow> Single(SectionDefinition def, string defaultTitle, IReadOnlyList<BaseItem> items)` and `static string RowId(SectionDefinition def, int index)`
  - `sealed class HomeContext(User user, DateTimeOffset now, Func<Task<WatchHistory>> watchHistory)` with `User`, `Now`, `ItemLimit` (= 20), and `Task<WatchHistory> GetWatchHistoryAsync()` (computed once)
  - `sealed record WatchedEntry(BaseItem Item, Guid? SeriesId, string? SeriesName, IReadOnlyList<string> Genres, DateTime LastPlayed)` and `sealed record WatchHistory(IReadOnlyList<WatchedEntry> Entries)` with `static WatchHistory Empty`
  - `static class QueryOptions { static DtoOptions Full(); static DtoOptions IdsOnly() }`
  - `sealed class ConfigValidator(IEnumerable<IHomeSectionProvider>)` with `IReadOnlyList<string> Validate(PluginConfiguration)`
  - Test helpers: `TestData.User()`, `TestData.Movie(...)`, `TestData.Series(...)`, `TestData.Episode(...)`, `TestData.Context(...)`, `TestData.Section(...)`, `TestData.WithImages(...)`, `TestData.UserData(...)`; and `FakeSectionProvider`

- [ ] **Step 1: Write the contracts (no logic, so they don't need their own tests)**

`src/Jellyfin.Plugin.Lumen/Home/SectionParameter.cs`:
```csharp
namespace Jellyfin.Plugin.Lumen.Home;

/// <summary>How the admin UI renders a parameter, and how the validator checks it.</summary>
public enum SectionParameterKind
{
    Library,
    Collection,
    Playlist,
    Text,
    Integer,
}

/// <summary>A parameter a section type accepts.</summary>
public sealed record SectionParameter(
    string Name,
    string Label,
    SectionParameterKind Kind,
    bool Required = false,
    string? DefaultValue = null,
    int? Min = null,
    int? Max = null);
```

`src/Jellyfin.Plugin.Lumen/Home/HomeRow.cs`:
```csharp
using System.Globalization;
using Jellyfin.Plugin.Lumen.Configuration;
using MediaBrowser.Controller.Entities;

namespace Jellyfin.Plugin.Lumen.Home;

/// <summary>One rendered row on the home screen (domain items; mapped to DTOs by the home service).</summary>
public sealed record HomeRow(string Id, string Type, string Title, IReadOnlyList<BaseItem> Items)
{
    public static string RowId(SectionDefinition definition, int index) =>
        string.Create(CultureInfo.InvariantCulture, $"{definition.Id:N}:{index}");

    /// <summary>Returns a one-row list, or an empty list when there are no items.</summary>
    public static IReadOnlyList<HomeRow> Single(SectionDefinition definition, string defaultTitle, IReadOnlyList<BaseItem> items) =>
        items.Count == 0
            ? []
            : [new HomeRow(RowId(definition, 0), definition.Type, definition.Title ?? defaultTitle, items)];
}
```

`src/Jellyfin.Plugin.Lumen/Home/WatchHistory.cs`:
```csharp
using MediaBrowser.Controller.Entities;

namespace Jellyfin.Plugin.Lumen.Home;

/// <summary>A recently played movie or episode. Episodes carry their series' genres.</summary>
public sealed record WatchedEntry(BaseItem Item, Guid? SeriesId, string? SeriesName, IReadOnlyList<string> Genres, DateTime LastPlayed);

/// <summary>The user's recent plays, most recent first.</summary>
public sealed record WatchHistory(IReadOnlyList<WatchedEntry> Entries)
{
    public static WatchHistory Empty { get; } = new([]);
}
```

`src/Jellyfin.Plugin.Lumen/Home/HomeContext.cs`:
```csharp
using Jellyfin.Database.Implementations.Entities;

namespace Jellyfin.Plugin.Lumen.Home;

/// <summary>Per-request inputs shared by all section providers.</summary>
public sealed class HomeContext
{
    private readonly Lazy<Task<WatchHistory>> _watchHistory;

    public HomeContext(User user, DateTimeOffset now, Func<Task<WatchHistory>> watchHistory)
    {
        User = user;
        Now = now;
        _watchHistory = new Lazy<Task<WatchHistory>>(watchHistory, LazyThreadSafetyMode.ExecutionAndPublication);
    }

    public User User { get; }

    public DateTimeOffset Now { get; }

    public int ItemLimit { get; init; } = 20;

    /// <summary>Computed at most once per home build and shared across providers.</summary>
    public Task<WatchHistory> GetWatchHistoryAsync() => _watchHistory.Value;
}
```

`src/Jellyfin.Plugin.Lumen/Home/QueryOptions.cs`:
```csharp
using MediaBrowser.Controller.Dto;

namespace Jellyfin.Plugin.Lumen.Home;

/// <summary>
/// DtoOptions for library queries. The repository uses them to decide which columns and images to load,
/// so items that are displayed, or whose Genres/images are read, must use <see cref="Full"/>.
/// </summary>
public static class QueryOptions
{
    public static DtoOptions Full() => new(true);

    public static DtoOptions IdsOnly() => new(false) { EnableImages = false, EnableUserData = false };
}
```

`src/Jellyfin.Plugin.Lumen/Home/IHomeSectionProvider.cs`:
```csharp
using Jellyfin.Plugin.Lumen.Configuration;

namespace Jellyfin.Plugin.Lumen.Home;

/// <summary>Produces the rows for one section type. Add a row type by implementing this and registering it.</summary>
public interface IHomeSectionProvider
{
    string Type { get; }

    string DisplayName { get; }

    /// <summary>Gets the parameters; these drive the admin form and generic validation.</summary>
    IReadOnlyList<SectionParameter> Parameters { get; }

    /// <summary>Provider-specific rules beyond <see cref="Parameters"/>; returns human-readable errors.</summary>
    IReadOnlyList<string> Validate(SectionDefinition definition);

    /// <summary>Returns zero or more rows; an empty list means the section is omitted.</summary>
    Task<IReadOnlyList<HomeRow>> GetRowsAsync(HomeContext context, SectionDefinition definition, CancellationToken cancellationToken);
}
```

- [ ] **Step 2: Add test helpers**

`tests/Jellyfin.Plugin.Lumen.Tests/TestData.cs`:
```csharp
using Jellyfin.Database.Implementations.Entities;
using Jellyfin.Plugin.Lumen.Configuration;
using Jellyfin.Plugin.Lumen.Home;
using MediaBrowser.Controller.Entities;
using MediaBrowser.Controller.Entities.Movies;
using MediaBrowser.Controller.Entities.TV;
using MediaBrowser.Model.Entities;

namespace Jellyfin.Plugin.Lumen.Tests;

internal static class TestData
{
    public static readonly DateTimeOffset Now = new(2026, 10, 6, 12, 0, 0, TimeSpan.Zero);

    public static User User(string name = "alice") => new(name, "auth", "reset") { Id = Guid.NewGuid() };

    public static Movie Movie(string name, params string[] genres) =>
        new() { Id = Guid.NewGuid(), Name = name, Genres = genres, DateCreated = Now.UtcDateTime };

    public static Series Series(string name, params string[] genres) =>
        new() { Id = Guid.NewGuid(), Name = name, Genres = genres, DateCreated = Now.UtcDateTime };

    public static Episode Episode(Series series, int season, int number) => new()
    {
        Id = Guid.NewGuid(),
        Name = $"{series.Name} S{season}E{number}",
        SeriesId = series.Id,
        SeriesName = series.Name,
        ParentIndexNumber = season,
        IndexNumber = number,
        DateCreated = Now.UtcDateTime,
    };

    public static T WithImages<T>(this T item, params ImageType[] types)
        where T : BaseItem
    {
        item.ImageInfos = types.Select(t => new ItemImageInfo { Path = "/img/" + t, Type = t }).ToArray();
        return item;
    }

    public static UserItemData UserData(bool played = false, DateTime? lastPlayed = null) =>
        new() { Key = "k", Played = played, LastPlayedDate = lastPlayed };

    public static HomeContext Context(User user, WatchHistory? history = null) =>
        new(user, Now, () => Task.FromResult(history ?? WatchHistory.Empty));

    public static SectionDefinition Section(string type, params (string Name, string Value)[] parameters) => new()
    {
        Id = Guid.NewGuid(),
        Type = type,
        Params = parameters.Select(p => new SectionParam { Name = p.Name, Value = p.Value }).ToList(),
    };
}
```

`tests/Jellyfin.Plugin.Lumen.Tests/FakeSectionProvider.cs`:
```csharp
using Jellyfin.Plugin.Lumen.Configuration;
using Jellyfin.Plugin.Lumen.Home;

namespace Jellyfin.Plugin.Lumen.Tests;

/// <summary>Configurable provider for validator and home-service tests.</summary>
internal sealed class FakeSectionProvider : IHomeSectionProvider
{
    public FakeSectionProvider(string type, params SectionParameter[] parameters)
    {
        Type = type;
        Parameters = parameters;
    }

    public string Type { get; }

    public string DisplayName => Type + " (fake)";

    public IReadOnlyList<SectionParameter> Parameters { get; }

    public Func<SectionDefinition, IReadOnlyList<string>> ValidateRule { get; set; } = _ => [];

    public Func<HomeContext, SectionDefinition, CancellationToken, Task<IReadOnlyList<HomeRow>>> Rows { get; set; } =
        (_, _, _) => Task.FromResult<IReadOnlyList<HomeRow>>([]);

    public IReadOnlyList<string> Validate(SectionDefinition definition) => ValidateRule(definition);

    public Task<IReadOnlyList<HomeRow>> GetRowsAsync(HomeContext context, SectionDefinition definition, CancellationToken cancellationToken) =>
        Rows(context, definition, cancellationToken);
}
```

- [ ] **Step 3: Write the failing validator tests**

`tests/Jellyfin.Plugin.Lumen.Tests/Configuration/ConfigValidatorTests.cs`:
```csharp
using Jellyfin.Plugin.Lumen.Configuration;
using Jellyfin.Plugin.Lumen.Home;
using Xunit;

namespace Jellyfin.Plugin.Lumen.Tests.Configuration;

public class ConfigValidatorTests
{
    private readonly FakeSectionProvider _counted = new(
        "Counted",
        new SectionParameter("count", "Count", SectionParameterKind.Integer, Required: true, Min: 1, Max: 5),
        new SectionParameter("libraryId", "Library", SectionParameterKind.Library));

    private ConfigValidator Validator => new([_counted, new FakeSectionProvider("Plain")]);

    private static PluginConfiguration Valid(params SectionDefinition[] sections) =>
        new() { SchemaVersion = 1, Sections = sections.ToList() };

    [Fact]
    public void ValidConfig_HasNoErrors()
    {
        var errors = Validator.Validate(Valid(TestData.Section("Counted", ("count", "3")), TestData.Section("Plain")));

        Assert.Empty(errors);
    }

    [Theory]
    [InlineData("f5a524")]
    [InlineData("#f5a52")]
    [InlineData("red")]
    [InlineData("#f5a524;}body{")]
    public void RejectsBadAccentColor(string color)
    {
        var config = Valid();
        config.AccentColor = color;

        Assert.Contains(Validator.Validate(config), e => e.Contains("Accent color", StringComparison.Ordinal));
    }

    [Fact]
    public void RejectsOutOfRangeHeroSettings()
    {
        var config = Valid();
        config.HeroCount = 0;
        config.HeroIntervalSeconds = 2;
        config.TrailerDelaySeconds = 31;

        var errors = Validator.Validate(config);

        Assert.Equal(3, errors.Count);
    }

    [Fact]
    public void CollectionHeroRequiresCollection()
    {
        var config = Valid();
        config.HeroSource = HeroSource.Collection;

        Assert.Contains(Validator.Validate(config), e => e.Contains("collection", StringComparison.OrdinalIgnoreCase));
    }

    [Fact]
    public void RejectsUnknownType_DuplicateIds_AndEmptyIds()
    {
        var a = TestData.Section("Plain");
        var b = TestData.Section("Plain");
        b.Id = a.Id;
        var c = TestData.Section("Nope");
        var d = TestData.Section("Plain");
        d.Id = Guid.Empty;

        var errors = Validator.Validate(Valid(a, b, c, d));

        Assert.Contains(errors, e => e.Contains("duplicate", StringComparison.OrdinalIgnoreCase));
        Assert.Contains(errors, e => e.Contains("unknown section type 'Nope'", StringComparison.Ordinal));
        Assert.Contains(errors, e => e.Contains("missing an id", StringComparison.OrdinalIgnoreCase));
    }

    [Theory]
    [InlineData(null, "is required")]
    [InlineData("abc", "must be a whole number")]
    [InlineData("9", "between 1 and 5")]
    public void ChecksIntegerParams(string? value, string expected)
    {
        var section = value is null ? TestData.Section("Counted") : TestData.Section("Counted", ("count", value));

        Assert.Contains(Validator.Validate(Valid(section)), e => e.Contains(expected, StringComparison.Ordinal));
    }

    [Fact]
    public void ChecksGuidParams_AndUnknownParams()
    {
        var section = TestData.Section("Counted", ("count", "2"), ("libraryId", "not-a-guid"), ("extra", "1"));

        var errors = Validator.Validate(Valid(section));

        Assert.Contains(errors, e => e.Contains("Library must be a valid id", StringComparison.Ordinal));
        Assert.Contains(errors, e => e.Contains("unknown parameter 'extra'", StringComparison.Ordinal));
    }

    [Fact]
    public void IncludesProviderSpecificErrors()
    {
        _counted.ValidateRule = _ => ["custom problem"];

        var errors = Validator.Validate(Valid(TestData.Section("Counted", ("count", "2"))));

        Assert.Contains(errors, e => e.EndsWith("custom problem", StringComparison.Ordinal));
    }

    [Fact]
    public void RejectsTooManySections()
    {
        var sections = Enumerable.Range(0, 31).Select(_ => TestData.Section("Plain")).ToArray();

        Assert.Contains(Validator.Validate(Valid(sections)), e => e.Contains("at most 30", StringComparison.Ordinal));
    }
}
```

- [ ] **Step 4: Run the tests to verify they fail**

Run: `source scripts/env.sh && dotnet test --nologo --filter "FullyQualifiedName~ConfigValidator"`

Expected: build FAILS with `The type or namespace name 'ConfigValidator' could not be found`.

- [ ] **Step 5: Implement `ConfigValidator`**

`src/Jellyfin.Plugin.Lumen/Configuration/ConfigValidator.cs`:
```csharp
using System.Globalization;
using System.Text.RegularExpressions;
using Jellyfin.Plugin.Lumen.Home;

namespace Jellyfin.Plugin.Lumen.Configuration;

/// <summary>Validates configuration before it is saved. Returns human-readable errors; empty means valid.</summary>
public sealed partial class ConfigValidator
{
    public const int MaxSections = 30;

    private readonly Dictionary<string, IHomeSectionProvider> _providers;

    public ConfigValidator(IEnumerable<IHomeSectionProvider> providers)
    {
        _providers = providers.ToDictionary(p => p.Type, StringComparer.OrdinalIgnoreCase);
    }

    public IReadOnlyList<string> Validate(PluginConfiguration config)
    {
        var errors = new List<string>();

        if (!HexColor().IsMatch(config.AccentColor ?? string.Empty))
        {
            errors.Add("Accent color must look like #RRGGBB.");
        }

        CheckRange(errors, "Hero item count", config.HeroCount, 1, 10);
        CheckRange(errors, "Hero rotation interval", config.HeroIntervalSeconds, 3, 60);
        CheckRange(errors, "Trailer delay", config.TrailerDelaySeconds, 0, 30);

        if (config.HeroSource == HeroSource.Collection && config.HeroCollectionId is null)
        {
            errors.Add("Hero source 'Collection' requires a collection.");
        }

        if (config.Sections.Count > MaxSections)
        {
            errors.Add($"There can be at most {MaxSections} sections.");
        }

        var seenIds = new HashSet<Guid>();
        for (var i = 0; i < config.Sections.Count; i++)
        {
            var section = config.Sections[i];
            var label = string.Create(CultureInfo.InvariantCulture, $"Section {i + 1} ({section.Type})");

            if (section.Id == Guid.Empty)
            {
                errors.Add($"{label}: is missing an id.");
            }
            else if (!seenIds.Add(section.Id))
            {
                errors.Add($"{label}: duplicate id.");
            }

            if (!_providers.TryGetValue(section.Type, out var provider))
            {
                errors.Add($"{label}: unknown section type '{section.Type}'.");
                continue;
            }

            ValidateParams(errors, label, section, provider);
            errors.AddRange(provider.Validate(section).Select(e => $"{label}: {e}"));
        }

        return errors;
    }

    private static void ValidateParams(List<string> errors, string label, SectionDefinition section, IHomeSectionProvider provider)
    {
        foreach (var parameter in provider.Parameters)
        {
            var value = section.GetParam(parameter.Name);
            if (value is null)
            {
                if (parameter.Required)
                {
                    errors.Add($"{label}: {parameter.Label} is required.");
                }

                continue;
            }

            switch (parameter.Kind)
            {
                case SectionParameterKind.Integer:
                    if (!int.TryParse(value, NumberStyles.Integer, CultureInfo.InvariantCulture, out var number))
                    {
                        errors.Add($"{label}: {parameter.Label} must be a whole number.");
                    }
                    else if ((parameter.Min is { } min && number < min) || (parameter.Max is { } max && number > max))
                    {
                        errors.Add(string.Create(
                            CultureInfo.InvariantCulture,
                            $"{label}: {parameter.Label} must be between {parameter.Min} and {parameter.Max}."));
                    }

                    break;
                case SectionParameterKind.Library or SectionParameterKind.Collection or SectionParameterKind.Playlist:
                    if (!Guid.TryParse(value, out _))
                    {
                        errors.Add($"{label}: {parameter.Label} must be a valid id.");
                    }

                    break;
                case SectionParameterKind.Text:
                    if (value.Length > 200)
                    {
                        errors.Add($"{label}: {parameter.Label} must be at most 200 characters.");
                    }

                    break;
            }
        }

        var known = provider.Parameters.Select(p => p.Name).ToHashSet(StringComparer.OrdinalIgnoreCase);
        foreach (var unknown in section.Params.Where(p => !known.Contains(p.Name)))
        {
            errors.Add($"{label}: unknown parameter '{unknown.Name}'.");
        }
    }

    private static void CheckRange(List<string> errors, string name, int value, int min, int max)
    {
        if (value < min || value > max)
        {
            errors.Add(string.Create(CultureInfo.InvariantCulture, $"{name} must be between {min} and {max}."));
        }
    }

    [GeneratedRegex("^#[0-9a-fA-F]{6}$")]
    private static partial Regex HexColor();
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `source scripts/env.sh && dotnet test --nologo --filter "FullyQualifiedName~ConfigValidator"`

Expected: `Passed! - Failed: 0, Passed: 14`.

- [ ] **Step 7: Commit**

```bash
git add src tests
git commit -m "feat: add section provider contracts and config validator" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Configuration store

**Files:**
- Create:
  - `src/Jellyfin.Plugin.Lumen/Configuration/ILumenConfigStore.cs`
  - `src/Jellyfin.Plugin.Lumen/Configuration/LumenConfigStore.cs`
  - `src/Jellyfin.Plugin.Lumen/Configuration/LumenPluginPersistence.cs`
  - `src/Jellyfin.Plugin.Lumen/Configuration/LibraryCatalog.cs`
- Test: `tests/Jellyfin.Plugin.Lumen.Tests/Configuration/LumenConfigStoreTests.cs`

**Interfaces:**
- Consumes: `ConfigMigrator`, `ConfigValidator`, `LibraryInfo`, `PluginConfiguration` (Tasks 3–4).
- Produces:
  - `interface ILumenConfigStore { PluginConfiguration Current { get; } ConfigSaveResult Save(PluginConfiguration); void ResetToDefaults(); }`
  - `sealed record ConfigSaveResult(bool Success, IReadOnlyList<string> Errors)`
  - `interface IPluginConfigPersistence { PluginConfiguration Load(); void Save(PluginConfiguration); }`
  - `interface ILibraryCatalog { IReadOnlyList<LibraryInfo> GetLibraries(); }`
  - `LumenPluginPersistence : IPluginConfigPersistence`, `LibraryCatalog : ILibraryCatalog`

- [ ] **Step 1: Write the failing tests**

`tests/Jellyfin.Plugin.Lumen.Tests/Configuration/LumenConfigStoreTests.cs`:
```csharp
using Jellyfin.Plugin.Lumen.Configuration;
using Jellyfin.Plugin.Lumen.Home;
using Microsoft.Extensions.Logging.Abstractions;
using Xunit;

namespace Jellyfin.Plugin.Lumen.Tests.Configuration;

public class LumenConfigStoreTests
{
    private readonly InMemoryPersistence _persistence = new();
    private readonly FakeLibraries _libraries = new();

    private LumenConfigStore CreateStore() => new(
        _persistence,
        _libraries,
        new ConfigValidator(new[] { SectionTypes.ContinueWatching, SectionTypes.NextUp, SectionTypes.RecentlyAdded, SectionTypes.BecauseYouWatched, SectionTypes.NewForYou, SectionTypes.Genre }
            .Select(t => (IHomeSectionProvider)new FakeSectionProvider(
                t,
                new SectionParameter("libraryId", "Library", SectionParameterKind.Library),
                new SectionParameter("maxRows", "Rows", SectionParameterKind.Integer),
                new SectionParameter("days", "Days", SectionParameterKind.Integer),
                new SectionParameter("genreCount", "Genres", SectionParameterKind.Integer)))),
        NullLogger<LumenConfigStore>.Instance);

    [Fact]
    public void Current_MigratesAndPersistsFreshConfigOnce()
    {
        var store = CreateStore();

        var first = store.Current;
        var second = store.Current;

        Assert.Equal(PluginConfiguration.CurrentSchemaVersion, first.SchemaVersion);
        Assert.NotEmpty(first.Sections);
        Assert.Equal(1, _persistence.SaveCount);
        Assert.Same(first, second);
    }

    [Fact]
    public void Save_RejectsInvalidConfig_WithoutPersisting()
    {
        var store = CreateStore();
        _ = store.Current;
        var invalid = new PluginConfiguration { AccentColor = "nope" };

        var result = store.Save(invalid);

        Assert.False(result.Success);
        Assert.NotEmpty(result.Errors);
        Assert.Equal(1, _persistence.SaveCount);
    }

    [Fact]
    public void Save_BumpsConfigVersion_AndStampsSchema()
    {
        var store = CreateStore();
        var before = store.Current.ConfigVersion;
        var incoming = new PluginConfiguration { SchemaVersion = 0, ConfigVersion = 999, AccentColor = "#112233" };

        var result = store.Save(incoming);

        Assert.True(result.Success);
        Assert.Equal(before + 1, _persistence.Stored.ConfigVersion);
        Assert.Equal(PluginConfiguration.CurrentSchemaVersion, _persistence.Stored.SchemaVersion);
        Assert.Equal("#112233", store.Current.AccentColor);
    }

    [Fact]
    public void ResetToDefaults_ReseedsSections_AndBumpsVersion()
    {
        var store = CreateStore();
        var before = store.Current.ConfigVersion;
        store.Save(new PluginConfiguration { Sections = [] });

        store.ResetToDefaults();

        Assert.NotEmpty(store.Current.Sections);
        Assert.Equal(before + 2, store.Current.ConfigVersion);
    }

    private sealed class InMemoryPersistence : IPluginConfigPersistence
    {
        public PluginConfiguration Stored { get; private set; } = new();

        public int SaveCount { get; private set; }

        public PluginConfiguration Load() => Stored;

        public void Save(PluginConfiguration configuration)
        {
            Stored = configuration;
            SaveCount++;
        }
    }

    private sealed class FakeLibraries : ILibraryCatalog
    {
        public IReadOnlyList<LibraryInfo> GetLibraries() => [new(Guid.NewGuid(), "Movies", "movies")];
    }
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `source scripts/env.sh && dotnet test --nologo --filter "FullyQualifiedName~LumenConfigStore"`

Expected: build FAILS with `The type or namespace name 'LumenConfigStore' could not be found`.

- [ ] **Step 3: Implement**

`src/Jellyfin.Plugin.Lumen/Configuration/ILumenConfigStore.cs`:
```csharp
namespace Jellyfin.Plugin.Lumen.Configuration;

/// <summary>Result of a configuration save.</summary>
public sealed record ConfigSaveResult(bool Success, IReadOnlyList<string> Errors);

/// <summary>Reads (migrated) configuration and saves validated configuration.</summary>
public interface ILumenConfigStore
{
    PluginConfiguration Current { get; }

    ConfigSaveResult Save(PluginConfiguration configuration);

    void ResetToDefaults();
}

/// <summary>Raw load/save of the plugin's XML configuration.</summary>
public interface IPluginConfigPersistence
{
    PluginConfiguration Load();

    void Save(PluginConfiguration configuration);
}

/// <summary>Lists the server's libraries for default-section seeding.</summary>
public interface ILibraryCatalog
{
    IReadOnlyList<LibraryInfo> GetLibraries();
}
```

`src/Jellyfin.Plugin.Lumen/Configuration/LumenConfigStore.cs`:
```csharp
using Microsoft.Extensions.Logging;

namespace Jellyfin.Plugin.Lumen.Configuration;

/// <summary>Default <see cref="ILumenConfigStore"/>: migrates on read, validates on save, bumps ConfigVersion.</summary>
public sealed class LumenConfigStore : ILumenConfigStore
{
    private readonly Lock _gate = new();
    private readonly IPluginConfigPersistence _persistence;
    private readonly ILibraryCatalog _libraries;
    private readonly ConfigValidator _validator;
    private readonly ILogger<LumenConfigStore> _logger;

    public LumenConfigStore(
        IPluginConfigPersistence persistence,
        ILibraryCatalog libraries,
        ConfigValidator validator,
        ILogger<LumenConfigStore> logger)
    {
        _persistence = persistence;
        _libraries = libraries;
        _validator = validator;
        _logger = logger;
    }

    public PluginConfiguration Current
    {
        get
        {
            lock (_gate)
            {
                var config = _persistence.Load();
                if (config.SchemaVersion < PluginConfiguration.CurrentSchemaVersion
                    && ConfigMigrator.Migrate(config, _libraries.GetLibraries()))
                {
                    config.ConfigVersion++;
                    _persistence.Save(config);
                    _logger.LogInformation("Lumen configuration migrated to schema {Schema}", config.SchemaVersion);
                }

                return config;
            }
        }
    }

    public ConfigSaveResult Save(PluginConfiguration configuration)
    {
        var errors = _validator.Validate(configuration);
        if (errors.Count > 0)
        {
            return new ConfigSaveResult(false, errors);
        }

        lock (_gate)
        {
            configuration.SchemaVersion = PluginConfiguration.CurrentSchemaVersion;
            configuration.ConfigVersion = Current.ConfigVersion + 1;
            _persistence.Save(configuration);
        }

        return new ConfigSaveResult(true, []);
    }

    public void ResetToDefaults()
    {
        lock (_gate)
        {
            var fresh = new PluginConfiguration();
            ConfigMigrator.Migrate(fresh, _libraries.GetLibraries());
            fresh.ConfigVersion = Current.ConfigVersion + 1;
            _persistence.Save(fresh);
        }
    }
}
```

`src/Jellyfin.Plugin.Lumen/Configuration/LumenPluginPersistence.cs`:
```csharp
namespace Jellyfin.Plugin.Lumen.Configuration;

/// <summary>Persists configuration through Jellyfin's plugin configuration mechanism.</summary>
public sealed class LumenPluginPersistence : IPluginConfigPersistence
{
    private static LumenPlugin Plugin =>
        LumenPlugin.Instance ?? throw new InvalidOperationException("The Lumen plugin has not been initialized.");

    public PluginConfiguration Load() => Plugin.Configuration;

    public void Save(PluginConfiguration configuration) => Plugin.UpdateConfiguration(configuration);
}
```

`src/Jellyfin.Plugin.Lumen/Configuration/LibraryCatalog.cs`:
```csharp
using MediaBrowser.Controller.Library;

namespace Jellyfin.Plugin.Lumen.Configuration;

/// <summary>Reads the server's libraries (virtual folders).</summary>
public sealed class LibraryCatalog : ILibraryCatalog
{
    private readonly ILibraryManager _libraryManager;

    public LibraryCatalog(ILibraryManager libraryManager)
    {
        _libraryManager = libraryManager;
    }

    public IReadOnlyList<LibraryInfo> GetLibraries() =>
        _libraryManager.GetVirtualFolders()
            .Select(f => new LibraryInfo(Guid.TryParse(f.ItemId, out var id) ? id : Guid.Empty, f.Name, f.CollectionType?.ToString()))
            .Where(l => l.Id != Guid.Empty)
            .ToList();
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `source scripts/env.sh && dotnet test --nologo --filter "FullyQualifiedName~LumenConfigStore"`

Expected: `Passed! - Failed: 0, Passed: 4`.

If `System.Threading.Lock` isn't available, the target framework is wrong; it must be net10.0.

- [ ] **Step 5: Commit**

```bash
git add src tests
git commit -m "feat: add migrating, validating configuration store" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: HTML injector and asset catalog

**Files:**
- Create: `src/Jellyfin.Plugin.Lumen/Injection/HtmlInjector.cs`, `src/Jellyfin.Plugin.Lumen/Assets/AssetCatalog.cs`
- Test: `tests/Jellyfin.Plugin.Lumen.Tests/Injection/HtmlInjectorTests.cs`, `tests/Jellyfin.Plugin.Lumen.Tests/Assets/AssetCatalogTests.cs`

**Interfaces:**
- Produces:
  - `static string HtmlInjector.Inject(string html, string buildHash)`
  - `const string HtmlInjector.Marker` = `"<!-- lumen:injected -->"`
  - `sealed class AssetCatalog(IReadOnlyDictionary<string, byte[]> files)` with `string BuildHash`, `bool TryGet(string name, out LumenAsset asset)`, `IReadOnlyCollection<string> Names`, and `static AssetCatalog FromEmbeddedResources(Assembly)` (resource prefix `Lumen.Assets.`)
  - `sealed record LumenAsset(string Name, byte[] Content, string ContentType)`

- [ ] **Step 1: Write the failing tests**

`tests/Jellyfin.Plugin.Lumen.Tests/Injection/HtmlInjectorTests.cs`:
```csharp
using Jellyfin.Plugin.Lumen.Injection;
using Xunit;

namespace Jellyfin.Plugin.Lumen.Tests.Injection;

public class HtmlInjectorTests
{
    private const string Page = "<!DOCTYPE html><html><head><title>Jellyfin</title><script defer src=\"main.js\"></script></head><body></body></html>";

    [Fact]
    public void InsertsTagsBeforeHeadClose_AfterStockScripts()
    {
        var result = HtmlInjector.Inject(Page, "abc123");

        var marker = result.IndexOf(HtmlInjector.Marker, StringComparison.Ordinal);
        Assert.True(marker > result.IndexOf("main.js", StringComparison.Ordinal));
        Assert.True(marker < result.IndexOf("</head>", StringComparison.Ordinal));
        Assert.Contains("<link rel=\"stylesheet\" href=\"../Lumen/Assets/lumen.css?v=abc123\">", result, StringComparison.Ordinal);
        Assert.Contains("<script defer src=\"../Lumen/Assets/lumen.js?v=abc123\"></script>", result, StringComparison.Ordinal);
    }

    [Fact]
    public void UsesRelativeUrls_SoBaseUrlInstallsWork()
    {
        var result = HtmlInjector.Inject(Page, "h");

        Assert.DoesNotContain("href=\"/Lumen", result, StringComparison.Ordinal);
        Assert.DoesNotContain("src=\"/Lumen", result, StringComparison.Ordinal);
    }

    [Fact]
    public void IsIdempotent()
    {
        var once = HtmlInjector.Inject(Page, "h");

        Assert.Equal(once, HtmlInjector.Inject(once, "h"));
    }

    [Fact]
    public void LeavesHtmlWithoutHeadClose_Unchanged()
    {
        const string fragment = "<div>no head</div>";

        Assert.Same(fragment, HtmlInjector.Inject(fragment, "h"));
    }

    [Fact]
    public void MatchesHeadCloseCaseInsensitively_AndKeepsOtherInjectors()
    {
        const string page = "<html><HEAD><!-- other plugin --></HEAD><body></body></html>";

        var result = HtmlInjector.Inject(page, "h");

        Assert.Contains("<!-- other plugin -->" + HtmlInjector.Marker, result, StringComparison.Ordinal);
    }

    [Fact]
    public void EscapesHash()
    {
        var result = HtmlInjector.Inject(Page, "a\"b");

        Assert.Contains("v=a%22b", result, StringComparison.Ordinal);
    }
}
```

`tests/Jellyfin.Plugin.Lumen.Tests/Assets/AssetCatalogTests.cs`:
```csharp
using System.Text;
using Jellyfin.Plugin.Lumen.Assets;
using Xunit;

namespace Jellyfin.Plugin.Lumen.Tests.Assets;

public class AssetCatalogTests
{
    private static AssetCatalog Catalog(string js = "console.log(1)") => new(new Dictionary<string, byte[]>
    {
        ["lumen.js"] = Encoding.UTF8.GetBytes(js),
        ["lumen.css"] = Encoding.UTF8.GetBytes("body{}"),
    });

    [Fact]
    public void ServesKnownFilesWithContentTypes()
    {
        var catalog = Catalog();

        Assert.True(catalog.TryGet("lumen.js", out var js));
        Assert.Equal("text/javascript; charset=utf-8", js.ContentType);
        Assert.True(catalog.TryGet("lumen.css", out var css));
        Assert.Equal("text/css; charset=utf-8", css.ContentType);
        Assert.False(catalog.TryGet("../secret", out _));
    }

    [Fact]
    public void BuildHash_IsStable_AndChangesWithContent()
    {
        Assert.Equal(Catalog().BuildHash, Catalog().BuildHash);
        Assert.NotEqual(Catalog().BuildHash, Catalog("changed").BuildHash);
        Assert.Equal(16, Catalog().BuildHash.Length);
    }

    [Fact]
    public void EmptyCatalog_HasHash()
    {
        Assert.Equal(16, new AssetCatalog(new Dictionary<string, byte[]>()).BuildHash.Length);
    }
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `source scripts/env.sh && dotnet test --nologo --filter "FullyQualifiedName~HtmlInjector|FullyQualifiedName~AssetCatalog"`

Expected: build FAILS with `The type or namespace name 'HtmlInjector' could not be found`.

- [ ] **Step 3: Implement**

`src/Jellyfin.Plugin.Lumen/Injection/HtmlInjector.cs`:
```csharp
namespace Jellyfin.Plugin.Lumen.Injection;

/// <summary>Adds Lumen's stylesheet and script to jellyfin-web's index.html. Pure and idempotent.</summary>
public static class HtmlInjector
{
    public const string Marker = "<!-- lumen:injected -->";

    // Relative to /web/ (or <BaseUrl>/web/), so "../Lumen" resolves to <BaseUrl>/Lumen.
    private const string AssetBase = "../Lumen/Assets/";

    public static string Inject(string html, string buildHash)
    {
        if (html.Contains(Marker, StringComparison.Ordinal))
        {
            return html;
        }

        var headClose = html.IndexOf("</head>", StringComparison.OrdinalIgnoreCase);
        if (headClose < 0)
        {
            return html;
        }

        var version = Uri.EscapeDataString(buildHash);
        var tags = $"{Marker}<link rel=\"stylesheet\" href=\"{AssetBase}lumen.css?v={version}\">"
            + $"<script defer src=\"{AssetBase}lumen.js?v={version}\"></script>";

        return string.Concat(html.AsSpan(0, headClose), tags, html.AsSpan(headClose));
    }
}
```

`src/Jellyfin.Plugin.Lumen/Assets/AssetCatalog.cs`:
```csharp
using System.Reflection;
using System.Security.Cryptography;
using System.Text;

namespace Jellyfin.Plugin.Lumen.Assets;

/// <summary>An embedded client file.</summary>
public sealed record LumenAsset(string Name, byte[] Content, string ContentType);

/// <summary>The client files embedded in the plugin DLL, plus a content hash for cache busting.</summary>
public sealed class AssetCatalog
{
    public const string ResourcePrefix = "Lumen.Assets.";

    private readonly Dictionary<string, LumenAsset> _assets;

    public AssetCatalog(IReadOnlyDictionary<string, byte[]> files)
    {
        _assets = files.ToDictionary(
            f => f.Key,
            f => new LumenAsset(f.Key, f.Value, ContentTypeFor(f.Key)),
            StringComparer.Ordinal);
        BuildHash = ComputeHash(files);
    }

    public string BuildHash { get; }

    public IReadOnlyCollection<string> Names => _assets.Keys;

    public static AssetCatalog FromEmbeddedResources(Assembly assembly)
    {
        var files = new Dictionary<string, byte[]>(StringComparer.Ordinal);
        foreach (var resource in assembly.GetManifestResourceNames().Where(n => n.StartsWith(ResourcePrefix, StringComparison.Ordinal)))
        {
            using var stream = assembly.GetManifestResourceStream(resource)!;
            using var buffer = new MemoryStream();
            stream.CopyTo(buffer);
            files[resource[ResourcePrefix.Length..]] = buffer.ToArray();
        }

        return new AssetCatalog(files);
    }

    public bool TryGet(string name, out LumenAsset asset) => _assets.TryGetValue(name, out asset!);

    private static string ContentTypeFor(string name) => Path.GetExtension(name) switch
    {
        ".js" => "text/javascript; charset=utf-8",
        ".css" => "text/css; charset=utf-8",
        _ => "application/octet-stream",
    };

    private static string ComputeHash(IReadOnlyDictionary<string, byte[]> files)
    {
        using var hash = IncrementalHash.CreateHash(HashAlgorithmName.SHA256);
        foreach (var file in files.OrderBy(f => f.Key, StringComparer.Ordinal))
        {
            hash.AppendData(Encoding.UTF8.GetBytes(file.Key));
            hash.AppendData(file.Value);
        }

        return Convert.ToHexStringLower(hash.GetHashAndReset())[..16];
    }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `source scripts/env.sh && dotnet test --nologo --filter "FullyQualifiedName~HtmlInjector|FullyQualifiedName~AssetCatalog"`

Expected: `Passed! - Failed: 0, Passed: 9`.

- [ ] **Step 5: Commit**

```bash
git add src tests
git commit -m "feat: add idempotent index.html injector and embedded asset catalog" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Index.html middleware and startup filter

**Files:**
- Create: `src/Jellyfin.Plugin.Lumen/Injection/IndexHtmlMiddleware.cs`, `src/Jellyfin.Plugin.Lumen/Injection/LumenStartupFilter.cs`
- Modify: `src/Jellyfin.Plugin.Lumen/ServiceRegistrator.cs`
- Test: `tests/Jellyfin.Plugin.Lumen.Tests/Injection/IndexHtmlMiddlewareTests.cs`

**Interfaces:**
- Consumes: `HtmlInjector.Inject`, `AssetCatalog` (Task 6).
- Produces:
  - `IndexHtmlMiddleware`, resolved per request with `AssetCatalog` injected into `InvokeAsync`
  - `LumenStartupFilter : IStartupFilter`
  - `ServiceRegistrator` now registers `AssetCatalog` (singleton, from embedded resources) and `IStartupFilter`

- [ ] **Step 1: Write the failing integration tests**

`tests/Jellyfin.Plugin.Lumen.Tests/Injection/IndexHtmlMiddlewareTests.cs`:
```csharp
using System.Net;
using System.Net.Http.Headers;
using System.Text;
using Jellyfin.Plugin.Lumen.Assets;
using Jellyfin.Plugin.Lumen.Injection;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.FileProviders;
using Microsoft.Extensions.Hosting;
using Xunit;

namespace Jellyfin.Plugin.Lumen.Tests.Injection;

public sealed class IndexHtmlMiddlewareTests : IDisposable
{
    private const string IndexHtml = "<!DOCTYPE html><html><head><title>Jellyfin</title></head><body><div id=\"reactRoot\"></div></body></html>";
    private readonly string _webRoot = Directory.CreateTempSubdirectory("lumen-web").FullName;

    public IndexHtmlMiddlewareTests()
    {
        File.WriteAllText(Path.Combine(_webRoot, "index.html"), IndexHtml);
        File.WriteAllText(Path.Combine(_webRoot, "main.js"), "console.log('stock')");
    }

    public void Dispose() => Directory.Delete(_webRoot, recursive: true);

    [Theory]
    [InlineData("/web/index.html")]
    [InlineData("/web/")]
    public async Task InjectsIntoIndex(string path)
    {
        using var host = await StartAsync();
        var response = await host.GetTestClient().GetAsync(path);
        var body = await response.Content.ReadAsStringAsync();

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Contains(HtmlInjector.Marker, body, StringComparison.Ordinal);
        Assert.Equal(Encoding.UTF8.GetByteCount(body), response.Content.Headers.ContentLength);
        Assert.StartsWith("\"lmn-", response.Headers.ETag?.Tag, StringComparison.Ordinal);
        Assert.Null(response.Content.Headers.LastModified);
    }

    [Fact]
    public async Task Injects_WhenServerUsesBaseUrl()
    {
        using var host = await StartAsync();
        var body = await host.GetTestClient().GetStringAsync("/jellyfin/web/index.html");

        Assert.Contains("../Lumen/Assets/lumen.js", body, StringComparison.Ordinal);
    }

    [Fact]
    public async Task ReturnsUncompressedInjectedHtml_WhenClientAcceptsGzip()
    {
        using var host = await StartAsync();
        var request = new HttpRequestMessage(HttpMethod.Get, "/web/index.html");
        request.Headers.AcceptEncoding.Add(new StringWithQualityHeaderValue("gzip"));

        var response = await host.GetTestClient().SendAsync(request);

        Assert.Empty(response.Content.Headers.ContentEncoding);
        Assert.Contains(HtmlInjector.Marker, await response.Content.ReadAsStringAsync(), StringComparison.Ordinal);
    }

    [Fact]
    public async Task Returns304_ForMatchingEtag_AndFullPageOtherwise()
    {
        using var host = await StartAsync();
        var client = host.GetTestClient();
        var etag = (await client.GetAsync("/web/index.html")).Headers.ETag!.Tag;

        var conditional = new HttpRequestMessage(HttpMethod.Get, "/web/index.html");
        conditional.Headers.TryAddWithoutValidation("If-None-Match", etag);
        var notModified = await client.SendAsync(conditional);

        var stale = new HttpRequestMessage(HttpMethod.Get, "/web/index.html");
        stale.Headers.TryAddWithoutValidation("If-None-Match", "\"stock-etag\"");
        var full = await client.SendAsync(stale);

        Assert.Equal(HttpStatusCode.NotModified, notModified.StatusCode);
        Assert.Empty(await notModified.Content.ReadAsByteArrayAsync());
        Assert.Equal(HttpStatusCode.OK, full.StatusCode);
        Assert.Contains(HtmlInjector.Marker, await full.Content.ReadAsStringAsync(), StringComparison.Ordinal);
    }

    [Fact]
    public async Task PassesThroughOtherFiles_AndMissingFiles()
    {
        using var host = await StartAsync();
        var client = host.GetTestClient();

        Assert.Equal("console.log('stock')", await client.GetStringAsync("/web/main.js"));
        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync("/web/missing.html")).StatusCode);
    }

    [Fact]
    public async Task CoexistsWithAnotherInjector_InEitherOrder()
    {
        using var outer = await StartAsync(outer: app => app.UseMiddleware<OtherInjector>());
        using var inner = await StartAsync(inner: app => app.UseMiddleware<OtherInjector>());

        foreach (var host in new[] { outer, inner })
        {
            var body = await host.GetTestClient().GetStringAsync("/web/index.html");
            Assert.Contains("<!-- other -->", body, StringComparison.Ordinal);
            Assert.Single(body.Split(HtmlInjector.Marker)[1..]);
        }
    }

    private async Task<IHost> StartAsync(Action<IApplicationBuilder>? outer = null, Action<IApplicationBuilder>? inner = null)
    {
        var host = new HostBuilder()
            .ConfigureWebHost(web => web
                .UseTestServer()
                .ConfigureServices(services =>
                {
                    services.AddSingleton(new AssetCatalog(new Dictionary<string, byte[]> { ["lumen.js"] = "x"u8.ToArray() }));
                    services.AddResponseCompression();
                })
                .Configure(app =>
                {
                    // Mirrors Jellyfin: plugin startup-filter middleware runs before Map(BaseUrl) and compression.
                    outer?.Invoke(app);
                    app.UseMiddleware<IndexHtmlMiddleware>();
                    inner?.Invoke(app);
                    app.UseResponseCompression();
                    app.Map("/jellyfin", ConfigureWeb);
                    ConfigureWeb(app);
                }))
            .Build();
        await host.StartAsync();
        return host;
    }

    private void ConfigureWeb(IApplicationBuilder app)
    {
        var files = new PhysicalFileProvider(_webRoot);
        app.UseDefaultFiles(new DefaultFilesOptions { FileProvider = files, RequestPath = "/web" });
        app.UseStaticFiles(new StaticFileOptions { FileProvider = files, RequestPath = "/web" });
    }

    /// <summary>Simulates another plugin that rewrites index.html.</summary>
    private sealed class OtherInjector
    {
        private readonly RequestDelegate _next;

        public OtherInjector(RequestDelegate next) => _next = next;

        public async Task InvokeAsync(HttpContext context)
        {
            if (!context.Request.Path.Value!.EndsWith("/web/index.html", StringComparison.Ordinal))
            {
                await _next(context);
                return;
            }

            context.Request.Headers.AcceptEncoding = string.Empty;
            var original = context.Response.Body;
            using var buffer = new MemoryStream();
            context.Response.Body = buffer;
            await _next(context);
            context.Response.Body = original;
            var html = Encoding.UTF8.GetString(buffer.ToArray()).Replace("</head>", "<!-- other --></head>", StringComparison.Ordinal);
            var bytes = Encoding.UTF8.GetBytes(html);
            context.Response.ContentLength = bytes.Length;
            await original.WriteAsync(bytes);
        }
    }
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `source scripts/env.sh && dotnet test --nologo --filter "FullyQualifiedName~IndexHtmlMiddleware"`

Expected: build FAILS with `The type or namespace name 'IndexHtmlMiddleware' could not be found`.

- [ ] **Step 3: Implement the middleware, filter, and registration**

`src/Jellyfin.Plugin.Lumen/Injection/IndexHtmlMiddleware.cs`:
```csharp
using System.Security.Cryptography;
using System.Text;
using Jellyfin.Plugin.Lumen.Assets;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Logging;
using Microsoft.Net.Http.Headers;

namespace Jellyfin.Plugin.Lumen.Injection;

/// <summary>
/// Rewrites jellyfin-web's index.html to load Lumen. Runs before Jellyfin's BaseUrl mapping and response
/// compression, so it strips the request headers that would make the inner pipeline return a compressed,
/// partial, or 304 response, and then replaces the validators with a hash of the rewritten page.
/// </summary>
public sealed class IndexHtmlMiddleware
{
    private readonly RequestDelegate _next;
    private readonly ILogger<IndexHtmlMiddleware> _logger;
    private int _warnedNoHead;

    public IndexHtmlMiddleware(RequestDelegate next, ILogger<IndexHtmlMiddleware> logger)
    {
        _next = next;
        _logger = logger;
    }

    public async Task InvokeAsync(HttpContext context, AssetCatalog assets)
    {
        if (!IsIndexRequest(context.Request))
        {
            await _next(context);
            return;
        }

        var clientEtag = context.Request.Headers.IfNoneMatch.ToString();
        context.Request.Headers.Remove(HeaderNames.AcceptEncoding);
        context.Request.Headers.Remove(HeaderNames.IfNoneMatch);
        context.Request.Headers.Remove(HeaderNames.IfModifiedSince);
        context.Request.Headers.Remove(HeaderNames.Range);

        var originalBody = context.Response.Body;
        using var buffer = new MemoryStream();
        context.Response.Body = buffer;
        try
        {
            await _next(context);
        }
        finally
        {
            context.Response.Body = originalBody;
        }

        if (context.Response.StatusCode != StatusCodes.Status200OK
            || context.Response.ContentType?.StartsWith("text/html", StringComparison.OrdinalIgnoreCase) != true)
        {
            buffer.Position = 0;
            await buffer.CopyToAsync(originalBody, context.RequestAborted);
            return;
        }

        var output = Transform(buffer.ToArray(), assets.BuildHash);
        var etag = "\"lmn-" + Convert.ToHexStringLower(SHA256.HashData(output))[..16] + "\"";

        context.Response.Headers.Remove(HeaderNames.LastModified);
        context.Response.Headers.ETag = etag;

        if (string.Equals(clientEtag, etag, StringComparison.Ordinal))
        {
            context.Response.StatusCode = StatusCodes.Status304NotModified;
            context.Response.ContentLength = null;
            return;
        }

        context.Response.ContentLength = output.Length;
        await originalBody.WriteAsync(output, context.RequestAborted);
    }

    internal static bool IsIndexRequest(HttpRequest request)
    {
        if (!HttpMethods.IsGet(request.Method))
        {
            return false;
        }

        var path = request.Path.Value ?? string.Empty;
        return path.EndsWith("/web/", StringComparison.OrdinalIgnoreCase)
            || path.EndsWith("/web/index.html", StringComparison.OrdinalIgnoreCase);
    }

    private byte[] Transform(byte[] original, string buildHash)
    {
        try
        {
            var html = Encoding.UTF8.GetString(original);
            var injected = HtmlInjector.Inject(html, buildHash);
            if (ReferenceEquals(injected, html) && !html.Contains(HtmlInjector.Marker, StringComparison.Ordinal)
                && Interlocked.Exchange(ref _warnedNoHead, 1) == 0)
            {
                _logger.LogWarning("Lumen could not find </head> in index.html; the stock UI will be served");
            }

            return Encoding.UTF8.GetBytes(injected);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Lumen failed to rewrite index.html; serving the original");
            return original;
        }
    }
}
```

`src/Jellyfin.Plugin.Lumen/Injection/LumenStartupFilter.cs`:
```csharp
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;

namespace Jellyfin.Plugin.Lumen.Injection;

/// <summary>Adds <see cref="IndexHtmlMiddleware"/> ahead of Jellyfin's pipeline.</summary>
public sealed class LumenStartupFilter : IStartupFilter
{
    public Action<IApplicationBuilder> Configure(Action<IApplicationBuilder> next) => app =>
    {
        app.UseMiddleware<IndexHtmlMiddleware>();
        next(app);
    };
}
```

`src/Jellyfin.Plugin.Lumen/ServiceRegistrator.cs` (replace the body):
```csharp
using Jellyfin.Plugin.Lumen.Assets;
using Jellyfin.Plugin.Lumen.Injection;
using MediaBrowser.Controller;
using MediaBrowser.Controller.Plugins;
using Microsoft.AspNetCore.Hosting;
using Microsoft.Extensions.DependencyInjection;

namespace Jellyfin.Plugin.Lumen;

/// <summary>Registers Lumen services with Jellyfin's web host container.</summary>
public sealed class ServiceRegistrator : IPluginServiceRegistrator
{
    public void RegisterServices(IServiceCollection serviceCollection, IServerApplicationHost applicationHost)
    {
        serviceCollection.AddSingleton(AssetCatalog.FromEmbeddedResources(typeof(LumenPlugin).Assembly));
        serviceCollection.AddTransient<IStartupFilter, LumenStartupFilter>();
    }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `source scripts/env.sh && dotnet test --nologo --filter "FullyQualifiedName~IndexHtmlMiddleware"`

Expected: `Passed! - Failed: 0, Passed: 7`.

- [ ] **Step 5: Verify against the real server**

Run:
```bash
./scripts/dev.sh && curl -s http://localhost:8096/web/ | grep -o 'lumen:injected.*lumen.js?v=[0-9a-f]*'
```
Expected: one match such as `lumen:injected --><link ... lumen.js?v=e3b0c44298fc1c14`. The hash is the empty-catalog hash until Task 8 embeds the client. The page at http://localhost:8096 still loads normally; finish the startup wizard in the browser if asked.

- [ ] **Step 6: Commit**

```bash
git add src tests
git commit -m "feat: inject Lumen into jellyfin-web index.html via startup filter middleware" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Client scaffold, build pipeline, and embedding

**Files:**
- Create:
  - `client/package.json` (via npm), `client/tsconfig.json`, `client/vite.config.ts`, `client/eslint.config.js`, `client/.prettierrc.json`, `client/.prettierignore`
  - `client/scripts/check-size.mjs`, `client/test/setup.ts`
  - `client/src/main.tsx`, `client/src/strings.ts`, `client/src/styles/lumen.css`
  - `client/src/util/once.ts`, `client/src/util/once.test.ts`
  - `tests/Jellyfin.Plugin.Lumen.Tests/Assets/EmbeddedAssetsTests.cs`
- Modify: `src/Jellyfin.Plugin.Lumen/Jellyfin.Plugin.Lumen.csproj`

**Interfaces:**
- Produces:
  - `npm run build` writes `client/dist/lumen.js` and `client/dist/lumen.css`.
  - Plugin build embeds every `client/dist/*.js|*.css` as `Lumen.Assets.<file>`.
  - `once<T>(fn: () => T): () => T` utility.
  - `strings` object (English UI strings).

- [ ] **Step 1: Initialize the client package and install dependencies**

Run:
```bash
cd client
npm init -y >/dev/null
npm pkg set name=lumen-client private=true type=module
npm pkg set scripts.build="vite build" scripts.test="vitest run" scripts.typecheck="tsc --noEmit" \
  scripts.lint="eslint . && prettier --check ." scripts.format="prettier --write ." scripts.size="node scripts/check-size.mjs"
npm pkg delete main scripts.test:old 2>/dev/null || true
npm install preact
npm install -D vite @preact/preset-vite typescript vitest jsdom @testing-library/preact @testing-library/jest-dom \
  eslint @eslint/js typescript-eslint globals prettier
cd ..
```
Expected: `client/package.json` and `client/package-lock.json` exist, and `npm ls preact` shows a 10.x version.

- [ ] **Step 2: Add the config files**

`client/tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "jsx": "react-jsx",
    "jsxImportSource": "preact",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "noEmit": true,
    "skipLibCheck": true,
    "types": ["vitest/globals"]
  },
  "include": ["src", "test", "vite.config.ts", "vite.admin.config.ts"]
}
```

`client/vite.config.ts`:
```ts
import preact from '@preact/preset-vite';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [preact()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2020',
    cssCodeSplit: false,
    lib: {
      entry: 'src/main.tsx',
      formats: ['iife'],
      name: 'Lumen',
      fileName: () => 'lumen.js',
      cssFileName: 'lumen',
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
```

`client/eslint.config.js`:
```js
import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist', 'node_modules'] },
  js.configs.recommended,
  ...tseslint.configs.strict,
  { languageOptions: { globals: { ...globals.browser, ...globals.node } } },
);
```

`client/.prettierrc.json`:
```json
{ "singleQuote": true, "printWidth": 110 }
```

`client/.prettierignore`:
```
dist
node_modules
package-lock.json
```

`client/test/setup.ts`:
```ts
import '@testing-library/jest-dom/vitest';
```

`client/scripts/check-size.mjs`:
```js
// Fails when lumen.js + lumen.css exceed the gzipped budget from the spec.
import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';

const BUDGET = 60 * 1024;
const files = ['dist/lumen.js', 'dist/lumen.css'];
const total = files.reduce((sum, f) => sum + gzipSync(readFileSync(f)).length, 0);
console.log(`lumen bundle: ${(total / 1024).toFixed(1)} KB gzipped (budget ${BUDGET / 1024} KB)`);
if (total > BUDGET) {
  process.exit(1);
}
```

- [ ] **Step 3: Write a failing test for the first utility**

`client/src/util/once.test.ts`:
```ts
import { describe, expect, it, vi } from 'vitest';
import { once } from './once';

describe('once', () => {
  it('calls the function only the first time and caches the result', () => {
    const fn = vi.fn(() => 42);
    const cached = once(fn);
    expect(cached()).toBe(42);
    expect(cached()).toBe(42);
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
```

Run: `cd client && npx vitest run src/util/once.test.ts; cd ..`

Expected: FAIL with `Failed to resolve import "./once"`.

- [ ] **Step 4: Implement the utility, strings, entry, and base CSS**

`client/src/util/once.ts`:
```ts
/** Wraps a function so it runs at most once; later calls return the first result. */
export function once<T>(fn: () => T): () => T {
  let done = false;
  let value: T;
  return () => {
    if (!done) {
      value = fn();
      done = true;
    }
    return value;
  };
}
```

`client/src/strings.ts`:
```ts
/** All user-visible strings. English-only for v1; centralized for later localization. */
export const strings = {
  play: 'Play',
  resume: 'Resume',
  moreInfo: 'More Info',
  trailer: 'Trailer',
  watched: 'Watched',
  markWatched: 'Mark as watched',
  favorite: 'Favorite',
  addFavorite: 'Add to favorites',
  moreLikeThis: 'More Like This',
  cast: 'Cast',
  episodes: 'Episodes',
  season: 'Season',
  specials: 'Specials',
  playbackFailed: "Couldn't start playback. Try again from the stock player.",
  loading: 'Loading…',
} as const;
```

`client/src/main.tsx`:
```tsx
import './styles/lumen.css';

console.info('[Lumen] client loaded');
```

`client/src/styles/lumen.css`:
```css
:root {
  --lmn-accent: #f5a524;
}
```

- [ ] **Step 5: Run the client checks**

Run:
```bash
cd client && npx vitest run && npm run typecheck && npm run build && npm run size && npx eslint . && npx prettier --write . && cd ..
```
Expected:
- Vitest reports `1 passed`.
- `typecheck` prints nothing.
- `dist/lumen.js` and `dist/lumen.css` are created.
- `lumen bundle: 0.x KB gzipped (budget 60 KB)`.
- ESLint reports no errors.

- [ ] **Step 6: Write the failing embed test**

`tests/Jellyfin.Plugin.Lumen.Tests/Assets/EmbeddedAssetsTests.cs`:
```csharp
using Jellyfin.Plugin.Lumen.Assets;
using Xunit;

namespace Jellyfin.Plugin.Lumen.Tests.Assets;

public class EmbeddedAssetsTests
{
    [Fact]
    public void PluginAssembly_EmbedsClientBundle()
    {
        var catalog = AssetCatalog.FromEmbeddedResources(typeof(LumenPlugin).Assembly);

        Assert.Contains("lumen.js", catalog.Names);
        Assert.Contains("lumen.css", catalog.Names);
    }
}
```

Run: `source scripts/env.sh && dotnet test --nologo --filter "FullyQualifiedName~EmbeddedAssets"`

Expected: FAIL, because `catalog.Names` is empty.

- [ ] **Step 7: Add the build and embed targets to the plugin csproj**

Append inside `<Project>` in `src/Jellyfin.Plugin.Lumen/Jellyfin.Plugin.Lumen.csproj`:
```xml
  <PropertyGroup>
    <ClientDir>$([MSBuild]::NormalizeDirectory('$(MSBuildThisFileDirectory)', '..', '..', 'client'))</ClientDir>
  </PropertyGroup>
  <ItemGroup>
    <ClientSource Include="$(ClientDir)src/**/*;$(ClientDir)package.json;$(ClientDir)vite.config.ts;$(ClientDir)vite.admin.config.ts" />
  </ItemGroup>
  <!-- Builds the client unless SkipClientBuild=true (CI builds it in a separate step). Incremental via Inputs/Outputs. -->
  <Target Name="BuildClient" BeforeTargets="BeforeBuild" Condition="'$(SkipClientBuild)' != 'true'"
          Inputs="@(ClientSource)" Outputs="$(ClientDir)dist/lumen.js">
    <Exec Command="npm ci --no-audit --no-fund" WorkingDirectory="$(ClientDir)" Condition="!Exists('$(ClientDir)node_modules')" />
    <Exec Command="npm run build" WorkingDirectory="$(ClientDir)" />
  </Target>
  <!-- Items are added inside a target so files produced by BuildClient are picked up on the first build. -->
  <Target Name="EmbedClient" BeforeTargets="BeforeBuild" DependsOnTargets="BuildClient">
    <ItemGroup>
      <EmbeddedResource Include="$(ClientDir)dist/*.js;$(ClientDir)dist/*.css" LogicalName="Lumen.Assets.%(Filename)%(Extension)" />
    </ItemGroup>
  </Target>
```

- [ ] **Step 8: Run all tests**

Run: `source scripts/env.sh && dotnet test --nologo`

Expected: every test passes, including `PluginAssembly_EmbedsClientBundle`.

Then run:
```bash
./scripts/dev.sh && curl -s "http://localhost:8096/web/" | grep -o 'lumen.js?v=[0-9a-f]*'
```
Expected: the hash differs from Task 7's empty-catalog hash.

- [ ] **Step 9: Commit**

```bash
git add client src tests
git commit -m "feat: add Preact client scaffold and embed its bundle in the plugin" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: LumenController (assets, client config, diagnostics)

**Files:**
- Create:
  - `src/Jellyfin.Plugin.Lumen/Api/Dtos.cs`
  - `src/Jellyfin.Plugin.Lumen/Api/LumenController.cs`
  - `src/Jellyfin.Plugin.Lumen/Api/ClaimsPrincipalExtensions.cs`
  - `src/Jellyfin.Plugin.Lumen/Diagnostics/DiagnosticsStore.cs`
- Modify: `src/Jellyfin.Plugin.Lumen/ServiceRegistrator.cs`
- Test:
  - `tests/Jellyfin.Plugin.Lumen.Tests/Api/LumenControllerTests.cs`
  - `tests/Jellyfin.Plugin.Lumen.Tests/Diagnostics/DiagnosticsStoreTests.cs`
  - `tests/Jellyfin.Plugin.Lumen.Tests/Api/ClaimsPrincipalExtensionsTests.cs`

**Interfaces:**
- Consumes: `AssetCatalog` (Task 6), `ILumenConfigStore` (Task 5).
- Produces:
  - `GET /Lumen/Assets/{name}` (anonymous)
  - `GET /Lumen/ClientConfig` returns `ClientConfigDto`
  - `POST /Lumen/Diagnostics` with a `CompatReportDto` body
  - `sealed class ClientConfigDto` with the properties in spec §3.4 (`static From(PluginConfiguration, string buildHash)`)
  - `sealed class CompatReportDto { string Client; string ServerVersion; List<string> FailedChecks }`
  - `sealed record DiagnosticEntry(string Client, string ServerVersion, IReadOnlyList<string> FailedChecks, DateTimeOffset LastSeen)`
  - `DiagnosticsStore.Record(CompatReportDto, DateTimeOffset)` and `IReadOnlyList<DiagnosticEntry> GetAll()` (newest first, at most 50)
  - `static Guid? ClaimsPrincipalExtensions.GetJellyfinUserId(this ClaimsPrincipal)`

- [ ] **Step 1: Write the failing tests**

`tests/Jellyfin.Plugin.Lumen.Tests/Diagnostics/DiagnosticsStoreTests.cs`:
```csharp
using Jellyfin.Plugin.Lumen.Api;
using Jellyfin.Plugin.Lumen.Diagnostics;
using Xunit;

namespace Jellyfin.Plugin.Lumen.Tests.Diagnostics;

public class DiagnosticsStoreTests
{
    private static CompatReportDto Report(string client, params string[] failed) =>
        new() { Client = client, ServerVersion = "12.1.0", FailedChecks = failed.ToList() };

    [Fact]
    public void ReturnsNewestFirst_AndDeduplicatesIdenticalReports()
    {
        var store = new DiagnosticsStore();
        store.Record(Report("web", "skinBody"), TestData.Now);
        store.Record(Report("ios", "apiClient"), TestData.Now.AddMinutes(1));
        store.Record(Report("web", "skinBody"), TestData.Now.AddMinutes(2));

        var all = store.GetAll();

        Assert.Equal(2, all.Count);
        Assert.Equal("web", all[0].Client);
        Assert.Equal(TestData.Now.AddMinutes(2), all[0].LastSeen);
    }

    [Fact]
    public void IsBounded_AndTruncatesInput()
    {
        var store = new DiagnosticsStore();
        for (var i = 0; i < 60; i++)
        {
            store.Record(Report($"client-{i}"), TestData.Now.AddSeconds(i));
        }

        store.Record(Report(new string('x', 500), Enumerable.Range(0, 40).Select(i => $"check{i}").ToArray()), TestData.Now.AddHours(1));

        var all = store.GetAll();
        Assert.Equal(DiagnosticsStore.Capacity, all.Count);
        Assert.Equal(100, all[0].Client.Length);
        Assert.Equal(20, all[0].FailedChecks.Count);
    }
}
```

`tests/Jellyfin.Plugin.Lumen.Tests/Api/ClaimsPrincipalExtensionsTests.cs`:
```csharp
using System.Security.Claims;
using Jellyfin.Plugin.Lumen.Api;
using Xunit;

namespace Jellyfin.Plugin.Lumen.Tests.Api;

public class ClaimsPrincipalExtensionsTests
{
    [Fact]
    public void ReadsJellyfinUserIdClaim()
    {
        var id = Guid.NewGuid();
        var principal = new ClaimsPrincipal(new ClaimsIdentity([new Claim("Jellyfin-UserId", id.ToString("N"))]));

        Assert.Equal(id, principal.GetJellyfinUserId());
        Assert.Null(new ClaimsPrincipal(new ClaimsIdentity()).GetJellyfinUserId());
    }
}
```

`tests/Jellyfin.Plugin.Lumen.Tests/Api/LumenControllerTests.cs`:
```csharp
using System.Text;
using Jellyfin.Plugin.Lumen.Api;
using Jellyfin.Plugin.Lumen.Assets;
using Jellyfin.Plugin.Lumen.Configuration;
using Jellyfin.Plugin.Lumen.Diagnostics;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Time.Testing;
using NSubstitute;
using Xunit;

namespace Jellyfin.Plugin.Lumen.Tests.Api;

public class LumenControllerTests
{
    private readonly AssetCatalog _assets = new(new Dictionary<string, byte[]> { ["lumen.js"] = Encoding.UTF8.GetBytes("x") });
    private readonly ILumenConfigStore _config = Substitute.For<ILumenConfigStore>();
    private readonly DiagnosticsStore _diagnostics = new();

    private LumenController Create() => new(_assets, _config, _diagnostics, new FakeTimeProvider(TestData.Now))
    {
        ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext() },
    };

    [Fact]
    public void Asset_IsImmutable_WhenVersionMatches()
    {
        var controller = Create();

        var result = Assert.IsType<FileContentResult>(controller.GetAsset("lumen.js", _assets.BuildHash));

        Assert.Equal("text/javascript; charset=utf-8", result.ContentType);
        Assert.Equal("public, max-age=31536000, immutable", controller.Response.Headers.CacheControl.ToString());
    }

    [Fact]
    public void Asset_IsRevalidated_WhenVersionMissingOrStale()
    {
        var controller = Create();

        controller.GetAsset("lumen.js", "old");

        Assert.Equal("no-cache", controller.Response.Headers.CacheControl.ToString());
    }

    [Fact]
    public void UnknownAsset_Is404()
    {
        Assert.IsType<NotFoundResult>(Create().GetAsset("../../etc/passwd", null));
    }

    [Fact]
    public void ClientConfig_ReflectsSettings()
    {
        _config.Current.Returns(new PluginConfiguration { HomeTakeover = false, AccentColor = "#123456", HeroIntervalSeconds = 9 });

        var dto = Create().GetClientConfig().Value!;

        Assert.True(dto.Enabled);
        Assert.False(dto.HomeTakeover);
        Assert.Equal("#123456", dto.AccentColor);
        Assert.Equal(9, dto.HeroIntervalSeconds);
        Assert.Equal(_assets.BuildHash, dto.BuildHash);
    }

    [Fact]
    public void Diagnostics_AreRecorded()
    {
        var result = Create().PostDiagnostics(new CompatReportDto { Client = "web", ServerVersion = "12.1.0", FailedChecks = ["skinBody"] });

        Assert.IsType<NoContentResult>(result);
        Assert.Equal(TestData.Now, Assert.Single(_diagnostics.GetAll()).LastSeen);
    }
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `source scripts/env.sh && dotnet test --nologo --filter "FullyQualifiedName~Api|FullyQualifiedName~Diagnostics"`

Expected: build FAILS with `The type or namespace name 'LumenController' could not be found`.

- [ ] **Step 3: Implement**

`src/Jellyfin.Plugin.Lumen/Api/Dtos.cs`:
```csharp
using System.Diagnostics.CodeAnalysis;
using Jellyfin.Plugin.Lumen.Configuration;
using MediaBrowser.Model.Dto;

namespace Jellyfin.Plugin.Lumen.Api;

/// <summary>Settings the client needs before rendering anything.</summary>
public sealed class ClientConfigDto
{
    public bool Enabled { get; init; }

    public bool HomeTakeover { get; init; }

    public bool DetailsTakeover { get; init; }

    public string AccentColor { get; init; } = string.Empty;

    public int HeroIntervalSeconds { get; init; }

    public bool TrailerPreview { get; init; }

    public int TrailerDelaySeconds { get; init; }

    public string BuildHash { get; init; } = string.Empty;

    public static ClientConfigDto From(PluginConfiguration config, string buildHash) => new()
    {
        Enabled = config.Enabled,
        HomeTakeover = config.HomeTakeover,
        DetailsTakeover = config.DetailsTakeover,
        AccentColor = config.AccentColor,
        HeroIntervalSeconds = config.HeroIntervalSeconds,
        TrailerPreview = config.TrailerPreview,
        TrailerDelaySeconds = config.TrailerDelaySeconds,
        BuildHash = buildHash,
    };
}

/// <summary>A client's compatibility self-test result.</summary>
public sealed class CompatReportDto
{
    public string Client { get; set; } = string.Empty;

    public string ServerVersion { get; set; } = string.Empty;

    [SuppressMessage("Usage", "CA2227:Collection properties should be read only", Justification = "JSON model binding.")]
    [SuppressMessage("Design", "CA1002:Do not expose generic lists", Justification = "JSON model binding.")]
    public List<string> FailedChecks { get; set; } = [];
}

/// <summary>One hero slide.</summary>
public sealed record HeroItemDto(BaseItemDto Item, Guid? TrailerItemId);

/// <summary>One home row.</summary>
public sealed record HomeRowDto(string Id, string Type, string Title, IReadOnlyList<BaseItemDto> Items);

/// <summary>Response of GET /Lumen/Home.</summary>
public sealed record HomeResponseDto(int ConfigVersion, IReadOnlyList<HeroItemDto> Hero, IReadOnlyList<HomeRowDto> Rows);
```

`src/Jellyfin.Plugin.Lumen/Api/ClaimsPrincipalExtensions.cs`:
```csharp
using System.Security.Claims;

namespace Jellyfin.Plugin.Lumen.Api;

/// <summary>Reads Jellyfin's user id claim (Jellyfin.Api's helper is not available to plugins).</summary>
public static class ClaimsPrincipalExtensions
{
    private const string UserIdClaim = "Jellyfin-UserId";

    public static Guid? GetJellyfinUserId(this ClaimsPrincipal principal)
    {
        var value = principal.Claims.FirstOrDefault(c => string.Equals(c.Type, UserIdClaim, StringComparison.OrdinalIgnoreCase))?.Value;
        return Guid.TryParse(value, out var id) && id != Guid.Empty ? id : null;
    }
}
```

`src/Jellyfin.Plugin.Lumen/Diagnostics/DiagnosticsStore.cs`:
```csharp
using Jellyfin.Plugin.Lumen.Api;

namespace Jellyfin.Plugin.Lumen.Diagnostics;

/// <summary>A deduplicated compatibility report.</summary>
public sealed record DiagnosticEntry(string Client, string ServerVersion, IReadOnlyList<string> FailedChecks, DateTimeOffset LastSeen);

/// <summary>In-memory, bounded store of client compatibility reports for the admin page.</summary>
public sealed class DiagnosticsStore
{
    public const int Capacity = 50;
    private const int MaxText = 100;
    private const int MaxChecks = 20;

    private readonly Lock _gate = new();
    private readonly LinkedList<DiagnosticEntry> _entries = new();

    public void Record(CompatReportDto report, DateTimeOffset at)
    {
        var entry = new DiagnosticEntry(
            Truncate(report.Client),
            Truncate(report.ServerVersion),
            report.FailedChecks.Take(MaxChecks).Select(Truncate).ToList(),
            at);

        lock (_gate)
        {
            var existing = _entries.FirstOrDefault(e =>
                e.Client == entry.Client && e.ServerVersion == entry.ServerVersion && e.FailedChecks.SequenceEqual(entry.FailedChecks));
            if (existing is not null)
            {
                _entries.Remove(existing);
            }

            _entries.AddFirst(entry);
            while (_entries.Count > Capacity)
            {
                _entries.RemoveLast();
            }
        }
    }

    public IReadOnlyList<DiagnosticEntry> GetAll()
    {
        lock (_gate)
        {
            return _entries.ToList();
        }
    }

    private static string Truncate(string? value) => value is null ? string.Empty : value.Length <= MaxText ? value : value[..MaxText];
}
```

`src/Jellyfin.Plugin.Lumen/Api/LumenController.cs`:
```csharp
using Jellyfin.Plugin.Lumen.Assets;
using Jellyfin.Plugin.Lumen.Configuration;
using Jellyfin.Plugin.Lumen.Diagnostics;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Jellyfin.Plugin.Lumen.Api;

/// <summary>Client-facing endpoints: embedded assets, client config, and compatibility reports.</summary>
[ApiController]
[Route("Lumen")]
public sealed class LumenController : ControllerBase
{
    private readonly AssetCatalog _assets;
    private readonly ILumenConfigStore _config;
    private readonly DiagnosticsStore _diagnostics;
    private readonly TimeProvider _time;

    public LumenController(AssetCatalog assets, ILumenConfigStore config, DiagnosticsStore diagnostics, TimeProvider time)
    {
        _assets = assets;
        _config = config;
        _diagnostics = diagnostics;
        _time = time;
    }

    [HttpGet("Assets/{name}")]
    [AllowAnonymous]
    public IActionResult GetAsset([FromRoute] string name, [FromQuery] string? v)
    {
        if (!_assets.TryGet(name, out var asset))
        {
            return NotFound();
        }

        Response.Headers.CacheControl = string.Equals(v, _assets.BuildHash, StringComparison.Ordinal)
            ? "public, max-age=31536000, immutable"
            : "no-cache";
        return File(asset.Content, asset.ContentType);
    }

    [HttpGet("ClientConfig")]
    [Authorize]
    public ActionResult<ClientConfigDto> GetClientConfig() => ClientConfigDto.From(_config.Current, _assets.BuildHash);

    [HttpPost("Diagnostics")]
    [Authorize]
    public IActionResult PostDiagnostics([FromBody] CompatReportDto report)
    {
        _diagnostics.Record(report, _time.GetUtcNow());
        return NoContent();
    }
}
```

Add these registrations to `ServiceRegistrator.RegisterServices` (after the existing two lines), with `using Jellyfin.Plugin.Lumen.Configuration;`, `using Jellyfin.Plugin.Lumen.Diagnostics;`, and `using Microsoft.Extensions.DependencyInjection.Extensions;`:
```csharp
        serviceCollection.TryAddSingleton(TimeProvider.System);
        serviceCollection.AddSingleton<IPluginConfigPersistence, LumenPluginPersistence>();
        serviceCollection.AddSingleton<ILibraryCatalog, LibraryCatalog>();
        serviceCollection.AddSingleton<ConfigValidator>();
        serviceCollection.AddSingleton<ILumenConfigStore, LumenConfigStore>();
        serviceCollection.AddSingleton<DiagnosticsStore>();
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `source scripts/env.sh && dotnet test --nologo`

Expected: every test passes, including the 8 new ones.

- [ ] **Step 5: Verify the asset endpoint on the dev server**

Run:
```bash
./scripts/dev.sh && curl -sI "http://localhost:8096/Lumen/Assets/lumen.js" | grep -iE "^(HTTP|content-type|cache-control)"
```
Expected: `HTTP/1.1 200 OK`, `Content-Type: text/javascript; charset=utf-8`, and `Cache-Control: no-cache`.

Then open http://localhost:8096 in a browser. The console shows `[Lumen] client loaded`.

- [ ] **Step 6: Commit**

```bash
git add src tests
git commit -m "feat: add asset, client-config, and diagnostics endpoints" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Phase B: Home data (server)

### Task 10: Watch history and genre weighting

**Files:**
- Create: `src/Jellyfin.Plugin.Lumen/Home/WatchHistoryService.cs`, `src/Jellyfin.Plugin.Lumen/Home/GenreWeighting.cs`
- Test: `tests/Jellyfin.Plugin.Lumen.Tests/Home/WatchHistoryServiceTests.cs`, `tests/Jellyfin.Plugin.Lumen.Tests/Home/GenreWeightingTests.cs`

**Interfaces:**
- Consumes: `WatchHistory`, `WatchedEntry`, `QueryOptions` (Task 4).
- Produces:
  - `interface IWatchHistoryService { Task<WatchHistory> GetAsync(User user, DateTimeOffset now, CancellationToken cancellationToken); }` and `WatchHistoryService : IWatchHistoryService` (90-day window, up to 200 recent items)
  - `GenreWeighting` (pure static methods):
    - `IReadOnlyDictionary<string,double> Compute(IEnumerable<WatchedEntry> history, IEnumerable<string> availableGenres)`
    - `IReadOnlyList<string> Pick(IReadOnlyDictionary<string,double> weights, int count, int seed)`
    - `IReadOnlyList<string> TopGenres(IReadOnlyDictionary<string,double> weights, int count)`
    - `int DailySeed(Guid userId, DateTimeOffset now)`
    - `IReadOnlyList<T> SeededShuffle<T>(IReadOnlyList<T> items, int seed)`

- [ ] **Step 1: Write the failing tests**

`tests/Jellyfin.Plugin.Lumen.Tests/Home/GenreWeightingTests.cs`:
```csharp
using Jellyfin.Plugin.Lumen.Home;
using Xunit;

namespace Jellyfin.Plugin.Lumen.Tests.Home;

public class GenreWeightingTests
{
    private static WatchedEntry Played(params string[] genres) =>
        new(TestData.Movie("m", genres), null, null, genres, TestData.Now.UtcDateTime);

    [Fact]
    public void Compute_SmoothsAvailableGenres_AndCountsPlaysCaseInsensitively()
    {
        var weights = GenreWeighting.Compute([Played("Drama"), Played("drama"), Played("Western")], ["Drama", "Comedy"]);

        Assert.Equal(3, weights["Drama"]);
        Assert.Equal(1, weights["Comedy"]);
        Assert.False(weights.ContainsKey("Western"));
    }

    [Fact]
    public void Pick_IsDeterministic_DistinctAndBounded()
    {
        var weights = GenreWeighting.Compute([], ["A", "B", "C", "D"]);

        var first = GenreWeighting.Pick(weights, 3, seed: 42);

        Assert.Equal(first, GenreWeighting.Pick(weights, 3, seed: 42));
        Assert.Equal(3, first.Distinct().Count());
        Assert.Equal(4, GenreWeighting.Pick(weights, 10, seed: 1).Count);
    }

    [Fact]
    public void Pick_FavorsHeavilyWatchedGenres()
    {
        var history = Enumerable.Range(0, 20).Select(_ => Played("Sci-Fi")).ToList();
        var weights = GenreWeighting.Compute(history, ["Sci-Fi", "A", "B", "C", "D", "E"]);

        var hits = Enumerable.Range(0, 30).Count(seed => GenreWeighting.Pick(weights, 1, seed)[0] == "Sci-Fi");

        Assert.True(hits >= 15, $"Sci-Fi picked {hits}/30 times");
    }

    [Fact]
    public void DailySeed_StableWithinDay_DiffersAcrossDaysAndUsers()
    {
        var user = Guid.NewGuid();

        Assert.Equal(GenreWeighting.DailySeed(user, TestData.Now), GenreWeighting.DailySeed(user, TestData.Now.AddHours(5)));
        Assert.NotEqual(GenreWeighting.DailySeed(user, TestData.Now), GenreWeighting.DailySeed(user, TestData.Now.AddDays(1)));
        Assert.NotEqual(GenreWeighting.DailySeed(user, TestData.Now), GenreWeighting.DailySeed(Guid.NewGuid(), TestData.Now));
    }

    [Fact]
    public void SeededShuffle_IsAStablePermutation()
    {
        int[] items = [1, 2, 3, 4, 5, 6, 7, 8];

        var shuffled = GenreWeighting.SeededShuffle(items, 7);

        Assert.Equal(shuffled, GenreWeighting.SeededShuffle(items, 7));
        Assert.Equal(items.Order(), shuffled.Order());
    }

    [Fact]
    public void TopGenres_OrdersByWeightThenName()
    {
        var weights = new Dictionary<string, double> { ["B"] = 2, ["A"] = 2, ["C"] = 5, ["D"] = 1 };

        Assert.Equal(["C", "A", "B"], GenreWeighting.TopGenres(weights, 3));
    }
}
```

`tests/Jellyfin.Plugin.Lumen.Tests/Home/WatchHistoryServiceTests.cs`:
```csharp
using Jellyfin.Data.Enums;
using Jellyfin.Database.Implementations.Entities;
using Jellyfin.Database.Implementations.Enums;
using Jellyfin.Plugin.Lumen.Home;
using MediaBrowser.Controller.Entities;
using MediaBrowser.Controller.Library;
using NSubstitute;
using Xunit;

namespace Jellyfin.Plugin.Lumen.Tests.Home;

public class WatchHistoryServiceTests
{
    private readonly ILibraryManager _library = Substitute.For<ILibraryManager>();
    private readonly IUserDataManager _userData = Substitute.For<IUserDataManager>();
    private readonly User _user = TestData.User();

    [Fact]
    public async Task ReturnsRecentPlays_WithSeriesGenresForEpisodes()
    {
        var show = TestData.Series("Show", "Sci-Fi");
        var episode = TestData.Episode(show, 1, 1);
        var recentMovie = TestData.Movie("Recent", "Drama");
        var oldMovie = TestData.Movie("Old", "Western");
        var neverPlayed = TestData.Movie("Never", "Comedy");
        var queries = new List<InternalItemsQuery>();
        _library.GetItemList(Arg.Do<InternalItemsQuery>(queries.Add)).Returns(ci =>
            ci.Arg<InternalItemsQuery>().ItemIds.Length > 0
                ? new BaseItem[] { show }
                : new BaseItem[] { episode, recentMovie, oldMovie, neverPlayed });
        _userData.GetUserDataBatch(Arg.Any<IReadOnlyList<BaseItem>>(), _user).Returns(new Dictionary<Guid, UserItemData>
        {
            [episode.Id] = TestData.UserData(lastPlayed: TestData.Now.UtcDateTime.AddDays(-1)),
            [recentMovie.Id] = TestData.UserData(played: true, lastPlayed: TestData.Now.UtcDateTime.AddDays(-2)),
            [oldMovie.Id] = TestData.UserData(played: true, lastPlayed: TestData.Now.UtcDateTime.AddDays(-120)),
        });

        var history = await new WatchHistoryService(_library, _userData).GetAsync(_user, TestData.Now, CancellationToken.None);

        Assert.Equal([episode.Id, recentMovie.Id], history.Entries.Select(e => e.Item.Id));
        Assert.Equal(show.Id, history.Entries[0].SeriesId);
        Assert.Equal(["Sci-Fi"], history.Entries[0].Genres);
        Assert.Equal(["Drama"], history.Entries[1].Genres);
        var main = queries[0];
        Assert.Same(_user, main.User);
        Assert.Equal([BaseItemKind.Movie, BaseItemKind.Episode], main.IncludeItemTypes);
        Assert.Equal((ItemSortBy.DatePlayed, SortOrder.Descending), Assert.Single(main.OrderBy));
        Assert.Equal(200, main.Limit);
    }

    [Fact]
    public async Task EmptyLibrary_ReturnsEmptyHistory()
    {
        _library.GetItemList(Arg.Any<InternalItemsQuery>()).Returns(Array.Empty<BaseItem>());

        var history = await new WatchHistoryService(_library, _userData).GetAsync(_user, TestData.Now, CancellationToken.None);

        Assert.Empty(history.Entries);
        _userData.DidNotReceiveWithAnyArgs().GetUserDataBatch(default!, default!);
    }
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `source scripts/env.sh && dotnet test --nologo --filter "FullyQualifiedName~GenreWeighting|FullyQualifiedName~WatchHistoryService"`

Expected: build FAILS with `The name 'GenreWeighting' does not exist in the current context`.

- [ ] **Step 3: Implement**

`src/Jellyfin.Plugin.Lumen/Home/GenreWeighting.cs`:
```csharp
using System.Buffers.Binary;
using System.Globalization;
using System.Security.Cryptography;
using System.Text;

namespace Jellyfin.Plugin.Lumen.Home;

/// <summary>Deterministic, pure helpers for genre-based personalization.</summary>
public static class GenreWeighting
{
    /// <summary>Weight = 1 (smoothing) + number of recent plays in that genre, for genres that have available items.</summary>
    public static IReadOnlyDictionary<string, double> Compute(IEnumerable<WatchedEntry> history, IEnumerable<string> availableGenres)
    {
        var weights = new Dictionary<string, double>(StringComparer.OrdinalIgnoreCase);
        foreach (var genre in availableGenres.Where(g => !string.IsNullOrWhiteSpace(g)))
        {
            weights[genre] = 1;
        }

        foreach (var genre in history.SelectMany(e => e.Genres))
        {
            if (weights.TryGetValue(genre, out var weight))
            {
                weights[genre] = weight + 1;
            }
        }

        return weights;
    }

    /// <summary>Weighted sampling without replacement.</summary>
    public static IReadOnlyList<string> Pick(IReadOnlyDictionary<string, double> weights, int count, int seed)
    {
        var random = new Random(seed);
        var pool = weights.OrderBy(w => w.Key, StringComparer.OrdinalIgnoreCase).ToList();
        var picked = new List<string>();
        while (picked.Count < count && pool.Count > 0)
        {
            var target = random.NextDouble() * pool.Sum(w => w.Value);
            var index = 0;
            for (var cumulative = pool[0].Value; cumulative < target && index < pool.Count - 1; cumulative += pool[index].Value)
            {
                index++;
            }

            picked.Add(pool[index].Key);
            pool.RemoveAt(index);
        }

        return picked;
    }

    public static IReadOnlyList<string> TopGenres(IReadOnlyDictionary<string, double> weights, int count) =>
        weights.OrderByDescending(w => w.Value).ThenBy(w => w.Key, StringComparer.OrdinalIgnoreCase).Take(count).Select(w => w.Key).ToList();

    /// <summary>A seed that is stable for a user within a UTC day and changes daily.</summary>
    public static int DailySeed(Guid userId, DateTimeOffset now)
    {
        var text = string.Create(CultureInfo.InvariantCulture, $"{userId:N}:{now.UtcDateTime:yyyy-MM-dd}");
        return BinaryPrimitives.ReadInt32LittleEndian(SHA256.HashData(Encoding.UTF8.GetBytes(text)));
    }

    public static IReadOnlyList<T> SeededShuffle<T>(IReadOnlyList<T> items, int seed)
    {
        var random = new Random(seed);
        var result = items.ToArray();
        for (var i = result.Length - 1; i > 0; i--)
        {
            var j = random.Next(i + 1);
            (result[i], result[j]) = (result[j], result[i]);
        }

        return result;
    }
}
```

`src/Jellyfin.Plugin.Lumen/Home/WatchHistoryService.cs`:
```csharp
using Jellyfin.Data.Enums;
using Jellyfin.Database.Implementations.Entities;
using Jellyfin.Database.Implementations.Enums;
using MediaBrowser.Controller.Entities;
using MediaBrowser.Controller.Entities.TV;
using MediaBrowser.Controller.Library;

namespace Jellyfin.Plugin.Lumen.Home;

/// <summary>Reads a user's recent plays.</summary>
public interface IWatchHistoryService
{
    Task<WatchHistory> GetAsync(User user, DateTimeOffset now, CancellationToken cancellationToken);
}

/// <summary>Recent plays within <see cref="Window"/>, most recent first. Episodes use their series' genres.</summary>
public sealed class WatchHistoryService : IWatchHistoryService
{
    public static readonly TimeSpan Window = TimeSpan.FromDays(90);
    public const int MaxItems = 200;

    private readonly ILibraryManager _libraryManager;
    private readonly IUserDataManager _userDataManager;

    public WatchHistoryService(ILibraryManager libraryManager, IUserDataManager userDataManager)
    {
        _libraryManager = libraryManager;
        _userDataManager = userDataManager;
    }

    public Task<WatchHistory> GetAsync(User user, DateTimeOffset now, CancellationToken cancellationToken)
    {
        var items = _libraryManager.GetItemList(new InternalItemsQuery(user)
        {
            IncludeItemTypes = [BaseItemKind.Movie, BaseItemKind.Episode],
            Recursive = true,
            IsVirtualItem = false,
            OrderBy = [(ItemSortBy.DatePlayed, SortOrder.Descending)],
            Limit = MaxItems,
            DtoOptions = QueryOptions.Full(),
        });
        if (items.Count == 0)
        {
            return Task.FromResult(WatchHistory.Empty);
        }

        cancellationToken.ThrowIfCancellationRequested();
        var userData = _userDataManager.GetUserDataBatch(items, user);
        var cutoff = now.UtcDateTime - Window;
        var played = items
            .Select(item => (Item: item, LastPlayed: userData.GetValueOrDefault(item.Id)?.LastPlayedDate))
            .Where(x => x.LastPlayed is { } at && at >= cutoff)
            .ToList();

        var seriesIds = played.Select(x => x.Item).OfType<Episode>().Select(e => e.SeriesId).Where(id => id != Guid.Empty).Distinct().ToArray();
        var seriesById = seriesIds.Length == 0
            ? new Dictionary<Guid, BaseItem>()
            : _libraryManager.GetItemList(new InternalItemsQuery(user) { ItemIds = seriesIds, DtoOptions = QueryOptions.Full() })
                .ToDictionary(s => s.Id);

        var entries = played.Select(x => x.Item is Episode episode
                ? new WatchedEntry(episode, episode.SeriesId, episode.SeriesName, seriesById.GetValueOrDefault(episode.SeriesId)?.Genres ?? [], x.LastPlayed!.Value)
                : new WatchedEntry(x.Item, null, null, x.Item.Genres ?? [], x.LastPlayed!.Value))
            .ToList();

        return Task.FromResult(new WatchHistory(entries));
    }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `source scripts/env.sh && dotnet test --nologo --filter "FullyQualifiedName~GenreWeighting|FullyQualifiedName~WatchHistoryService"`

Expected: `Passed! - Failed: 0, Passed: 8`.

If `Pick_FavorsHeavilyWatchedGenres` fails, the sampling loop is wrong. Do not lower the threshold. Debug by printing `target` and `cumulative`.

- [ ] **Step 5: Commit**

```bash
git add src tests
git commit -m "feat: add watch history service and deterministic genre weighting" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Home cache

**Files:**
- Create: `src/Jellyfin.Plugin.Lumen/Home/HomeCache.cs`
- Test: `tests/Jellyfin.Plugin.Lumen.Tests/Home/HomeCacheTests.cs`

**Interfaces:**
- Consumes: `HomeResponseDto` (Task 9).
- Produces: `sealed class HomeCache(IUserDataManager, ILibraryManager, TimeProvider) : IDisposable` with:
  - `bool TryGet(Guid userId, int configVersion, [NotNullWhen(true)] out HomeResponseDto? value)`
  - `void Set(Guid userId, int configVersion, HomeResponseDto value)`
  - `void InvalidateUser(Guid userId)`
  - `long LibraryGeneration`
  - `static TimeSpan Ttl` (60 s) and `static TimeSpan LibraryDebounce` (30 s)

- [ ] **Step 1: Write the failing tests**

`tests/Jellyfin.Plugin.Lumen.Tests/Home/HomeCacheTests.cs`:
```csharp
using Jellyfin.Plugin.Lumen.Api;
using Jellyfin.Plugin.Lumen.Home;
using MediaBrowser.Controller.Library;
using Microsoft.Extensions.Time.Testing;
using NSubstitute;
using Xunit;

namespace Jellyfin.Plugin.Lumen.Tests.Home;

public sealed class HomeCacheTests : IDisposable
{
    private static readonly HomeResponseDto Response = new(1, [], []);
    private readonly IUserDataManager _userData = Substitute.For<IUserDataManager>();
    private readonly ILibraryManager _library = Substitute.For<ILibraryManager>();
    private readonly FakeTimeProvider _time = new(TestData.Now);
    private readonly HomeCache _cache;
    private readonly Guid _alice = Guid.NewGuid();
    private readonly Guid _bob = Guid.NewGuid();

    public HomeCacheTests() => _cache = new HomeCache(_userData, _library, _time);

    public void Dispose() => _cache.Dispose();

    [Fact]
    public void Hit_UntilTtlExpires()
    {
        _cache.Set(_alice, 1, Response);

        Assert.True(_cache.TryGet(_alice, 1, out _));
        _time.Advance(HomeCache.Ttl + TimeSpan.FromSeconds(1));
        Assert.False(_cache.TryGet(_alice, 1, out _));
    }

    [Fact]
    public void Miss_WhenConfigVersionChanges()
    {
        _cache.Set(_alice, 1, Response);

        Assert.False(_cache.TryGet(_alice, 2, out _));
    }

    [Fact]
    public void UserDataSaved_EvictsOnlyThatUser()
    {
        _cache.Set(_alice, 1, Response);
        _cache.Set(_bob, 1, Response);

        _userData.UserDataSaved += Raise.EventWith(new UserDataSaveEventArgs { UserId = _alice });

        Assert.False(_cache.TryGet(_alice, 1, out _));
        Assert.True(_cache.TryGet(_bob, 1, out _));
    }

    [Fact]
    public void LibraryChange_InvalidatesEveryone()
    {
        _cache.Set(_alice, 1, Response);

        _library.ItemAdded += Raise.Event<EventHandler<ItemChangeEventArgs>>(_library, new ItemChangeEventArgs());

        Assert.False(_cache.TryGet(_alice, 1, out _));
    }

    [Fact]
    public void LibraryChanges_AreDebounced_LeadingAndTrailing()
    {
        var start = _cache.LibraryGeneration;

        for (var i = 0; i < 5; i++)
        {
            _library.ItemUpdated += Raise.Event<EventHandler<ItemChangeEventArgs>>(_library, new ItemChangeEventArgs());
            _time.Advance(TimeSpan.FromSeconds(1));
        }

        Assert.Equal(start + 1, _cache.LibraryGeneration);
        _time.Advance(HomeCache.LibraryDebounce);
        Assert.Equal(start + 2, _cache.LibraryGeneration);
        _time.Advance(HomeCache.LibraryDebounce * 3);
        Assert.Equal(start + 2, _cache.LibraryGeneration);
    }

    [Fact]
    public void Dispose_Unsubscribes()
    {
        _cache.Dispose();

        _userData.Received().UserDataSaved -= Arg.Any<EventHandler<UserDataSaveEventArgs>>();
        _library.Received().ItemRemoved -= Arg.Any<EventHandler<ItemChangeEventArgs>>();
    }
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `source scripts/env.sh && dotnet test --nologo --filter "FullyQualifiedName~HomeCache"`

Expected: build FAILS with `The type or namespace name 'HomeCache' could not be found`.

- [ ] **Step 3: Implement**

`src/Jellyfin.Plugin.Lumen/Home/HomeCache.cs`:
```csharp
using System.Collections.Concurrent;
using System.Diagnostics.CodeAnalysis;
using Jellyfin.Plugin.Lumen.Api;
using MediaBrowser.Controller.Library;

namespace Jellyfin.Plugin.Lumen.Home;

/// <summary>
/// One cached home response per user, valid for <see cref="Ttl"/>. A user's entry is evicted when their playback data
/// changes. Library changes bump a generation counter (at most once per <see cref="LibraryDebounce"/>, with a
/// trailing bump), which invalidates every entry without walking the cache.
/// </summary>
public sealed class HomeCache : IDisposable
{
    public static readonly TimeSpan Ttl = TimeSpan.FromSeconds(60);
    public static readonly TimeSpan LibraryDebounce = TimeSpan.FromSeconds(30);

    private readonly ConcurrentDictionary<Guid, Entry> _entries = new();
    private readonly Lock _gate = new();
    private readonly IUserDataManager _userDataManager;
    private readonly ILibraryManager _libraryManager;
    private readonly TimeProvider _time;
    private long _generation;
    private DateTimeOffset _lastBump = DateTimeOffset.MinValue;
    private ITimer? _trailingBump;

    public HomeCache(IUserDataManager userDataManager, ILibraryManager libraryManager, TimeProvider time)
    {
        _userDataManager = userDataManager;
        _libraryManager = libraryManager;
        _time = time;
        _userDataManager.UserDataSaved += OnUserDataSaved;
        _libraryManager.ItemAdded += OnItemChanged;
        _libraryManager.ItemUpdated += OnItemChanged;
        _libraryManager.ItemRemoved += OnItemChanged;
    }

    public long LibraryGeneration => Interlocked.Read(ref _generation);

    public bool TryGet(Guid userId, int configVersion, [NotNullWhen(true)] out HomeResponseDto? value)
    {
        if (_entries.TryGetValue(userId, out var entry)
            && entry.Generation == LibraryGeneration
            && entry.ConfigVersion == configVersion
            && entry.ExpiresAt > _time.GetUtcNow())
        {
            value = entry.Value;
            return true;
        }

        value = null;
        return false;
    }

    public void Set(Guid userId, int configVersion, HomeResponseDto value) =>
        _entries[userId] = new Entry(LibraryGeneration, configVersion, _time.GetUtcNow() + Ttl, value);

    public void InvalidateUser(Guid userId) => _entries.TryRemove(userId, out _);

    public void Dispose()
    {
        _userDataManager.UserDataSaved -= OnUserDataSaved;
        _libraryManager.ItemAdded -= OnItemChanged;
        _libraryManager.ItemUpdated -= OnItemChanged;
        _libraryManager.ItemRemoved -= OnItemChanged;
        lock (_gate)
        {
            _trailingBump?.Dispose();
            _trailingBump = null;
        }
    }

    private void OnUserDataSaved(object? sender, UserDataSaveEventArgs e) => InvalidateUser(e.UserId);

    private void OnItemChanged(object? sender, ItemChangeEventArgs e)
    {
        lock (_gate)
        {
            var now = _time.GetUtcNow();
            if (now - _lastBump >= LibraryDebounce)
            {
                Bump(now);
            }
            else
            {
                _trailingBump ??= _time.CreateTimer(_ => OnTrailingBump(), null, _lastBump + LibraryDebounce - now, Timeout.InfiniteTimeSpan);
            }
        }
    }

    private void OnTrailingBump()
    {
        lock (_gate)
        {
            _trailingBump?.Dispose();
            _trailingBump = null;
            Bump(_time.GetUtcNow());
        }
    }

    private void Bump(DateTimeOffset now)
    {
        Interlocked.Increment(ref _generation);
        _lastBump = now;
    }

    private sealed record Entry(long Generation, int ConfigVersion, DateTimeOffset ExpiresAt, HomeResponseDto Value);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `source scripts/env.sh && dotnet test --nologo --filter "FullyQualifiedName~HomeCache"`

Expected: `Passed! - Failed: 0, Passed: 6`.

- [ ] **Step 5: Commit**

```bash
git add src tests
git commit -m "feat: add per-user home cache with debounced library invalidation" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: Home service

**Files:**
- Create:
  - `src/Jellyfin.Plugin.Lumen/Home/HomeService.cs` (with `IHomeService`, `IHeroService`, `HeroItem`)
  - `src/Jellyfin.Plugin.Lumen/Home/HomeDtoMapper.cs` (with `IHomeDtoMapper`)
- Test: `tests/Jellyfin.Plugin.Lumen.Tests/Home/HomeServiceTests.cs`

**Interfaces:**
- Consumes: `IHomeSectionProvider`, `HomeContext`, `HomeRow` (Task 4); `ILumenConfigStore` (Task 5); DTOs (Task 9); `IWatchHistoryService` (Task 10); `HomeCache` (Task 11).
- Produces:
  - `interface IHomeService { Task<HomeResponseDto> GetHomeAsync(User user, CancellationToken cancellationToken); }`
  - `interface IHeroService { Task<IReadOnlyList<HeroItem>> GetHeroAsync(HomeContext context, PluginConfiguration config, CancellationToken cancellationToken); }`
  - `sealed record HeroItem(BaseItem Item, Guid? TrailerItemId)`
  - `interface IHomeDtoMapper { IReadOnlyList<BaseItemDto> MapCards(IReadOnlyList<BaseItem> items, User user); BaseItemDto MapHero(BaseItem item, User user); }`
  - `HomeService.ProviderTimeout` (3 s)

- [ ] **Step 1: Write the failing tests**

`tests/Jellyfin.Plugin.Lumen.Tests/Home/HomeServiceTests.cs`:
```csharp
using Jellyfin.Database.Implementations.Entities;
using Jellyfin.Plugin.Lumen.Configuration;
using Jellyfin.Plugin.Lumen.Home;
using MediaBrowser.Controller.Entities;
using MediaBrowser.Controller.Library;
using MediaBrowser.Model.Dto;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Time.Testing;
using NSubstitute;
using Xunit;

namespace Jellyfin.Plugin.Lumen.Tests.Home;

public sealed class HomeServiceTests : IDisposable
{
    private readonly FakeTimeProvider _time = new(TestData.Now);
    private readonly ILumenConfigStore _store = Substitute.For<ILumenConfigStore>();
    private readonly IHeroService _hero = Substitute.For<IHeroService>();
    private readonly IWatchHistoryService _history = Substitute.For<IWatchHistoryService>();
    private readonly HomeCache _cache;
    private readonly User _user = TestData.User();
    private readonly PluginConfiguration _config = new() { SchemaVersion = 1, ConfigVersion = 1 };

    public HomeServiceTests()
    {
        _cache = new HomeCache(Substitute.For<IUserDataManager>(), Substitute.For<ILibraryManager>(), _time);
        _store.Current.Returns(_ => _config);
        _hero.GetHeroAsync(default!, default!, default).ReturnsForAnyArgs(Task.FromResult<IReadOnlyList<HeroItem>>([]));
        _history.GetAsync(default!, default, default).ReturnsForAnyArgs(Task.FromResult(WatchHistory.Empty));
    }

    public void Dispose() => _cache.Dispose();

    private HomeService Create(params IHomeSectionProvider[] providers) =>
        new(providers, _store, _hero, _history, new FakeMapper(), _cache, _time, NullLogger<HomeService>.Instance);

    private static FakeSectionProvider Returning(string type, params BaseItem[] items) => new(type)
    {
        Rows = (_, def, _) => Task.FromResult(HomeRow.Single(def, type, items)),
    };

    private SectionDefinition Add(string type, bool enabled = true)
    {
        var section = TestData.Section(type);
        section.Enabled = enabled;
        _config.Sections.Add(section);
        return section;
    }

    [Fact]
    public async Task ReturnsRowsInConfiguredOrder_AndSkipsDisabled()
    {
        Add("B");
        Add("A");
        Add("C", enabled: false);

        var home = await Create(Returning("A", TestData.Movie("a")), Returning("B", TestData.Movie("b")), Returning("C", TestData.Movie("c")))
            .GetHomeAsync(_user, CancellationToken.None);

        Assert.Equal(["B", "A"], home.Rows.Select(r => r.Type));
        Assert.Equal("b", home.Rows[0].Items[0].Name);
        Assert.Equal(1, home.ConfigVersion);
    }

    [Fact]
    public async Task OmitsEmptyRows()
    {
        var def = Add("Empty");
        var provider = new FakeSectionProvider("Empty")
        {
            Rows = (_, d, _) => Task.FromResult<IReadOnlyList<HomeRow>>([new HomeRow(HomeRow.RowId(d, 0), "Empty", "t", [])]),
        };

        var home = await Create(provider).GetHomeAsync(_user, CancellationToken.None);

        Assert.Empty(home.Rows);
        Assert.Empty(home.Hero);
    }

    [Fact]
    public async Task FailingProvider_IsIsolated()
    {
        Add("Bad");
        Add("Good");
        var bad = new FakeSectionProvider("Bad") { Rows = (_, _, _) => throw new InvalidOperationException("boom") };

        var home = await Create(bad, Returning("Good", TestData.Movie("g"))).GetHomeAsync(_user, CancellationToken.None);

        Assert.Equal(["Good"], home.Rows.Select(r => r.Type));
    }

    [Fact]
    public async Task SlowProvider_TimesOut()
    {
        Add("Slow");
        Add("Good");
        var slow = new FakeSectionProvider("Slow")
        {
            Rows = async (_, _, ct) =>
            {
                await Task.Delay(Timeout.Infinite, ct);
                return [];
            },
        };

        var pending = Create(slow, Returning("Good", TestData.Movie("g"))).GetHomeAsync(_user, CancellationToken.None);
        _time.Advance(HomeService.ProviderTimeout + TimeSpan.FromSeconds(1));
        var home = await pending;

        Assert.Equal(["Good"], home.Rows.Select(r => r.Type));
    }

    [Fact]
    public async Task UnknownType_AndInvalidDefinition_AreSkipped()
    {
        Add("Missing");
        Add("Picky");
        var picky = Returning("Picky", TestData.Movie("p"));
        picky.ValidateRule = _ => ["bad params"];

        var home = await Create(picky).GetHomeAsync(_user, CancellationToken.None);

        Assert.Empty(home.Rows);
    }

    [Fact]
    public async Task HeroFailure_ReturnsEmptyHero_AndRows()
    {
        Add("A");
        _hero.GetHeroAsync(default!, default!, default).ReturnsForAnyArgs(Task.FromException<IReadOnlyList<HeroItem>>(new InvalidOperationException()));

        var home = await Create(Returning("A", TestData.Movie("a"))).GetHomeAsync(_user, CancellationToken.None);

        Assert.Empty(home.Hero);
        Assert.Single(home.Rows);
    }

    [Fact]
    public async Task MapsHeroItems_WithTrailerIds()
    {
        var movie = TestData.Movie("hero");
        var trailer = Guid.NewGuid();
        _hero.GetHeroAsync(default!, default!, default).ReturnsForAnyArgs(Task.FromResult<IReadOnlyList<HeroItem>>([new HeroItem(movie, trailer)]));

        var home = await Create().GetHomeAsync(_user, CancellationToken.None);

        var hero = Assert.Single(home.Hero);
        Assert.Equal("hero", hero.Item.Name);
        Assert.Equal(trailer, hero.TrailerItemId);
    }

    [Fact]
    public async Task UsesCache_UntilConfigVersionChanges()
    {
        Add("A");
        var calls = 0;
        var provider = new FakeSectionProvider("A")
        {
            Rows = (_, def, _) =>
            {
                calls++;
                return Task.FromResult(HomeRow.Single(def, "A", [TestData.Movie("a")]));
            },
        };
        var service = Create(provider);

        await service.GetHomeAsync(_user, CancellationToken.None);
        await service.GetHomeAsync(_user, CancellationToken.None);
        _config.ConfigVersion = 2;
        await service.GetHomeAsync(_user, CancellationToken.None);

        Assert.Equal(2, calls);
    }

    [Fact]
    public async Task WatchHistory_IsComputedOncePerBuild()
    {
        Add("A");
        Add("B");
        FakeSectionProvider UsesHistory(string type) => new(type)
        {
            Rows = async (ctx, def, _) =>
            {
                await ctx.GetWatchHistoryAsync();
                return HomeRow.Single(def, type, [TestData.Movie(type)]);
            },
        };

        await Create(UsesHistory("A"), UsesHistory("B")).GetHomeAsync(_user, CancellationToken.None);

        await _history.ReceivedWithAnyArgs(1).GetAsync(default!, default, default);
    }

    private sealed class FakeMapper : IHomeDtoMapper
    {
        public IReadOnlyList<BaseItemDto> MapCards(IReadOnlyList<BaseItem> items, User user) =>
            items.Select(i => new BaseItemDto { Id = i.Id, Name = i.Name }).ToList();

        public BaseItemDto MapHero(BaseItem item, User user) => new() { Id = item.Id, Name = item.Name };
    }
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `source scripts/env.sh && dotnet test --nologo --filter "FullyQualifiedName~HomeServiceTests"`

Expected: build FAILS with `The type or namespace name 'HomeService' could not be found`.

- [ ] **Step 3: Implement**

`src/Jellyfin.Plugin.Lumen/Home/HomeDtoMapper.cs`:
```csharp
using Jellyfin.Database.Implementations.Entities;
using MediaBrowser.Controller.Dto;
using MediaBrowser.Controller.Entities;
using MediaBrowser.Model.Dto;
using MediaBrowser.Model.Entities;
using MediaBrowser.Model.Querying;

namespace Jellyfin.Plugin.Lumen.Home;

/// <summary>Maps domain items to the minimal DTOs the client needs.</summary>
public interface IHomeDtoMapper
{
    IReadOnlyList<BaseItemDto> MapCards(IReadOnlyList<BaseItem> items, User user);

    BaseItemDto MapHero(BaseItem item, User user);
}

/// <summary><see cref="IHomeDtoMapper"/> backed by Jellyfin's DTO service.</summary>
public sealed class HomeDtoMapper : IHomeDtoMapper
{
    private readonly IDtoService _dtoService;

    public HomeDtoMapper(IDtoService dtoService)
    {
        _dtoService = dtoService;
    }

    public IReadOnlyList<BaseItemDto> MapCards(IReadOnlyList<BaseItem> items, User user) =>
        _dtoService.GetBaseItemDtos(items, CardOptions(), user);

    public BaseItemDto MapHero(BaseItem item, User user) => _dtoService.GetBaseItemDto(item, HeroOptions(), user);

    private static DtoOptions CardOptions() => new(false)
    {
        Fields = [ItemFields.PrimaryImageAspectRatio],
        ImageTypes = [ImageType.Primary, ImageType.Backdrop, ImageType.Thumb, ImageType.Logo],
        ImageTypeLimit = 1,
        EnableImages = true,
        EnableUserData = true,
    };

    private static DtoOptions HeroOptions() => new(false)
    {
        Fields = [ItemFields.PrimaryImageAspectRatio, ItemFields.Overview, ItemFields.Genres],
        ImageTypes = [ImageType.Backdrop, ImageType.Logo, ImageType.Primary],
        ImageTypeLimit = 1,
        EnableImages = true,
        EnableUserData = true,
    };
}
```

`src/Jellyfin.Plugin.Lumen/Home/HomeService.cs`:
```csharp
using Jellyfin.Database.Implementations.Entities;
using Jellyfin.Plugin.Lumen.Api;
using Jellyfin.Plugin.Lumen.Configuration;
using MediaBrowser.Controller.Entities;
using Microsoft.Extensions.Logging;

namespace Jellyfin.Plugin.Lumen.Home;

/// <summary>A hero slide: the item and its local trailer, if any.</summary>
public sealed record HeroItem(BaseItem Item, Guid? TrailerItemId);

/// <summary>Builds the home response for a user.</summary>
public interface IHomeService
{
    Task<HomeResponseDto> GetHomeAsync(User user, CancellationToken cancellationToken);
}

/// <summary>Selects hero items.</summary>
public interface IHeroService
{
    Task<IReadOnlyList<HeroItem>> GetHeroAsync(HomeContext context, PluginConfiguration config, CancellationToken cancellationToken);
}

/// <summary>
/// Runs the enabled section providers in parallel, each with its own timeout and exception boundary, and assembles the
/// response in configured order. Results are cached per user in <see cref="HomeCache"/>.
/// </summary>
public sealed class HomeService : IHomeService
{
    public static readonly TimeSpan ProviderTimeout = TimeSpan.FromSeconds(3);

    private readonly Dictionary<string, IHomeSectionProvider> _providers;
    private readonly ILumenConfigStore _config;
    private readonly IHeroService _hero;
    private readonly IWatchHistoryService _history;
    private readonly IHomeDtoMapper _mapper;
    private readonly HomeCache _cache;
    private readonly TimeProvider _time;
    private readonly ILogger<HomeService> _logger;

    public HomeService(
        IEnumerable<IHomeSectionProvider> providers,
        ILumenConfigStore config,
        IHeroService hero,
        IWatchHistoryService history,
        IHomeDtoMapper mapper,
        HomeCache cache,
        TimeProvider time,
        ILogger<HomeService> logger)
    {
        _providers = providers.ToDictionary(p => p.Type, StringComparer.OrdinalIgnoreCase);
        _config = config;
        _hero = hero;
        _history = history;
        _mapper = mapper;
        _cache = cache;
        _time = time;
        _logger = logger;
    }

    public async Task<HomeResponseDto> GetHomeAsync(User user, CancellationToken cancellationToken)
    {
        var config = _config.Current;
        if (_cache.TryGet(user.Id, config.ConfigVersion, out var cached))
        {
            return cached;
        }

        var response = await BuildAsync(user, config, cancellationToken);
        _cache.Set(user.Id, config.ConfigVersion, response);
        return response;
    }

    private async Task<HomeResponseDto> BuildAsync(User user, PluginConfiguration config, CancellationToken cancellationToken)
    {
        var now = _time.GetUtcNow();
        var context = new HomeContext(user, now, () => _history.GetAsync(user, now, cancellationToken));

        var heroTask = RunGuardedAsync("hero", ct => _hero.GetHeroAsync(context, config, ct), (IReadOnlyList<HeroItem>)[], cancellationToken);
        var sectionTasks = config.Sections.Where(s => s.Enabled).Select(s => RunSectionAsync(context, s, cancellationToken)).ToList();

        var sections = await Task.WhenAll(sectionTasks);
        var hero = await heroTask;

        var rows = sections
            .SelectMany(r => r)
            .Where(r => r.Items.Count > 0)
            .Select(r => new HomeRowDto(r.Id, r.Type, r.Title, _mapper.MapCards(r.Items, user)))
            .ToList();
        var heroDtos = hero.Select(h => new HeroItemDto(_mapper.MapHero(h.Item, user), h.TrailerItemId)).ToList();

        return new HomeResponseDto(config.ConfigVersion, heroDtos, rows);
    }

    private Task<IReadOnlyList<HomeRow>> RunSectionAsync(HomeContext context, SectionDefinition section, CancellationToken cancellationToken)
    {
        if (!_providers.TryGetValue(section.Type, out var provider))
        {
            _logger.LogWarning("Lumen skipped section {SectionId}: unknown type {Type}", section.Id, section.Type);
            return Task.FromResult<IReadOnlyList<HomeRow>>([]);
        }

        var errors = provider.Validate(section);
        if (errors.Count > 0)
        {
            _logger.LogWarning("Lumen skipped section {SectionId} ({Type}): {Errors}", section.Id, section.Type, string.Join("; ", errors));
            return Task.FromResult<IReadOnlyList<HomeRow>>([]);
        }

        return RunGuardedAsync($"section {section.Id} ({section.Type})", ct => provider.GetRowsAsync(context, section, ct), (IReadOnlyList<HomeRow>)[], cancellationToken);
    }

    private async Task<T> RunGuardedAsync<T>(string label, Func<CancellationToken, Task<T>> work, T fallback, CancellationToken cancellationToken)
    {
        using var linked = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        try
        {
            // Task.Run: providers make synchronous library calls; this lets them run in parallel and be abandoned on timeout.
            return await Task.Run(() => work(linked.Token), linked.Token).WaitAsync(ProviderTimeout, _time, cancellationToken);
        }
        catch (TimeoutException)
        {
            await linked.CancelAsync();
            _logger.LogWarning("Lumen {Label} timed out after {Timeout}", label, ProviderTimeout);
            return fallback;
        }
        catch (Exception ex) when (ex is not OperationCanceledException || !cancellationToken.IsCancellationRequested)
        {
            _logger.LogWarning(ex, "Lumen {Label} failed", label);
            return fallback;
        }
    }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `source scripts/env.sh && dotnet test --nologo --filter "FullyQualifiedName~HomeServiceTests"`

Expected: `Passed! - Failed: 0, Passed: 9`.

- [ ] **Step 5: Commit**

```bash
git add src tests
git commit -m "feat: add home service with parallel, isolated, time-boxed providers" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 13: Continue Watching, Next Up, and Recently Added providers

**Files:**
- Create: `src/Jellyfin.Plugin.Lumen/Home/Providers/ContinueWatchingProvider.cs`, `src/Jellyfin.Plugin.Lumen/Home/Providers/NextUpProvider.cs`, `src/Jellyfin.Plugin.Lumen/Home/Providers/RecentlyAddedProvider.cs`
- Test: `tests/Jellyfin.Plugin.Lumen.Tests/Home/Providers/BasicProvidersTests.cs`

**Interfaces:**
- Consumes: `IHomeSectionProvider`, `HomeRow`, `HomeContext`, `QueryOptions`, `SectionTypes` (Tasks 3–4).
- Produces:
  - Providers with types `ContinueWatching` ("Continue Watching"), `NextUp` ("Next Up"), `RecentlyAdded` ("Recently Added", optional param `libraryId`).
  - `internal static IReadOnlyList<BaseItem> RecentlyAddedProvider.Group(IReadOnlyList<BaseItem> items, IReadOnlyDictionary<Guid, BaseItem> seriesById, int limit)`

- [ ] **Step 1: Write the failing tests**

`tests/Jellyfin.Plugin.Lumen.Tests/Home/Providers/BasicProvidersTests.cs`:
```csharp
using Jellyfin.Data.Enums;
using Jellyfin.Database.Implementations.Entities;
using Jellyfin.Database.Implementations.Enums;
using Jellyfin.Plugin.Lumen.Configuration;
using Jellyfin.Plugin.Lumen.Home.Providers;
using MediaBrowser.Controller.Dto;
using MediaBrowser.Controller.Entities;
using MediaBrowser.Controller.Library;
using MediaBrowser.Controller.TV;
using MediaBrowser.Model.Querying;
using NSubstitute;
using Xunit;

namespace Jellyfin.Plugin.Lumen.Tests.Home.Providers;

public class BasicProvidersTests
{
    private readonly ILibraryManager _library = Substitute.For<ILibraryManager>();
    private readonly User _user = TestData.User();
    private readonly List<InternalItemsQuery> _queries = [];

    public BasicProvidersTests()
    {
        _library.GetItemList(Arg.Do<InternalItemsQuery>(_queries.Add)).Returns(Array.Empty<BaseItem>());
    }

    [Fact]
    public async Task ContinueWatching_QueriesResumableMoviesAndEpisodes()
    {
        var movie = TestData.Movie("m");
        _library.GetItemList(Arg.Any<InternalItemsQuery>()).Returns(new BaseItem[] { movie });
        var def = TestData.Section(SectionTypes.ContinueWatching);

        var rows = await new ContinueWatchingProvider(_library).GetRowsAsync(TestData.Context(_user), def, CancellationToken.None);

        var row = Assert.Single(rows);
        Assert.Equal("Continue Watching", row.Title);
        Assert.Same(movie, Assert.Single(row.Items));
        var q = Assert.Single(_queries);
        Assert.Same(_user, q.User);
        Assert.True(q.IsResumable);
        Assert.Equal([BaseItemKind.Movie, BaseItemKind.Episode], q.IncludeItemTypes);
        Assert.Equal((ItemSortBy.DatePlayed, SortOrder.Descending), Assert.Single(q.OrderBy));
        Assert.Equal(20, q.Limit);
        Assert.False(q.IsVirtualItem);
    }

    [Fact]
    public async Task ContinueWatching_Empty_ReturnsNoRows_AndHonorsTitleOverride()
    {
        var def = TestData.Section(SectionTypes.ContinueWatching);
        def.Title = "Pick up where you left off";

        Assert.Empty(await new ContinueWatchingProvider(_library).GetRowsAsync(TestData.Context(_user), def, CancellationToken.None));
    }

    [Fact]
    public async Task NextUp_UsesSeriesManager_WithoutResumables()
    {
        var tv = Substitute.For<ITVSeriesManager>();
        NextUpQuery? captured = null;
        var episode = TestData.Episode(TestData.Series("s"), 1, 2);
        tv.GetNextUp(Arg.Do<NextUpQuery>(q => captured = q), Arg.Any<DtoOptions>()).Returns(new QueryResult<BaseItem>([episode]));

        var rows = await new NextUpProvider(tv).GetRowsAsync(TestData.Context(_user), TestData.Section(SectionTypes.NextUp), CancellationToken.None);

        Assert.Equal("Next Up", Assert.Single(rows).Title);
        Assert.Same(_user, captured!.User);
        Assert.Equal(20, captured.Limit);
        Assert.False(captured.EnableResumable);
    }

    [Fact]
    public void Group_CollapsesEpisodesToSeries_InFirstSeenOrder()
    {
        var show = TestData.Series("Show");
        var movie = TestData.Movie("Movie");
        BaseItem[] items = [TestData.Episode(show, 1, 3), movie, TestData.Episode(show, 1, 2), TestData.Episode(TestData.Series("Orphan"), 1, 1)];

        var grouped = RecentlyAddedProvider.Group(items, new Dictionary<Guid, BaseItem> { [show.Id] = show }, 10);

        Assert.Equal([show, movie], grouped);
    }

    [Fact]
    public async Task RecentlyAdded_ScopesToVisibleLibrary()
    {
        var libraryId = Guid.NewGuid();
        _library.GetItemById<Folder>(libraryId, _user).Returns(new Folder { Id = libraryId });
        var def = TestData.Section(SectionTypes.RecentlyAdded, ("libraryId", libraryId.ToString("N")));

        await new RecentlyAddedProvider(_library).GetRowsAsync(TestData.Context(_user), def, CancellationToken.None);

        var q = Assert.Single(_queries);
        Assert.Equal(libraryId, q.ParentId);
        Assert.True(q.Recursive);
        Assert.Equal((ItemSortBy.DateCreated, SortOrder.Descending), Assert.Single(q.OrderBy));
    }

    [Fact]
    public async Task RecentlyAdded_ReturnsNothing_WhenUserCannotSeeLibrary()
    {
        var libraryId = Guid.NewGuid();
        _library.GetItemById<Folder>(libraryId, _user).Returns((Folder?)null);
        var def = TestData.Section(SectionTypes.RecentlyAdded, ("libraryId", libraryId.ToString("N")));

        var rows = await new RecentlyAddedProvider(_library).GetRowsAsync(TestData.Context(_user), def, CancellationToken.None);

        Assert.Empty(rows);
        Assert.Empty(_queries);
    }

    [Fact]
    public async Task RecentlyAdded_WithoutLibrary_SpansUserLibraries()
    {
        await new RecentlyAddedProvider(_library).GetRowsAsync(TestData.Context(_user), TestData.Section(SectionTypes.RecentlyAdded), CancellationToken.None);

        Assert.Equal(Guid.Empty, Assert.Single(_queries).ParentId);
    }
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `source scripts/env.sh && dotnet test --nologo --filter "FullyQualifiedName~BasicProviders"`

Expected: build FAILS with `The type or namespace name 'ContinueWatchingProvider' could not be found`.

- [ ] **Step 3: Implement**

`src/Jellyfin.Plugin.Lumen/Home/Providers/ContinueWatchingProvider.cs`:
```csharp
using Jellyfin.Data.Enums;
using Jellyfin.Database.Implementations.Enums;
using Jellyfin.Plugin.Lumen.Configuration;
using MediaBrowser.Controller.Entities;
using MediaBrowser.Controller.Library;

namespace Jellyfin.Plugin.Lumen.Home.Providers;

/// <summary>Movies and episodes the user started but did not finish.</summary>
public sealed class ContinueWatchingProvider : IHomeSectionProvider
{
    private readonly ILibraryManager _libraryManager;

    public ContinueWatchingProvider(ILibraryManager libraryManager)
    {
        _libraryManager = libraryManager;
    }

    public string Type => SectionTypes.ContinueWatching;

    public string DisplayName => "Continue Watching";

    public IReadOnlyList<SectionParameter> Parameters => [];

    public IReadOnlyList<string> Validate(SectionDefinition definition) => [];

    public Task<IReadOnlyList<HomeRow>> GetRowsAsync(HomeContext context, SectionDefinition definition, CancellationToken cancellationToken)
    {
        var items = _libraryManager.GetItemList(new InternalItemsQuery(context.User)
        {
            IncludeItemTypes = [BaseItemKind.Movie, BaseItemKind.Episode],
            IsResumable = true,
            Recursive = true,
            IsVirtualItem = false,
            CollapseBoxSetItems = false,
            OrderBy = [(ItemSortBy.DatePlayed, SortOrder.Descending)],
            Limit = context.ItemLimit,
            DtoOptions = QueryOptions.Full(),
        });

        return Task.FromResult(HomeRow.Single(definition, DisplayName, items));
    }
}
```

`src/Jellyfin.Plugin.Lumen/Home/Providers/NextUpProvider.cs`:
```csharp
using Jellyfin.Plugin.Lumen.Configuration;
using MediaBrowser.Controller.TV;
using MediaBrowser.Model.Querying;

namespace Jellyfin.Plugin.Lumen.Home.Providers;

/// <summary>The next unwatched episode of each show in progress (resumable episodes are in Continue Watching).</summary>
public sealed class NextUpProvider : IHomeSectionProvider
{
    private readonly ITVSeriesManager _seriesManager;

    public NextUpProvider(ITVSeriesManager seriesManager)
    {
        _seriesManager = seriesManager;
    }

    public string Type => SectionTypes.NextUp;

    public string DisplayName => "Next Up";

    public IReadOnlyList<SectionParameter> Parameters => [];

    public IReadOnlyList<string> Validate(SectionDefinition definition) => [];

    public Task<IReadOnlyList<HomeRow>> GetRowsAsync(HomeContext context, SectionDefinition definition, CancellationToken cancellationToken)
    {
        var result = _seriesManager.GetNextUp(
            new NextUpQuery
            {
                User = context.User,
                Limit = context.ItemLimit,
                EnableResumable = false,
                EnableRewatching = false,
                EnableTotalRecordCount = false,
            },
            QueryOptions.Full());

        return Task.FromResult(HomeRow.Single(definition, DisplayName, result.Items));
    }
}
```

`src/Jellyfin.Plugin.Lumen/Home/Providers/RecentlyAddedProvider.cs`:
```csharp
using Jellyfin.Data.Enums;
using Jellyfin.Database.Implementations.Enums;
using Jellyfin.Plugin.Lumen.Configuration;
using MediaBrowser.Controller.Entities;
using MediaBrowser.Controller.Entities.TV;
using MediaBrowser.Controller.Library;

namespace Jellyfin.Plugin.Lumen.Home.Providers;

/// <summary>Newest movies and shows, optionally limited to one library. New episodes appear as their series.</summary>
public sealed class RecentlyAddedProvider : IHomeSectionProvider
{
    private const int OverFetchFactor = 5;
    private readonly ILibraryManager _libraryManager;

    public RecentlyAddedProvider(ILibraryManager libraryManager)
    {
        _libraryManager = libraryManager;
    }

    public string Type => SectionTypes.RecentlyAdded;

    public string DisplayName => "Recently Added";

    public IReadOnlyList<SectionParameter> Parameters { get; } =
        [new SectionParameter("libraryId", "Library (empty = all libraries)", SectionParameterKind.Library)];

    public IReadOnlyList<string> Validate(SectionDefinition definition) => [];

    public Task<IReadOnlyList<HomeRow>> GetRowsAsync(HomeContext context, SectionDefinition definition, CancellationToken cancellationToken)
    {
        var query = new InternalItemsQuery(context.User)
        {
            IncludeItemTypes = [BaseItemKind.Movie, BaseItemKind.Episode],
            Recursive = true,
            IsVirtualItem = false,
            OrderBy = [(ItemSortBy.DateCreated, SortOrder.Descending)],
            Limit = context.ItemLimit * OverFetchFactor,
            DtoOptions = QueryOptions.Full(),
        };

        if (definition.GetGuidParam("libraryId") is { } libraryId)
        {
            // Visibility check: returns null when the user cannot access the library.
            if (_libraryManager.GetItemById<Folder>(libraryId, context.User) is null)
            {
                return Task.FromResult<IReadOnlyList<HomeRow>>([]);
            }

            query.ParentId = libraryId;
        }

        var items = _libraryManager.GetItemList(query);
        var seriesIds = items.OfType<Episode>().Select(e => e.SeriesId).Where(id => id != Guid.Empty).Distinct().ToArray();
        var seriesById = seriesIds.Length == 0
            ? new Dictionary<Guid, BaseItem>()
            : _libraryManager.GetItemList(new InternalItemsQuery(context.User) { ItemIds = seriesIds, DtoOptions = QueryOptions.Full() })
                .ToDictionary(s => s.Id);

        return Task.FromResult(HomeRow.Single(definition, DisplayName, Group(items, seriesById, context.ItemLimit)));
    }

    internal static IReadOnlyList<BaseItem> Group(IReadOnlyList<BaseItem> items, IReadOnlyDictionary<Guid, BaseItem> seriesById, int limit)
    {
        var seen = new HashSet<Guid>();
        var result = new List<BaseItem>();
        foreach (var item in items)
        {
            var card = item is Episode episode ? seriesById.GetValueOrDefault(episode.SeriesId) : item;
            if (card is null || !seen.Add(card.Id))
            {
                continue;
            }

            result.Add(card);
            if (result.Count == limit)
            {
                break;
            }
        }

        return result;
    }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `source scripts/env.sh && dotnet test --nologo --filter "FullyQualifiedName~BasicProviders"`

Expected: `Passed! - Failed: 0, Passed: 7`.

- [ ] **Step 5: Commit**

```bash
git add src tests
git commit -m "feat: add continue watching, next up, and recently added sections" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 14: Genre and New For You providers

**Files:**
- Create: `src/Jellyfin.Plugin.Lumen/Home/Providers/GenreProvider.cs`, `src/Jellyfin.Plugin.Lumen/Home/Providers/NewForYouProvider.cs`
- Test: `tests/Jellyfin.Plugin.Lumen.Tests/Home/Providers/GenreProviderTests.cs`, `tests/Jellyfin.Plugin.Lumen.Tests/Home/Providers/NewForYouProviderTests.cs`

**Interfaces:**
- Consumes: `GenreWeighting`, `WatchHistory` (Task 10); provider contracts (Task 4).
- Produces:
  - `GenreProvider`: type `Genre`, param `genreCount` (1–6, default 3); emits one row per picked genre, titled with the genre name.
  - `NewForYouProvider`: type `NewForYou`, param `days` (1–90, default 14).
  - `internal static IReadOnlyList<BaseItem> NewForYouProvider.Merge(IEnumerable<(BaseItem Item, DateTime Added)> candidates, int limit)`

- [ ] **Step 1: Write the failing tests**

`tests/Jellyfin.Plugin.Lumen.Tests/Home/Providers/GenreProviderTests.cs`:
```csharp
using Jellyfin.Data.Enums;
using Jellyfin.Plugin.Lumen.Configuration;
using Jellyfin.Plugin.Lumen.Home;
using Jellyfin.Plugin.Lumen.Home.Providers;
using MediaBrowser.Controller.Entities;
using MediaBrowser.Controller.Library;
using NSubstitute;
using Xunit;

namespace Jellyfin.Plugin.Lumen.Tests.Home.Providers;

public class GenreProviderTests
{
    private readonly ILibraryManager _library = Substitute.For<ILibraryManager>();
    private readonly InternalItemsQuery[] _lastQuery = new InternalItemsQuery[1];

    private GenreProviderTests WithCandidates(params BaseItem[] items)
    {
        _library.GetItemList(Arg.Do<InternalItemsQuery>(q => _lastQuery[0] = q)).Returns(items);
        return this;
    }

    private static HomeContext ContextOn(DateTimeOffset day, WatchHistory? history = null)
    {
        var user = new Jellyfin.Database.Implementations.Entities.User("u", "a", "r") { Id = Guid.Parse("11111111-1111-1111-1111-111111111111") };
        return new HomeContext(user, day, () => Task.FromResult(history ?? WatchHistory.Empty));
    }

    [Fact]
    public async Task EmitsRequestedGenreRows_FromUnplayedCandidates()
    {
        WithCandidates(TestData.Movie("a", "Drama"), TestData.Movie("b", "Comedy"), TestData.Series("c", "Sci-Fi"), TestData.Movie("d", "Drama", "Comedy"));
        var def = TestData.Section(SectionTypes.Genre, ("genreCount", "2"));

        var rows = await new GenreProvider(_library).GetRowsAsync(ContextOn(TestData.Now), def, CancellationToken.None);

        Assert.Equal(2, rows.Count);
        Assert.Equal(2, rows.Select(r => r.Title).Distinct().Count());
        Assert.All(rows, r => Assert.All(r.Items, i => Assert.Contains(r.Title, i.Genres)));
        Assert.False(_lastQuery[0].IsPlayed);
        Assert.Equal([BaseItemKind.Movie, BaseItemKind.Series], _lastQuery[0].IncludeItemTypes);
    }

    [Fact]
    public async Task SelectionIsStableWithinADay_AndRotatesAcrossDays()
    {
        WithCandidates(new[] { "A", "B", "C", "D", "E", "F" }.Select(g => (BaseItem)TestData.Movie(g, g)).ToArray());
        var def = TestData.Section(SectionTypes.Genre, ("genreCount", "1"));
        var provider = new GenreProvider(_library);

        var morning = (await provider.GetRowsAsync(ContextOn(TestData.Now), def, CancellationToken.None))[0].Title;
        var evening = (await provider.GetRowsAsync(ContextOn(TestData.Now.AddHours(8)), def, CancellationToken.None))[0].Title;
        var acrossDays = new HashSet<string>();
        for (var d = 0; d < 10; d++)
        {
            acrossDays.Add((await provider.GetRowsAsync(ContextOn(TestData.Now.AddDays(d)), def, CancellationToken.None))[0].Title);
        }

        Assert.Equal(morning, evening);
        Assert.True(acrossDays.Count >= 2);
    }

    [Fact]
    public async Task NoCandidates_NoRows()
    {
        WithCandidates();

        Assert.Empty(await new GenreProvider(_library).GetRowsAsync(ContextOn(TestData.Now), TestData.Section(SectionTypes.Genre), CancellationToken.None));
    }
}
```

`tests/Jellyfin.Plugin.Lumen.Tests/Home/Providers/NewForYouProviderTests.cs`:
```csharp
using Jellyfin.Data.Enums;
using Jellyfin.Database.Implementations.Entities;
using Jellyfin.Plugin.Lumen.Configuration;
using Jellyfin.Plugin.Lumen.Home;
using Jellyfin.Plugin.Lumen.Home.Providers;
using MediaBrowser.Controller.Entities;
using MediaBrowser.Controller.Library;
using NSubstitute;
using Xunit;

namespace Jellyfin.Plugin.Lumen.Tests.Home.Providers;

public class NewForYouProviderTests
{
    private readonly ILibraryManager _library = Substitute.For<ILibraryManager>();
    private readonly User _user = TestData.User();
    private readonly List<InternalItemsQuery> _queries = [];

    [Fact]
    public async Task CombinesNewEpisodesOfWatchedShows_AndNewMoviesInTopGenres_NewestFirst()
    {
        var watchedShow = TestData.Series("Watched", "Sci-Fi");
        var otherShow = TestData.Series("Other", "Sci-Fi");
        var newEpisode = TestData.Episode(watchedShow, 2, 1);
        newEpisode.DateCreated = TestData.Now.UtcDateTime.AddDays(-1);
        var otherEpisode = TestData.Episode(otherShow, 1, 1);
        var newMovie = TestData.Movie("New Movie", "Sci-Fi");
        newMovie.DateCreated = TestData.Now.UtcDateTime.AddDays(-3);
        var history = new WatchHistory([new WatchedEntry(TestData.Episode(watchedShow, 1, 1), watchedShow.Id, "Watched", ["Sci-Fi"], TestData.Now.UtcDateTime)]);
        _library.GetItemList(Arg.Do<InternalItemsQuery>(_queries.Add)).Returns(ci =>
        {
            var q = ci.Arg<InternalItemsQuery>();
            if (q.ItemIds.Length > 0)
            {
                return new BaseItem[] { watchedShow };
            }

            return q.IncludeItemTypes.Contains(BaseItemKind.Episode) ? new BaseItem[] { newEpisode, otherEpisode } : new BaseItem[] { newMovie };
        });
        var def = TestData.Section(SectionTypes.NewForYou, ("days", "7"));

        var rows = await new NewForYouProvider(_library).GetRowsAsync(TestData.Context(_user, history), def, CancellationToken.None);

        Assert.Equal([watchedShow, newMovie], Assert.Single(rows).Items);
        var movieQuery = _queries.Single(q => q.IncludeItemTypes.Contains(BaseItemKind.Movie));
        Assert.Equal(["Sci-Fi"], movieQuery.Genres);
        Assert.Equal(TestData.Now.UtcDateTime.AddDays(-7), movieQuery.MinDateCreated);
        Assert.False(movieQuery.IsPlayed);
    }

    [Fact]
    public async Task NoHistory_RunsNoQueries()
    {
        var rows = await new NewForYouProvider(_library).GetRowsAsync(TestData.Context(_user), TestData.Section(SectionTypes.NewForYou), CancellationToken.None);

        Assert.Empty(rows);
        _library.DidNotReceiveWithAnyArgs().GetItemList(default!);
    }

    [Fact]
    public void Merge_OrdersNewestFirst_Deduplicates_AndLimits()
    {
        var a = TestData.Movie("a");
        var b = TestData.Movie("b");
        var c = TestData.Movie("c");

        var merged = NewForYouProvider.Merge([(a, TestData.Now.UtcDateTime.AddDays(-3)), (b, TestData.Now.UtcDateTime), (a, TestData.Now.UtcDateTime.AddDays(-1)), (c, TestData.Now.UtcDateTime.AddDays(-9))], 2);

        Assert.Equal([b, a], merged);
    }
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `source scripts/env.sh && dotnet test --nologo --filter "FullyQualifiedName~GenreProvider|FullyQualifiedName~NewForYou"`

Expected: build FAILS with `The type or namespace name 'GenreProvider' could not be found`.

- [ ] **Step 3: Implement**

`src/Jellyfin.Plugin.Lumen/Home/Providers/GenreProvider.cs`:
```csharp
using Jellyfin.Data.Enums;
using Jellyfin.Database.Implementations.Enums;
using Jellyfin.Plugin.Lumen.Configuration;
using MediaBrowser.Controller.Entities;
using MediaBrowser.Controller.Library;

namespace Jellyfin.Plugin.Lumen.Home.Providers;

/// <summary>
/// Daily-rotating genre rows weighted toward what the user watches. Candidates are the top-rated unplayed movies and
/// shows, so a genre is only picked when it has something to show. Rows are titled with the genre name.
/// </summary>
public sealed class GenreProvider : IHomeSectionProvider
{
    private const int CandidateLimit = 500;
    private const int PoolPerGenre = 40;
    private readonly ILibraryManager _libraryManager;

    public GenreProvider(ILibraryManager libraryManager)
    {
        _libraryManager = libraryManager;
    }

    public string Type => SectionTypes.Genre;

    public string DisplayName => "Genre rows";

    public IReadOnlyList<SectionParameter> Parameters { get; } =
        [new SectionParameter("genreCount", "Number of genre rows", SectionParameterKind.Integer, DefaultValue: "3", Min: 1, Max: 6)];

    public IReadOnlyList<string> Validate(SectionDefinition definition) => [];

    public async Task<IReadOnlyList<HomeRow>> GetRowsAsync(HomeContext context, SectionDefinition definition, CancellationToken cancellationToken)
    {
        var candidates = _libraryManager.GetItemList(new InternalItemsQuery(context.User)
        {
            IncludeItemTypes = [BaseItemKind.Movie, BaseItemKind.Series],
            Recursive = true,
            IsPlayed = false,
            IsVirtualItem = false,
            OrderBy = [(ItemSortBy.CommunityRating, SortOrder.Descending)],
            Limit = CandidateLimit,
            DtoOptions = QueryOptions.Full(),
        });
        if (candidates.Count == 0)
        {
            return [];
        }

        var history = await context.GetWatchHistoryAsync();
        var weights = GenreWeighting.Compute(history.Entries, candidates.SelectMany(c => c.Genres ?? []));
        var seed = GenreWeighting.DailySeed(context.User.Id, context.Now);
        var genres = GenreWeighting.Pick(weights, definition.GetIntParam("genreCount", 3), seed);

        var rows = new List<HomeRow>();
        for (var i = 0; i < genres.Count; i++)
        {
            var genre = genres[i];
            var pool = candidates.Where(c => (c.Genres ?? []).Contains(genre, StringComparer.OrdinalIgnoreCase)).Take(PoolPerGenre).ToList();
            var items = GenreWeighting.SeededShuffle(pool, unchecked(seed + i)).Take(context.ItemLimit).ToList();
            if (items.Count > 0)
            {
                rows.Add(new HomeRow(HomeRow.RowId(definition, i), Type, genre, items));
            }
        }

        return rows;
    }
}
```

`src/Jellyfin.Plugin.Lumen/Home/Providers/NewForYouProvider.cs`:
```csharp
using Jellyfin.Data.Enums;
using Jellyfin.Database.Implementations.Enums;
using Jellyfin.Plugin.Lumen.Configuration;
using MediaBrowser.Controller.Entities;
using MediaBrowser.Controller.Entities.TV;
using MediaBrowser.Controller.Library;

namespace Jellyfin.Plugin.Lumen.Home.Providers;

/// <summary>
/// Recently added, unplayed: (a) new episodes of shows the user has been watching (shown as the series) and
/// (b) new movies in the user's top three genres. "Watching" means the show appears in the 90-day watch history.
/// </summary>
public sealed class NewForYouProvider : IHomeSectionProvider
{
    private const int EpisodeScanLimit = 200;
    private readonly ILibraryManager _libraryManager;

    public NewForYouProvider(ILibraryManager libraryManager)
    {
        _libraryManager = libraryManager;
    }

    public string Type => SectionTypes.NewForYou;

    public string DisplayName => "New For You";

    public IReadOnlyList<SectionParameter> Parameters { get; } =
        [new SectionParameter("days", "Look back (days)", SectionParameterKind.Integer, DefaultValue: "14", Min: 1, Max: 90)];

    public IReadOnlyList<string> Validate(SectionDefinition definition) => [];

    public async Task<IReadOnlyList<HomeRow>> GetRowsAsync(HomeContext context, SectionDefinition definition, CancellationToken cancellationToken)
    {
        var since = context.Now.UtcDateTime.AddDays(-definition.GetIntParam("days", 14));
        var history = await context.GetWatchHistoryAsync();
        var candidates = new List<(BaseItem Item, DateTime Added)>();

        var watchedSeries = history.Entries.Where(e => e.SeriesId is not null).Select(e => e.SeriesId!.Value).ToHashSet();
        if (watchedSeries.Count > 0)
        {
            var newest = _libraryManager.GetItemList(new InternalItemsQuery(context.User)
                {
                    IncludeItemTypes = [BaseItemKind.Episode],
                    Recursive = true,
                    IsPlayed = false,
                    IsVirtualItem = false,
                    MinDateCreated = since,
                    OrderBy = [(ItemSortBy.DateCreated, SortOrder.Descending)],
                    Limit = EpisodeScanLimit,
                    DtoOptions = QueryOptions.IdsOnly(),
                })
                .OfType<Episode>()
                .Where(e => watchedSeries.Contains(e.SeriesId))
                .GroupBy(e => e.SeriesId)
                .Select(g => (SeriesId: g.Key, Added: g.Max(e => e.DateCreated)))
                .ToList();

            if (newest.Count > 0)
            {
                var series = _libraryManager.GetItemList(new InternalItemsQuery(context.User)
                    {
                        ItemIds = newest.Select(n => n.SeriesId).ToArray(),
                        DtoOptions = QueryOptions.Full(),
                    })
                    .ToDictionary(s => s.Id);
                candidates.AddRange(newest.Where(n => series.ContainsKey(n.SeriesId)).Select(n => (series[n.SeriesId], n.Added)));
            }
        }

        var topGenres = GenreWeighting.TopGenres(GenreWeighting.Compute(history.Entries, history.Entries.SelectMany(e => e.Genres)), 3);
        if (topGenres.Count > 0)
        {
            var movies = _libraryManager.GetItemList(new InternalItemsQuery(context.User)
            {
                IncludeItemTypes = [BaseItemKind.Movie],
                Recursive = true,
                IsPlayed = false,
                IsVirtualItem = false,
                MinDateCreated = since,
                Genres = topGenres,
                OrderBy = [(ItemSortBy.DateCreated, SortOrder.Descending)],
                Limit = context.ItemLimit,
                DtoOptions = QueryOptions.Full(),
            });
            candidates.AddRange(movies.Select(m => (m, m.DateCreated)));
        }

        return HomeRow.Single(definition, DisplayName, Merge(candidates, context.ItemLimit));
    }

    internal static IReadOnlyList<BaseItem> Merge(IEnumerable<(BaseItem Item, DateTime Added)> candidates, int limit) =>
        candidates.OrderByDescending(c => c.Added).Select(c => c.Item).DistinctBy(i => i.Id).Take(limit).ToList();
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `source scripts/env.sh && dotnet test --nologo --filter "FullyQualifiedName~GenreProvider|FullyQualifiedName~NewForYou"`

Expected: `Passed! - Failed: 0, Passed: 6`.

- [ ] **Step 5: Commit**

```bash
git add src tests
git commit -m "feat: add genre and new-for-you sections" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 15: Because You Watched provider

**Files:**
- Create: `src/Jellyfin.Plugin.Lumen/Home/Providers/BecauseYouWatchedProvider.cs`
- Test: `tests/Jellyfin.Plugin.Lumen.Tests/Home/Providers/BecauseYouWatchedProviderTests.cs`

**Interfaces:**
- Consumes: `ISimilarItemsManager`, `ILibraryManager`, `IUserDataManager` (Jellyfin); `WatchHistory` (Task 10).
- Produces:
  - `BecauseYouWatchedProvider`: type `BecauseYouWatched`, param `maxRows` (1–5, default 2)
  - `internal static IEnumerable<T> Interleave<T>(IReadOnlyList<T> first, IReadOnlyList<T> second)`
  - `internal static string TitleFor(SimilarItemsRecommendation recommendation)`

- [ ] **Step 1: Write the failing tests**

`tests/Jellyfin.Plugin.Lumen.Tests/Home/Providers/BecauseYouWatchedProviderTests.cs`:
```csharp
using Jellyfin.Database.Implementations.Entities;
using Jellyfin.Plugin.Lumen.Configuration;
using Jellyfin.Plugin.Lumen.Home;
using Jellyfin.Plugin.Lumen.Home.Providers;
using MediaBrowser.Controller.Dto;
using MediaBrowser.Controller.Entities;
using MediaBrowser.Controller.Entities.TV;
using MediaBrowser.Controller.Library;
using MediaBrowser.Model.Configuration;
using MediaBrowser.Model.Dto;
using NSubstitute;
using Xunit;

namespace Jellyfin.Plugin.Lumen.Tests.Home.Providers;

public class BecauseYouWatchedProviderTests
{
    private readonly ISimilarItemsManager _similar = Substitute.For<ISimilarItemsManager>();
    private readonly ILibraryManager _library = Substitute.For<ILibraryManager>();
    private readonly IUserDataManager _userData = Substitute.For<IUserDataManager>();
    private readonly User _user = TestData.User();

    public BecauseYouWatchedProviderTests()
    {
        _userData.GetUserDataBatch(Arg.Any<IReadOnlyList<BaseItem>>(), _user).Returns(new Dictionary<Guid, UserItemData>());
        _similar.GetMovieRecommendationsAsync(default, default, default, default, default!, default)
            .ReturnsForAnyArgs(Task.FromResult<IReadOnlyList<SimilarItemsRecommendation>>([]));
    }

    private BecauseYouWatchedProvider Create() => new(_similar, _library, _userData);

    private static SimilarItemsRecommendation Rec(string name, RecommendationType type, params BaseItem[] items) => new()
    {
        BaselineItemName = name,
        CategoryId = Guid.NewGuid(),
        RecommendationType = type,
        Items = items,
    };

    [Theory]
    [InlineData(RecommendationType.SimilarToRecentlyPlayed, "Because you watched Alpha")]
    [InlineData(RecommendationType.SimilarToLikedItem, "Because you watched Alpha")]
    [InlineData(RecommendationType.HasDirectorFromRecentlyPlayed, "Directed by Alpha")]
    [InlineData(RecommendationType.HasLikedActor, "Starring Alpha")]
    public void TitlesFollowRecommendationType(RecommendationType type, string expected)
    {
        Assert.Equal(expected, BecauseYouWatchedProvider.TitleFor(Rec("Alpha", type)));
    }

    [Fact]
    public async Task InterleavesMovieAndSeriesRows_UpToMaxRows_AndDropsPlayed()
    {
        var played = TestData.Movie("played");
        var fresh = TestData.Movie("fresh");
        _similar.GetMovieRecommendationsAsync(default, default, default, default, default!, default).ReturnsForAnyArgs(
            Task.FromResult<IReadOnlyList<SimilarItemsRecommendation>>(
            [
                Rec("M1", RecommendationType.SimilarToRecentlyPlayed, played, fresh),
                Rec("M2", RecommendationType.SimilarToRecentlyPlayed, TestData.Movie("x")),
            ]));
        _userData.GetUserDataBatch(Arg.Any<IReadOnlyList<BaseItem>>(), _user).Returns(new Dictionary<Guid, UserItemData> { [played.Id] = TestData.UserData(played: true) });
        var show = TestData.Series("Show One");
        _library.GetItemById<Series>(show.Id, _user).Returns(show);
        _library.GetLibraryOptions(show).Returns(new LibraryOptions());
        _similar.GetSimilarItemsAsync(show, Arg.Any<IReadOnlyList<Guid>>(), _user, Arg.Any<DtoOptions>(), Arg.Any<int?>(), Arg.Any<LibraryOptions?>(), Arg.Any<CancellationToken>())
            .Returns(Task.FromResult<IReadOnlyList<BaseItem>>([TestData.Series("Similar Show")]));
        var history = new WatchHistory([new WatchedEntry(TestData.Episode(show, 1, 1), show.Id, show.Name, [], TestData.Now.UtcDateTime)]);
        var def = TestData.Section(SectionTypes.BecauseYouWatched, ("maxRows", "3"));

        var rows = await Create().GetRowsAsync(TestData.Context(_user, history), def, CancellationToken.None);

        Assert.Equal(["Because you watched M1", "Because you watched Show One", "Because you watched M2"], rows.Select(r => r.Title));
        Assert.Equal([fresh], rows[0].Items);
        Assert.Equal(3, rows.Select(r => r.Id).Distinct().Count());
    }

    [Fact]
    public async Task SkipsSeedsTheUserCanNoLongerSee()
    {
        var show = TestData.Series("Hidden");
        _library.GetItemById<Series>(show.Id, _user).Returns((Series?)null);
        var history = new WatchHistory([new WatchedEntry(TestData.Episode(show, 1, 1), show.Id, show.Name, [], TestData.Now.UtcDateTime)]);

        var rows = await Create().GetRowsAsync(TestData.Context(_user, history), TestData.Section(SectionTypes.BecauseYouWatched), CancellationToken.None);

        Assert.Empty(rows);
    }

    [Fact]
    public void Interleave_AlternatesAndAppendsRemainder()
    {
        Assert.Equal([1, 10, 2, 3], BecauseYouWatchedProvider.Interleave([1, 2, 3], [10]));
    }
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `source scripts/env.sh && dotnet test --nologo --filter "FullyQualifiedName~BecauseYouWatched"`

Expected: build FAILS with `The type or namespace name 'BecauseYouWatchedProvider' could not be found`.

If instead the compiler says `SimilarItemsRecommendation` is unknown, find its namespace with `grep -rl "class SimilarItemsRecommendation" ~/.nuget/packages/jellyfin.controller/12.1.0` (or by decompiling) and fix the `using`.

- [ ] **Step 3: Implement**

`src/Jellyfin.Plugin.Lumen/Home/Providers/BecauseYouWatchedProvider.cs`:
```csharp
using Jellyfin.Plugin.Lumen.Configuration;
using MediaBrowser.Controller.Entities;
using MediaBrowser.Controller.Entities.TV;
using MediaBrowser.Controller.Library;
using MediaBrowser.Model.Dto;

namespace Jellyfin.Plugin.Lumen.Home.Providers;

/// <summary>
/// Personalized rows. Movies use Jellyfin's built-in recommendations; shows use similar-items for shows in the user's
/// recent history. Movie and show rows alternate, up to maxRows. Played items are removed.
/// </summary>
public sealed class BecauseYouWatchedProvider : IHomeSectionProvider
{
    private readonly ISimilarItemsManager _similarItems;
    private readonly ILibraryManager _libraryManager;
    private readonly IUserDataManager _userDataManager;

    public BecauseYouWatchedProvider(ISimilarItemsManager similarItems, ILibraryManager libraryManager, IUserDataManager userDataManager)
    {
        _similarItems = similarItems;
        _libraryManager = libraryManager;
        _userDataManager = userDataManager;
    }

    public string Type => SectionTypes.BecauseYouWatched;

    public string DisplayName => "Because You Watched";

    public IReadOnlyList<SectionParameter> Parameters { get; } =
        [new SectionParameter("maxRows", "Maximum rows", SectionParameterKind.Integer, DefaultValue: "2", Min: 1, Max: 5)];

    public IReadOnlyList<string> Validate(SectionDefinition definition) => [];

    public async Task<IReadOnlyList<HomeRow>> GetRowsAsync(HomeContext context, SectionDefinition definition, CancellationToken cancellationToken)
    {
        var maxRows = definition.GetIntParam("maxRows", 2);

        var recommendations = await _similarItems.GetMovieRecommendationsAsync(
            context.User, Guid.Empty, maxRows, context.ItemLimit, QueryOptions.Full(), cancellationToken);
        var movieRows = recommendations
            .Select(r => (Title: TitleFor(r), Items: Unplayed(r.Items, context)))
            .Where(r => r.Items.Count > 0)
            .ToList();

        var history = await context.GetWatchHistoryAsync();
        var seriesRows = new List<(string Title, IReadOnlyList<BaseItem> Items)>();
        foreach (var seriesId in history.Entries.Where(e => e.SeriesId is not null).Select(e => e.SeriesId!.Value).Distinct().Take(maxRows))
        {
            var series = _libraryManager.GetItemById<Series>(seriesId, context.User);
            if (series is null)
            {
                continue;
            }

            var similar = await _similarItems.GetSimilarItemsAsync(
                series, [], context.User, QueryOptions.Full(), context.ItemLimit * 2, _libraryManager.GetLibraryOptions(series), cancellationToken);
            var items = Unplayed(similar, context);
            if (items.Count > 0)
            {
                seriesRows.Add(($"Because you watched {series.Name}", items));
            }
        }

        return Interleave(movieRows, seriesRows)
            .Take(maxRows)
            .Select((row, index) => new HomeRow(HomeRow.RowId(definition, index), Type, row.Title, row.Items))
            .ToList();
    }

    internal static string TitleFor(SimilarItemsRecommendation recommendation) => recommendation.RecommendationType switch
    {
        RecommendationType.HasDirectorFromRecentlyPlayed or RecommendationType.HasLikedDirector => $"Directed by {recommendation.BaselineItemName}",
        RecommendationType.HasActorFromRecentlyPlayed or RecommendationType.HasLikedActor => $"Starring {recommendation.BaselineItemName}",
        _ => $"Because you watched {recommendation.BaselineItemName}",
    };

    internal static IEnumerable<T> Interleave<T>(IReadOnlyList<T> first, IReadOnlyList<T> second)
    {
        for (var i = 0; i < Math.Max(first.Count, second.Count); i++)
        {
            if (i < first.Count)
            {
                yield return first[i];
            }

            if (i < second.Count)
            {
                yield return second[i];
            }
        }
    }

    private List<BaseItem> Unplayed(IReadOnlyList<BaseItem> items, HomeContext context)
    {
        if (items.Count == 0)
        {
            return [];
        }

        var userData = _userDataManager.GetUserDataBatch(items, context.User);
        return items.Where(i => !(userData.TryGetValue(i.Id, out var data) && data.Played)).Take(context.ItemLimit).ToList();
    }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `source scripts/env.sh && dotnet test --nologo --filter "FullyQualifiedName~BecauseYouWatched"`

Expected: `Passed! - Failed: 0, Passed: 7`.

- [ ] **Step 5: Commit**

```bash
git add src tests
git commit -m "feat: add because-you-watched personalized rows" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 16: Curated provider and linked-items reader

**Files:**
- Create: `src/Jellyfin.Plugin.Lumen/Home/LinkedItemsReader.cs`, `src/Jellyfin.Plugin.Lumen/Home/Providers/CuratedProvider.cs`
- Test: `tests/Jellyfin.Plugin.Lumen.Tests/Home/Providers/CuratedProviderTests.cs`

**Interfaces:**
- Produces:
  - `sealed record CuratedSource(string Name, IReadOnlyList<BaseItem> Items)`
  - `interface ILinkedItemsReader { CuratedSource? GetCollection(Guid id, User user); CuratedSource? GetPlaylist(Guid id, User user); }` and `LinkedItemsReader : ILinkedItemsReader`. It is a thin adapter over Jellyfin's static-locator-based `BoxSet.GetChildren` / `Playlist.GetManageableItems`, so it is verified by E2E (Task 28) rather than unit tests.
  - `CuratedProvider`: type `Curated`, params `collectionId` (Collection), `playlistId` (Playlist), `tag` (Text); exactly one is required.

- [ ] **Step 1: Write the failing tests**

`tests/Jellyfin.Plugin.Lumen.Tests/Home/Providers/CuratedProviderTests.cs`:
```csharp
using Jellyfin.Data.Enums;
using Jellyfin.Database.Implementations.Entities;
using Jellyfin.Database.Implementations.Enums;
using Jellyfin.Plugin.Lumen.Configuration;
using Jellyfin.Plugin.Lumen.Home;
using Jellyfin.Plugin.Lumen.Home.Providers;
using MediaBrowser.Controller.Entities;
using MediaBrowser.Controller.Library;
using NSubstitute;
using Xunit;

namespace Jellyfin.Plugin.Lumen.Tests.Home.Providers;

public class CuratedProviderTests
{
    private readonly ILibraryManager _library = Substitute.For<ILibraryManager>();
    private readonly ILinkedItemsReader _reader = Substitute.For<ILinkedItemsReader>();
    private readonly User _user = TestData.User();

    private CuratedProvider Create() => new(_library, _reader);

    [Theory]
    [InlineData(false, false, false, true)]
    [InlineData(true, true, false, true)]
    [InlineData(true, false, false, false)]
    [InlineData(false, false, true, false)]
    public void RequiresExactlyOneSource(bool collection, bool playlist, bool tag, bool expectError)
    {
        var ps = new List<(string, string)>();
        if (collection)
        {
            ps.Add(("collectionId", Guid.NewGuid().ToString()));
        }

        if (playlist)
        {
            ps.Add(("playlistId", Guid.NewGuid().ToString()));
        }

        if (tag)
        {
            ps.Add(("tag", "holiday"));
        }

        var errors = Create().Validate(TestData.Section(SectionTypes.Curated, ps.ToArray()));

        Assert.Equal(expectError, errors.Count > 0);
    }

    [Fact]
    public async Task Collection_UsesReader_AndCollectionNameAsDefaultTitle()
    {
        var id = Guid.NewGuid();
        var movie = TestData.Movie("m");
        _reader.GetCollection(id, _user).Returns(new CuratedSource("Holiday Movies", [movie]));

        var rows = await Create().GetRowsAsync(TestData.Context(_user), TestData.Section(SectionTypes.Curated, ("collectionId", id.ToString())), CancellationToken.None);

        var row = Assert.Single(rows);
        Assert.Equal("Holiday Movies", row.Title);
        Assert.Equal([movie], row.Items);
    }

    [Fact]
    public async Task MissingOrHiddenCollection_NoRows()
    {
        _reader.GetCollection(Arg.Any<Guid>(), _user).Returns((CuratedSource?)null);

        var rows = await Create().GetRowsAsync(TestData.Context(_user), TestData.Section(SectionTypes.Curated, ("collectionId", Guid.NewGuid().ToString())), CancellationToken.None);

        Assert.Empty(rows);
    }

    [Fact]
    public async Task Tag_QueriesByTag_SortedByName()
    {
        InternalItemsQuery? q = null;
        _library.GetItemList(Arg.Do<InternalItemsQuery>(x => q = x)).Returns(new BaseItem[] { TestData.Movie("t") });

        var rows = await Create().GetRowsAsync(TestData.Context(_user), TestData.Section(SectionTypes.Curated, ("tag", "holiday")), CancellationToken.None);

        Assert.Equal("holiday", Assert.Single(rows).Title);
        Assert.Equal(["holiday"], q!.Tags);
        Assert.Same(_user, q.User);
        Assert.Equal([BaseItemKind.Movie, BaseItemKind.Series], q.IncludeItemTypes);
        Assert.Equal((ItemSortBy.SortName, SortOrder.Ascending), Assert.Single(q.OrderBy));
    }

    [Fact]
    public async Task LimitsItems()
    {
        var id = Guid.NewGuid();
        _reader.GetPlaylist(id, _user).Returns(new CuratedSource("P", Enumerable.Range(0, 50).Select(i => (BaseItem)TestData.Movie($"m{i}")).ToList()));

        var rows = await Create().GetRowsAsync(TestData.Context(_user), TestData.Section(SectionTypes.Curated, ("playlistId", id.ToString())), CancellationToken.None);

        Assert.Equal(20, Assert.Single(rows).Items.Count);
    }
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `source scripts/env.sh && dotnet test --nologo --filter "FullyQualifiedName~CuratedProvider"`

Expected: build FAILS with `The type or namespace name 'ILinkedItemsReader' could not be found`.

- [ ] **Step 3: Implement**

`src/Jellyfin.Plugin.Lumen/Home/LinkedItemsReader.cs`:
```csharp
using Jellyfin.Database.Implementations.Entities;
using MediaBrowser.Controller.Entities;
using MediaBrowser.Controller.Entities.Movies;
using MediaBrowser.Controller.Library;
using MediaBrowser.Controller.Playlists;

namespace Jellyfin.Plugin.Lumen.Home;

/// <summary>A named, ordered list of items (a collection or playlist).</summary>
public sealed record CuratedSource(string Name, IReadOnlyList<BaseItem> Items);

/// <summary>Reads collection and playlist contents visible to a user.</summary>
public interface ILinkedItemsReader
{
    CuratedSource? GetCollection(Guid id, User user);

    CuratedSource? GetPlaylist(Guid id, User user);
}

/// <summary>
/// Thin adapter over Jellyfin entities whose methods use static service locators (not unit-testable); covered by E2E.
/// Null means the source does not exist or the user cannot see it.
/// </summary>
public sealed class LinkedItemsReader : ILinkedItemsReader
{
    private readonly ILibraryManager _libraryManager;

    public LinkedItemsReader(ILibraryManager libraryManager)
    {
        _libraryManager = libraryManager;
    }

    public CuratedSource? GetCollection(Guid id, User user)
    {
        var collection = _libraryManager.GetItemById<BoxSet>(id, user);
        return collection is null ? null : new CuratedSource(collection.Name, collection.GetChildren(user, true).ToList());
    }

    public CuratedSource? GetPlaylist(Guid id, User user)
    {
        var playlist = _libraryManager.GetItemById<Playlist>(id, user);
        if (playlist is null)
        {
            return null;
        }

        var items = playlist.GetManageableItems()
            .Select(t => t.Item2)
            .Where(i => i is not null && i.IsVisible(user))
            .DistinctBy(i => i.Id)
            .ToList();
        return new CuratedSource(playlist.Name, items);
    }
}
```

`src/Jellyfin.Plugin.Lumen/Home/Providers/CuratedProvider.cs`:
```csharp
using Jellyfin.Data.Enums;
using Jellyfin.Database.Implementations.Enums;
using Jellyfin.Plugin.Lumen.Configuration;
using MediaBrowser.Controller.Entities;
using MediaBrowser.Controller.Library;

namespace Jellyfin.Plugin.Lumen.Home.Providers;

/// <summary>An admin-chosen collection, playlist, or tag, in source order (tag: by name).</summary>
public sealed class CuratedProvider : IHomeSectionProvider
{
    private readonly ILibraryManager _libraryManager;
    private readonly ILinkedItemsReader _reader;

    public CuratedProvider(ILibraryManager libraryManager, ILinkedItemsReader reader)
    {
        _libraryManager = libraryManager;
        _reader = reader;
    }

    public string Type => SectionTypes.Curated;

    public string DisplayName => "Curated row";

    public IReadOnlyList<SectionParameter> Parameters { get; } =
    [
        new SectionParameter("collectionId", "Collection", SectionParameterKind.Collection),
        new SectionParameter("playlistId", "Playlist", SectionParameterKind.Playlist),
        new SectionParameter("tag", "Tag", SectionParameterKind.Text),
    ];

    public IReadOnlyList<string> Validate(SectionDefinition definition)
    {
        var sources = new[] { "collectionId", "playlistId", "tag" }.Count(p => definition.GetParam(p) is not null);
        return sources == 1 ? [] : ["Choose exactly one source: a collection, a playlist, or a tag."];
    }

    public Task<IReadOnlyList<HomeRow>> GetRowsAsync(HomeContext context, SectionDefinition definition, CancellationToken cancellationToken)
    {
        CuratedSource? source = null;
        if (definition.GetGuidParam("collectionId") is { } collectionId)
        {
            source = _reader.GetCollection(collectionId, context.User);
        }
        else if (definition.GetGuidParam("playlistId") is { } playlistId)
        {
            source = _reader.GetPlaylist(playlistId, context.User);
        }
        else if (definition.GetParam("tag") is { } tag)
        {
            source = new CuratedSource(tag, _libraryManager.GetItemList(new InternalItemsQuery(context.User)
            {
                Tags = [tag],
                IncludeItemTypes = [BaseItemKind.Movie, BaseItemKind.Series],
                Recursive = true,
                IsVirtualItem = false,
                OrderBy = [(ItemSortBy.SortName, SortOrder.Ascending)],
                Limit = context.ItemLimit,
                DtoOptions = QueryOptions.Full(),
            }));
        }

        return Task.FromResult(source is null
            ? (IReadOnlyList<HomeRow>)[]
            : HomeRow.Single(definition, source.Name, source.Items.Take(context.ItemLimit).ToList()));
    }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `source scripts/env.sh && dotnet test --nologo --filter "FullyQualifiedName~CuratedProvider"`

Expected: `Passed! - Failed: 0, Passed: 8`.

- [ ] **Step 5: Commit**

```bash
git add src tests
git commit -m "feat: add curated collection, playlist, and tag rows" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 17: Hero service and trailer lookup

**Files:**
- Create: `src/Jellyfin.Plugin.Lumen/Home/HeroService.cs`, `src/Jellyfin.Plugin.Lumen/Home/TrailerLookup.cs`
- Test: `tests/Jellyfin.Plugin.Lumen.Tests/Home/HeroServiceTests.cs`

**Interfaces:**
- Consumes: `IHeroService`, `HeroItem` (Task 12); `ILinkedItemsReader` (Task 16); `HeroSource` and the hero settings (Task 3).
- Produces:
  - `interface ITrailerLookup { Guid? GetLocalTrailerId(BaseItem item, User user); }` and `TrailerLookup` (thin adapter; E2E-verified)
  - `HeroService : IHeroService`
  - `internal static IReadOnlyList<BaseItem> HeroService.Rank(IEnumerable<BaseItem> candidates, int count)`

- [ ] **Step 1: Write the failing tests**

`tests/Jellyfin.Plugin.Lumen.Tests/Home/HeroServiceTests.cs`:
```csharp
using Jellyfin.Data.Enums;
using Jellyfin.Database.Implementations.Entities;
using Jellyfin.Database.Implementations.Enums;
using Jellyfin.Plugin.Lumen.Configuration;
using Jellyfin.Plugin.Lumen.Home;
using MediaBrowser.Controller.Entities;
using MediaBrowser.Controller.Library;
using MediaBrowser.Model.Entities;
using NSubstitute;
using Xunit;

namespace Jellyfin.Plugin.Lumen.Tests.Home;

public class HeroServiceTests
{
    private readonly ILibraryManager _library = Substitute.For<ILibraryManager>();
    private readonly ILinkedItemsReader _reader = Substitute.For<ILinkedItemsReader>();
    private readonly ITrailerLookup _trailers = Substitute.For<ITrailerLookup>();
    private readonly User _user = TestData.User();
    private InternalItemsQuery? _query;

    public HeroServiceTests()
    {
        _library.GetItemList(Arg.Do<InternalItemsQuery>(q => _query = q)).Returns(Array.Empty<BaseItem>());
    }

    private HeroService Create() => new(_library, _reader, _trailers);

    [Fact]
    public void Rank_ExcludesItemsWithoutBackdrop()
    {
        var noArt = TestData.Movie("none");
        var posterOnly = TestData.Movie("poster").WithImages(ImageType.Primary);
        var backdrop = TestData.Movie("backdrop").WithImages(ImageType.Backdrop);

        Assert.Equal([backdrop], HeroService.Rank([noArt, posterOnly, backdrop], 5));
    }

    [Fact]
    public void Rank_PrefersLogos_KeepingRelativeOrder_AndLimits()
    {
        var a = TestData.Movie("a").WithImages(ImageType.Backdrop);
        var b = TestData.Movie("b").WithImages(ImageType.Backdrop, ImageType.Logo);
        var c = TestData.Movie("c").WithImages(ImageType.Backdrop);
        var d = TestData.Movie("d").WithImages(ImageType.Backdrop, ImageType.Logo);

        Assert.Equal([b, d, a], HeroService.Rank([a, b, c, d], 3));
    }

    [Fact]
    public async Task RecentlyAdded_QueriesNewestWithBackdrops_AndAttachesTrailers()
    {
        var movie = TestData.Movie("m").WithImages(ImageType.Backdrop);
        var trailerId = Guid.NewGuid();
        _library.GetItemList(Arg.Do<InternalItemsQuery>(q => _query = q)).Returns(new BaseItem[] { movie });
        _trailers.GetLocalTrailerId(movie, _user).Returns(trailerId);

        var hero = await Create().GetHeroAsync(TestData.Context(_user), new PluginConfiguration { HeroCount = 5 }, CancellationToken.None);

        Assert.Equal(new HeroItem(movie, trailerId), Assert.Single(hero));
        Assert.Equal((ItemSortBy.DateCreated, SortOrder.Descending), Assert.Single(_query!.OrderBy));
        Assert.Equal([ImageType.Backdrop], _query.ImageTypes);
        Assert.Equal([BaseItemKind.Movie, BaseItemKind.Series], _query.IncludeItemTypes);
        Assert.Equal(20, _query.Limit);
    }

    [Fact]
    public async Task TopRatedUnplayed_FiltersPlayed_AndSortsByRating()
    {
        await Create().GetHeroAsync(TestData.Context(_user), new PluginConfiguration { HeroSource = HeroSource.TopRatedUnplayed }, CancellationToken.None);

        Assert.False(_query!.IsPlayed);
        Assert.Equal((ItemSortBy.CommunityRating, SortOrder.Descending), Assert.Single(_query.OrderBy));
    }

    [Fact]
    public async Task Collection_UsesReader_AndEmptyWithoutId()
    {
        var id = Guid.NewGuid();
        var movie = TestData.Movie("c").WithImages(ImageType.Backdrop);
        _reader.GetCollection(id, _user).Returns(new CuratedSource("Featured", [movie]));

        var withId = await Create().GetHeroAsync(TestData.Context(_user), new PluginConfiguration { HeroSource = HeroSource.Collection, HeroCollectionId = id }, CancellationToken.None);
        var withoutId = await Create().GetHeroAsync(TestData.Context(_user), new PluginConfiguration { HeroSource = HeroSource.Collection }, CancellationToken.None);

        Assert.Equal(movie, Assert.Single(withId).Item);
        Assert.Empty(withoutId);
        Assert.Null(_query);
    }
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `source scripts/env.sh && dotnet test --nologo --filter "FullyQualifiedName~HeroService"`

Expected: build FAILS with `The type or namespace name 'HeroService' could not be found`.

- [ ] **Step 3: Implement**

`src/Jellyfin.Plugin.Lumen/Home/TrailerLookup.cs`:
```csharp
using Jellyfin.Database.Implementations.Entities;
using MediaBrowser.Controller.Entities;
using MediaBrowser.Model.Entities;

namespace Jellyfin.Plugin.Lumen.Home;

/// <summary>Finds an item's first local trailer.</summary>
public interface ITrailerLookup
{
    Guid? GetLocalTrailerId(BaseItem item, User user);
}

/// <summary>Thin adapter over <see cref="BaseItem.GetExtras(IReadOnlyCollection{ExtraType}, User)"/> (static locator; E2E-verified).</summary>
public sealed class TrailerLookup : ITrailerLookup
{
    public Guid? GetLocalTrailerId(BaseItem item, User user) => item.GetExtras([ExtraType.Trailer], user).FirstOrDefault()?.Id;
}
```

`src/Jellyfin.Plugin.Lumen/Home/HeroService.cs`:
```csharp
using Jellyfin.Data.Enums;
using Jellyfin.Database.Implementations.Enums;
using Jellyfin.Plugin.Lumen.Configuration;
using MediaBrowser.Controller.Entities;
using MediaBrowser.Controller.Library;
using MediaBrowser.Model.Entities;

namespace Jellyfin.Plugin.Lumen.Home;

/// <summary>Picks hero items from the configured source; items need a backdrop, and those with a logo come first.</summary>
public sealed class HeroService : IHeroService
{
    private const int CandidateMultiplier = 4;
    private readonly ILibraryManager _libraryManager;
    private readonly ILinkedItemsReader _reader;
    private readonly ITrailerLookup _trailers;

    public HeroService(ILibraryManager libraryManager, ILinkedItemsReader reader, ITrailerLookup trailers)
    {
        _libraryManager = libraryManager;
        _reader = reader;
        _trailers = trailers;
    }

    public Task<IReadOnlyList<HeroItem>> GetHeroAsync(HomeContext context, PluginConfiguration config, CancellationToken cancellationToken)
    {
        IReadOnlyList<BaseItem> candidates = config.HeroSource switch
        {
            HeroSource.Collection => config.HeroCollectionId is { } id ? _reader.GetCollection(id, context.User)?.Items ?? [] : [],
            HeroSource.TopRatedUnplayed => Query(context, config, isPlayed: false, (ItemSortBy.CommunityRating, SortOrder.Descending)),
            _ => Query(context, config, isPlayed: null, (ItemSortBy.DateCreated, SortOrder.Descending)),
        };

        IReadOnlyList<HeroItem> hero = Rank(candidates, config.HeroCount)
            .Select(item => new HeroItem(item, _trailers.GetLocalTrailerId(item, context.User)))
            .ToList();
        return Task.FromResult(hero);
    }

    internal static IReadOnlyList<BaseItem> Rank(IEnumerable<BaseItem> candidates, int count)
    {
        var withBackdrop = candidates.Where(i => i.HasImage(ImageType.Backdrop, 0)).ToList();
        return withBackdrop.Where(i => i.HasImage(ImageType.Logo, 0))
            .Concat(withBackdrop.Where(i => !i.HasImage(ImageType.Logo, 0)))
            .Take(count)
            .ToList();
    }

    private IReadOnlyList<BaseItem> Query(HomeContext context, PluginConfiguration config, bool? isPlayed, (ItemSortBy, SortOrder) order) =>
        _libraryManager.GetItemList(new InternalItemsQuery(context.User)
        {
            IncludeItemTypes = [BaseItemKind.Movie, BaseItemKind.Series],
            Recursive = true,
            IsVirtualItem = false,
            IsPlayed = isPlayed,
            ImageTypes = [ImageType.Backdrop],
            OrderBy = [order],
            Limit = config.HeroCount * CandidateMultiplier,
            DtoOptions = QueryOptions.Full(),
        });
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `source scripts/env.sh && dotnet test --nologo --filter "FullyQualifiedName~HeroService"`

Expected: `Passed! - Failed: 0, Passed: 5`.

- [ ] **Step 5: Commit**

```bash
git add src tests
git commit -m "feat: add hero selection with backdrop/logo ranking and local trailers" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 18: Home and admin endpoints, full DI wiring, fixture media

**Files:**
- Create:
  - `src/Jellyfin.Plugin.Lumen/Api/HomeController.cs`
  - `src/Jellyfin.Plugin.Lumen/Api/AdminController.cs`
  - `scripts/gen-test-media.sh`
- Modify: `src/Jellyfin.Plugin.Lumen/Api/Dtos.cs` (admin DTOs), `src/Jellyfin.Plugin.Lumen/ServiceRegistrator.cs`
- Test:
  - `tests/Jellyfin.Plugin.Lumen.Tests/Api/HomeControllerTests.cs`
  - `tests/Jellyfin.Plugin.Lumen.Tests/Api/AdminControllerTests.cs`
  - `tests/Jellyfin.Plugin.Lumen.Tests/ServiceRegistratorTests.cs`

**Interfaces:**
- Consumes: everything from Tasks 3–17.
- Produces:
  - `GET /Lumen/Home` returns `HomeResponseDto`
  - `GET /Lumen/Admin/Config`, `POST /Lumen/Admin/Config` (204, or 400 with `{ Errors }`), `POST /Lumen/Admin/Config/Reset`, `GET /Lumen/Admin/SectionTypes`, `GET /Lumen/Admin/Diagnostics`
  - DTOs: `ValidationErrorsDto(IReadOnlyList<string> Errors)`, `SectionTypeDto(string Type, string DisplayName, IReadOnlyList<SectionParameterDto> Parameters)`, `SectionParameterDto(string Name, string Label, string Kind, bool Required, string? DefaultValue, int? Min, int? Max)`
  - `./scripts/gen-test-media.sh [outDir]` writes fixture media (default `e2e/fixtures/media`)

- [ ] **Step 1: Write the failing tests**

`tests/Jellyfin.Plugin.Lumen.Tests/Api/HomeControllerTests.cs`:
```csharp
using System.Security.Claims;
using Jellyfin.Database.Implementations.Entities;
using Jellyfin.Plugin.Lumen.Api;
using Jellyfin.Plugin.Lumen.Home;
using MediaBrowser.Controller.Library;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using NSubstitute;
using Xunit;

namespace Jellyfin.Plugin.Lumen.Tests.Api;

public class HomeControllerTests
{
    private readonly IHomeService _home = Substitute.For<IHomeService>();
    private readonly IUserManager _users = Substitute.For<IUserManager>();

    private HomeController Create(params Claim[] claims) => new(_home, _users)
    {
        ControllerContext = new ControllerContext
        {
            HttpContext = new DefaultHttpContext { User = new ClaimsPrincipal(new ClaimsIdentity(claims, "test")) },
        },
    };

    [Fact]
    public async Task UnknownUser_IsUnauthorized()
    {
        var result = await Create().GetHome(CancellationToken.None);

        Assert.IsType<UnauthorizedResult>(result.Result);
    }

    [Fact]
    public async Task ReturnsHomeForClaimedUser()
    {
        var user = TestData.User();
        var response = new HomeResponseDto(3, [], []);
        _users.GetUserById(user.Id).Returns(user);
        _home.GetHomeAsync(user, Arg.Any<CancellationToken>()).Returns(response);

        var result = await Create(new Claim("Jellyfin-UserId", user.Id.ToString("N"))).GetHome(CancellationToken.None);

        Assert.Same(response, result.Value);
    }
}
```

`tests/Jellyfin.Plugin.Lumen.Tests/Api/AdminControllerTests.cs`:
```csharp
using Jellyfin.Plugin.Lumen.Api;
using Jellyfin.Plugin.Lumen.Configuration;
using Jellyfin.Plugin.Lumen.Diagnostics;
using Jellyfin.Plugin.Lumen.Home;
using Microsoft.AspNetCore.Mvc;
using NSubstitute;
using Xunit;

namespace Jellyfin.Plugin.Lumen.Tests.Api;

public class AdminControllerTests
{
    private readonly ILumenConfigStore _store = Substitute.For<ILumenConfigStore>();

    private AdminController Create() => new(
        _store,
        [new FakeSectionProvider("Zeta"), new FakeSectionProvider("Alpha", new SectionParameter("n", "N", SectionParameterKind.Integer, Min: 1, Max: 3))],
        new DiagnosticsStore());

    [Fact]
    public void Save_Valid_Returns204()
    {
        _store.Save(Arg.Any<PluginConfiguration>()).Returns(new ConfigSaveResult(true, []));

        Assert.IsType<NoContentResult>(Create().SaveConfig(new PluginConfiguration()));
    }

    [Fact]
    public void Save_Invalid_Returns400WithErrors()
    {
        _store.Save(Arg.Any<PluginConfiguration>()).Returns(new ConfigSaveResult(false, ["bad"]));

        var result = Assert.IsType<BadRequestObjectResult>(Create().SaveConfig(new PluginConfiguration()));

        Assert.Equal(["bad"], Assert.IsType<ValidationErrorsDto>(result.Value).Errors);
    }

    [Fact]
    public void Reset_DelegatesToStore()
    {
        Assert.IsType<NoContentResult>(Create().Reset());
        _store.Received(1).ResetToDefaults();
    }

    [Fact]
    public void SectionTypes_AreSortedByName_WithStringKinds()
    {
        var types = Assert.IsAssignableFrom<IReadOnlyList<SectionTypeDto>>(Assert.IsType<OkObjectResult>(Create().GetSectionTypes().Result).Value);

        Assert.Equal(["Alpha (fake)", "Zeta (fake)"], types.Select(t => t.DisplayName));
        var parameter = Assert.Single(types[0].Parameters);
        Assert.Equal("Integer", parameter.Kind);
        Assert.Equal(3, parameter.Max);
    }
}
```

`tests/Jellyfin.Plugin.Lumen.Tests/ServiceRegistratorTests.cs`:
```csharp
using Jellyfin.Plugin.Lumen.Assets;
using Jellyfin.Plugin.Lumen.Configuration;
using Jellyfin.Plugin.Lumen.Home;
using Jellyfin.Plugin.Lumen.Injection;
using MediaBrowser.Controller;
using MediaBrowser.Controller.Dto;
using MediaBrowser.Controller.Library;
using MediaBrowser.Controller.TV;
using Microsoft.AspNetCore.Hosting;
using Microsoft.Extensions.DependencyInjection;
using NSubstitute;
using Xunit;

namespace Jellyfin.Plugin.Lumen.Tests;

public class ServiceRegistratorTests
{
    [Fact]
    public void RegistersACompleteValidGraph()
    {
        var services = new ServiceCollection();
        services.AddLogging();
        services.AddSingleton(Substitute.For<ILibraryManager>());
        services.AddSingleton(Substitute.For<IUserDataManager>());
        services.AddSingleton(Substitute.For<IUserManager>());
        services.AddSingleton(Substitute.For<ITVSeriesManager>());
        services.AddSingleton(Substitute.For<ISimilarItemsManager>());
        services.AddSingleton(Substitute.For<IDtoService>());

        new ServiceRegistrator().RegisterServices(services, Substitute.For<IServerApplicationHost>());
        using var provider = services.BuildServiceProvider(new ServiceProviderOptions { ValidateOnBuild = true, ValidateScopes = true });

        Assert.NotNull(provider.GetRequiredService<IHomeService>());
        Assert.NotNull(provider.GetRequiredService<ILumenConfigStore>());
        Assert.NotNull(provider.GetRequiredService<AssetCatalog>());
        Assert.Contains(provider.GetServices<IStartupFilter>(), f => f is LumenStartupFilter);
        Assert.Equal(
            [SectionTypes.BecauseYouWatched, SectionTypes.ContinueWatching, SectionTypes.Curated, SectionTypes.Genre, SectionTypes.NewForYou, SectionTypes.NextUp, SectionTypes.RecentlyAdded],
            provider.GetServices<IHomeSectionProvider>().Select(p => p.Type).Order());
    }
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `source scripts/env.sh && dotnet test --nologo --filter "FullyQualifiedName~HomeController|FullyQualifiedName~AdminController|FullyQualifiedName~ServiceRegistrator"`

Expected: build FAILS with `The type or namespace name 'HomeController' could not be found`.

- [ ] **Step 3: Implement the controllers, DTOs, and wiring**

Append to `src/Jellyfin.Plugin.Lumen/Api/Dtos.cs` (and add `using Jellyfin.Plugin.Lumen.Home;` at the top):
```csharp
/// <summary>400 body for an invalid configuration.</summary>
public sealed record ValidationErrorsDto(IReadOnlyList<string> Errors);

/// <summary>A section parameter for the admin form.</summary>
public sealed record SectionParameterDto(string Name, string Label, string Kind, bool Required, string? DefaultValue, int? Min, int? Max)
{
    public static SectionParameterDto From(SectionParameter p) => new(p.Name, p.Label, p.Kind.ToString(), p.Required, p.DefaultValue, p.Min, p.Max);
}

/// <summary>A section type for the admin form.</summary>
public sealed record SectionTypeDto(string Type, string DisplayName, IReadOnlyList<SectionParameterDto> Parameters)
{
    public static SectionTypeDto From(IHomeSectionProvider provider) =>
        new(provider.Type, provider.DisplayName, provider.Parameters.Select(SectionParameterDto.From).ToList());
}
```

`src/Jellyfin.Plugin.Lumen/Api/HomeController.cs`:
```csharp
using Jellyfin.Plugin.Lumen.Home;
using MediaBrowser.Controller.Library;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Jellyfin.Plugin.Lumen.Api;

/// <summary>The home screen endpoint.</summary>
[ApiController]
[Route("Lumen")]
[Authorize]
public sealed class HomeController : ControllerBase
{
    private readonly IHomeService _home;
    private readonly IUserManager _users;

    public HomeController(IHomeService home, IUserManager users)
    {
        _home = home;
        _users = users;
    }

    [HttpGet("Home")]
    public async Task<ActionResult<HomeResponseDto>> GetHome(CancellationToken cancellationToken)
    {
        var user = User.GetJellyfinUserId() is { } id ? _users.GetUserById(id) : null;
        if (user is null)
        {
            return Unauthorized();
        }

        return await _home.GetHomeAsync(user, cancellationToken);
    }
}
```

`src/Jellyfin.Plugin.Lumen/Api/AdminController.cs`:
```csharp
using Jellyfin.Plugin.Lumen.Configuration;
using Jellyfin.Plugin.Lumen.Diagnostics;
using Jellyfin.Plugin.Lumen.Home;
using MediaBrowser.Common.Api;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Jellyfin.Plugin.Lumen.Api;

/// <summary>Admin-only endpoints used by the Lumen dashboard page.</summary>
[ApiController]
[Route("Lumen/Admin")]
[Authorize(Policy = Policies.RequiresElevation)]
public sealed class AdminController : ControllerBase
{
    private readonly ILumenConfigStore _store;
    private readonly IEnumerable<IHomeSectionProvider> _providers;
    private readonly DiagnosticsStore _diagnostics;

    public AdminController(ILumenConfigStore store, IEnumerable<IHomeSectionProvider> providers, DiagnosticsStore diagnostics)
    {
        _store = store;
        _providers = providers;
        _diagnostics = diagnostics;
    }

    [HttpGet("Config")]
    public ActionResult<PluginConfiguration> GetConfig() => _store.Current;

    [HttpPost("Config")]
    public IActionResult SaveConfig([FromBody] PluginConfiguration config)
    {
        var result = _store.Save(config);
        return result.Success ? NoContent() : BadRequest(new ValidationErrorsDto(result.Errors));
    }

    [HttpPost("Config/Reset")]
    public IActionResult Reset()
    {
        _store.ResetToDefaults();
        return NoContent();
    }

    [HttpGet("SectionTypes")]
    public ActionResult<IReadOnlyList<SectionTypeDto>> GetSectionTypes() =>
        Ok(_providers.Select(SectionTypeDto.From).OrderBy(t => t.DisplayName, StringComparer.OrdinalIgnoreCase).ToList());

    [HttpGet("Diagnostics")]
    public ActionResult<IReadOnlyList<DiagnosticEntry>> GetDiagnostics() => Ok(_diagnostics.GetAll());
}
```

Replace `ServiceRegistrator.RegisterServices` with the complete registration:
```csharp
    public void RegisterServices(IServiceCollection serviceCollection, IServerApplicationHost applicationHost)
    {
        serviceCollection.AddSingleton(AssetCatalog.FromEmbeddedResources(typeof(LumenPlugin).Assembly));
        serviceCollection.AddTransient<IStartupFilter, LumenStartupFilter>();
        serviceCollection.TryAddSingleton(TimeProvider.System);

        serviceCollection.AddSingleton<IPluginConfigPersistence, LumenPluginPersistence>();
        serviceCollection.AddSingleton<ILibraryCatalog, LibraryCatalog>();
        serviceCollection.AddSingleton<ConfigValidator>();
        serviceCollection.AddSingleton<ILumenConfigStore, LumenConfigStore>();
        serviceCollection.AddSingleton<DiagnosticsStore>();

        serviceCollection.AddSingleton<HomeCache>();
        serviceCollection.AddSingleton<IWatchHistoryService, WatchHistoryService>();
        serviceCollection.AddSingleton<ILinkedItemsReader, LinkedItemsReader>();
        serviceCollection.AddSingleton<ITrailerLookup, TrailerLookup>();
        serviceCollection.AddSingleton<IHeroService, HeroService>();
        serviceCollection.AddSingleton<IHomeDtoMapper, HomeDtoMapper>();
        serviceCollection.AddSingleton<IHomeService, HomeService>();

        serviceCollection.AddSingleton<IHomeSectionProvider, ContinueWatchingProvider>();
        serviceCollection.AddSingleton<IHomeSectionProvider, NextUpProvider>();
        serviceCollection.AddSingleton<IHomeSectionProvider, RecentlyAddedProvider>();
        serviceCollection.AddSingleton<IHomeSectionProvider, BecauseYouWatchedProvider>();
        serviceCollection.AddSingleton<IHomeSectionProvider, GenreProvider>();
        serviceCollection.AddSingleton<IHomeSectionProvider, NewForYouProvider>();
        serviceCollection.AddSingleton<IHomeSectionProvider, CuratedProvider>();
    }
```
Add `using Jellyfin.Plugin.Lumen.Home;` and `using Jellyfin.Plugin.Lumen.Home.Providers;` to the file.

- [ ] **Step 4: Run all tests**

Run: `source scripts/env.sh && dotnet test --nologo`

Expected: every test passes, including the 7 new ones.

- [ ] **Step 5: Add the fixture media generator**

`scripts/gen-test-media.sh`:
```bash
#!/usr/bin/env bash
# Deterministic fixture media for dev and E2E:
# - VP9/Opus WebM (Chromium can direct-play it; Playwright's Chromium has no H.264)
# - NFO metadata (no internet lookups needed), poster/backdrop/logo images, and a local trailer.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
source "$ROOT/scripts/env.sh"
if [[ -z "${FFMPEG:-}" ]]; then
  if [[ -x "$LUMEN_DEV_HOME/ffmpeg/ffmpeg" ]]; then FFMPEG="$LUMEN_DEV_HOME/ffmpeg/ffmpeg"; else FFMPEG="$(command -v ffmpeg)"; fi
fi
OUT="${1:-$ROOT/e2e/fixtures/media}"
rm -rf "$OUT"
mkdir -p "$OUT/movies" "$OUT/tv"

video() { # path seconds hue
  "$FFMPEG" -loglevel error -y -f lavfi -i "testsrc2=size=640x360:rate=24,hue=h=$3" -f lavfi -i "sine=frequency=440" \
    -t "$2" -c:v libvpx-vp9 -deadline realtime -cpu-used 8 -b:v 300k -c:a libopus -b:a 48k -shortest "$1"
}
image() { # path size color
  "$FFMPEG" -loglevel error -y -f lavfi -i "color=c=$3:s=$2" -frames:v 1 "$1"
}
movie() { # title year genres(comma) rating hue color with_logo(1|0)
  local dir="$OUT/movies/$1 ($2)"
  mkdir -p "$dir"
  video "$dir/$1 ($2).webm" 20 "$5"
  video "$dir/$1 ($2)-trailer.webm" 8 "$5"
  image "$dir/poster.jpg" 400x600 "$6"
  image "$dir/backdrop.jpg" 1280x720 "$6"
  if [[ "$7" == 1 ]]; then image "$dir/logo.png" 800x200 white; fi
  {
    echo '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    echo "<movie><title>$1</title><year>$2</year><rating>$4</rating><mpaa>PG-13</mpaa><plot>$1 is a Lumen test movie.</plot>"
    IFS=',' read -ra genres <<< "$3"
    for g in "${genres[@]}"; do echo "<genre>$g</genre>"; done
    echo '</movie>'
  } > "$dir/movie.nfo"
}

movie "Lumen Alpha" 2001 "Action,Science Fiction" 8.1 0 0x33557a 1
movie "Lumen Beta" 2002 "Drama" 7.2 90 0x7a3355 0
movie "Lumen Gamma" 2003 "Action,Comedy" 6.5 180 0x557a33 1

show="$OUT/tv/Lumen Show (2010)"
mkdir -p "$show"
image "$show/poster.jpg" 400x600 0x224466
image "$show/backdrop.jpg" 1280x720 0x224466
image "$show/logo.png" 800x200 white
cat > "$show/tvshow.nfo" <<'NFO'
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<tvshow><title>Lumen Show</title><year>2010</year><rating>8.5</rating><genre>Science Fiction</genre><plot>A Lumen test series.</plot></tvshow>
NFO
for s in 1 2; do
  mkdir -p "$show/Season 0$s"
  for e in 1 2 3; do video "$show/Season 0$s/Lumen Show S0${s}E0${e}.webm" 15 $((s * 60 + e * 20)); done
done
echo "Fixture media written to $OUT"
```

Run:
```bash
chmod +x scripts/gen-test-media.sh && ./scripts/gen-test-media.sh && find e2e/fixtures/media -type f | wc -l
```
Expected: `Fixture media written to .../e2e/fixtures/media`, then `29`.

- [ ] **Step 6: Verify the endpoint on the dev server**

Run `./scripts/dev.sh`. In the browser at http://localhost:8096, finish the startup wizard if needed (user `admin`, password `lumen-admin`). Add a **Movies** library pointing at `<repo>/e2e/fixtures/media/movies` and a **Shows** library pointing at `<repo>/e2e/fixtures/media/tv`, then wait for the scan to finish.

Then run:
```bash
TOKEN=$(curl -s -X POST http://localhost:8096/Users/AuthenticateByName \
  -H 'Content-Type: application/json' \
  -H 'Authorization: MediaBrowser Client="lumen-dev", Device="cli", DeviceId="lumen-cli", Version="0.1.0"' \
  -d '{"Username":"admin","Pw":"lumen-admin"}' | python3 -c 'import json,sys;print(json.load(sys.stdin)["AccessToken"])')
curl -s http://localhost:8096/Lumen/Home -H "Authorization: MediaBrowser Token=\"$TOKEN\"" \
  | python3 -c 'import json,sys;d=json.load(sys.stdin);print(len(d["Hero"]),[r["Title"] for r in d["Rows"]])'
```
Expected: a hero count of 1–4 and row titles including `Recently Added in Movies` and one or more genre rows.

- [ ] **Step 7: Commit**

```bash
git add src tests scripts/gen-test-media.sh
git commit -m "feat: add home and admin endpoints, wire all services, add fixture media" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Phase C: Client

All client commands run from `client/`. "Run the client checks" means:
```bash
cd client && npx vitest run && npm run typecheck && npx eslint . && npx prettier --check . && npm run build && npm run size && cd ..
```
Run `npx prettier --write .` first if Prettier complains about formatting only.

### Task 19: API types, compat module, and Lumen API client

**Files:**
- Create:
  - `client/src/api/types.ts`
  - `client/src/compat/jellyfin.ts`
  - `client/src/api/lumenApi.ts`
  - `client/test/fakeClient.ts`
- Test: `client/src/compat/jellyfin.test.ts`, `client/src/api/lumenApi.test.ts`

**Interfaces:**
- Produces:
  - Types:
    - `BaseItem`, `UserData`, `MediaStream`, `Person`, `ItemsResult`
    - `HomeRow`, `HeroItem`, `HomeResponse`
    - `ClientConfig`, `SessionInfo`
  - Compat:
    - `interface JellyfinApiClient`, `AjaxRequest`
    - `SELECTORS`, `type Layout`, `interface CompatReport`
    - `getApiClient(win?)`, `getLayout(doc?)`, `getAppBarHeight(doc?)`, `selfTest(win?, doc?)`, `navigateTo(hash, win?)`, `detailsHash(itemId, serverId?)`, `getServerVersion(client)`
  - `class LumenApi(client)` with:
    - `getClientConfig()`, `getHome()`, `postDiagnostics(report)`
    - `getItem(id)`, `getSeasons(seriesId)`, `getEpisodes(seriesId, seasonId)`, `getNextUp(seriesId)`, `getResumeForSeries(seriesId)`, `getSimilar(id)`, `getLocalTrailers(id)`
    - `getSessions(deviceId)`, `playNow(sessionId, itemIds, startPositionTicks?)`, `setPlayed(id, played)`, `setFavorite(id, favorite)`
  - Test helpers: `createFakeClient(respond?, userId?)` and `routes(map)`

- [ ] **Step 1: Create the types (no behavior)**

`client/src/api/types.ts`:
```ts
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

export interface HomeResponse {
  ConfigVersion: number;
  Hero: HeroItem[];
  Rows: HomeRow[];
}

export interface ClientConfig {
  Enabled: boolean;
  HomeTakeover: boolean;
  DetailsTakeover: boolean;
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
```

- [ ] **Step 2: Create the test helper**

`client/test/fakeClient.ts`:
```ts
import type { AjaxRequest, JellyfinApiClient } from '../src/compat/jellyfin';

export interface FakeClient extends JellyfinApiClient {
  requests: AjaxRequest[];
  respond: (request: AjaxRequest) => unknown;
  userId: string | null;
}

/** A fake jellyfin-web ApiClient. URLs look like http://jf/<path>?<query>; responses come from `respond`. */
export function createFakeClient(
  respond: (request: AjaxRequest) => unknown = () => ({}),
  userId: string | null = 'user1',
): FakeClient {
  const client: FakeClient = {
    requests: [],
    respond,
    userId,
    getCurrentUserId: () => client.userId,
    accessToken: () => 'token1',
    deviceId: () => 'dev%2Bice',
    getUrl: (name, params) => {
      const query = new URLSearchParams();
      for (const [key, value] of Object.entries(params ?? {})) {
        if (value !== undefined && value !== null && value !== '') query.set(key, String(value));
      }
      const qs = query.toString();
      return `http://jf/${name}${qs ? `?${qs}` : ''}`;
    },
    ajax: async (request) => {
      client.requests.push(request);
      return client.respond(request);
    },
    getPublicSystemInfo: async () => ({ Version: '12.1.0' }),
  };
  return client;
}

/** A responder from a path → value map; a value may be a function of the request. Unknown paths reject. */
export function routes(map: Record<string, unknown>): (request: AjaxRequest) => unknown {
  return (request) => {
    const path = new URL(request.url).pathname.slice(1);
    if (!(path in map)) return Promise.reject(new Error(`unexpected request: ${request.type} ${path}`));
    const value = map[path];
    return typeof value === 'function' ? (value as (r: AjaxRequest) => unknown)(request) : value;
  };
}
```

- [ ] **Step 3: Write the failing tests**

`client/src/compat/jellyfin.test.ts`:
```ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createFakeClient } from '../../test/fakeClient';
import { detailsHash, getAppBarHeight, getLayout, selfTest } from './jellyfin';

function stockDom(): void {
  document.body.innerHTML = '<div id="reactRoot"><header class="MuiAppBar-root"></header><div class="skinBody"></div></div>';
  document.documentElement.className = 'layout-desktop';
  window.location.hash = '#/home';
  Object.assign(window, { ApiClient: createFakeClient(), __LUMEN_FORCE_COMPAT_FAIL__: false });
}

describe('compat', () => {
  beforeEach(stockDom);
  afterEach(() => {
    document.body.innerHTML = '';
    document.documentElement.className = '';
  });

  it('passes against a stock jellyfin-web page', () => {
    expect(selfTest()).toEqual({ ok: true, failed: [] });
  });

  it('names every failed check', () => {
    document.body.innerHTML = '';
    document.documentElement.className = '';
    Object.assign(window, { ApiClient: undefined });

    expect(selfTest().failed).toEqual(['apiClient', 'reactRoot', 'stockPage', 'layoutClass']);
  });

  it('supports a forced failure hook for end-to-end tests', () => {
    Object.assign(window, { __LUMEN_FORCE_COMPAT_FAIL__: true });

    expect(selfTest()).toEqual({ ok: false, failed: ['forced'] });
  });

  it('detects the layout from html classes', () => {
    document.documentElement.className = 'layout-tv';
    expect(getLayout()).toBe('tv');
    document.documentElement.className = 'layout-mobile';
    expect(getLayout()).toBe('mobile');
  });

  it('measures the first visible app bar', () => {
    const bar = document.querySelector('.MuiAppBar-root') as HTMLElement;
    bar.getBoundingClientRect = () => ({ height: 55.6 }) as DOMRect;

    expect(getAppBarHeight()).toBe(56);
  });

  it('builds details hashes', () => {
    expect(detailsHash('abc', 's1')).toBe('#/details?id=abc&serverId=s1');
    expect(detailsHash('abc')).toBe('#/details?id=abc');
  });
});
```

`client/src/api/lumenApi.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { createFakeClient } from '../../test/fakeClient';
import { LumenApi } from './lumenApi';

describe('LumenApi', () => {
  it('reads Lumen endpoints as JSON', async () => {
    const client = createFakeClient(() => ({ Rows: [] }));

    await new LumenApi(client).getHome();

    expect(client.requests).toEqual([{ type: 'GET', url: 'http://jf/Lumen/Home', dataType: 'json' }]);
  });

  it('scopes item reads to the signed-in user via the non-obsolete route', async () => {
    const client = createFakeClient();

    await new LumenApi(client).getItem('abc');

    expect(client.requests[0]?.url).toBe('http://jf/Items/abc?userId=user1');
  });

  it('starts playback through the own session', async () => {
    const client = createFakeClient();

    await new LumenApi(client).playNow('s1', ['a', 'b'], 10);

    expect(client.requests[0]).toEqual({
      type: 'POST',
      url: 'http://jf/Sessions/s1/Playing?playCommand=PlayNow&itemIds=a%2Cb&startPositionTicks=10',
    });
  });

  it('toggles played and favorite with POST/DELETE', async () => {
    const client = createFakeClient();
    const api = new LumenApi(client);

    await api.setPlayed('x', true);
    await api.setPlayed('x', false);
    await api.setFavorite('x', true);

    expect(client.requests.map((r) => `${r.type} ${r.url}`)).toEqual([
      'POST http://jf/UserPlayedItems/x?userId=user1',
      'DELETE http://jf/UserPlayedItems/x?userId=user1',
      'POST http://jf/UserFavoriteItems/x?userId=user1',
    ]);
  });

  it('posts diagnostics as JSON', async () => {
    const client = createFakeClient();

    await new LumenApi(client).postDiagnostics({ Client: 'web', ServerVersion: '12.1.0', FailedChecks: ['stockPage'] });

    expect(client.requests[0]).toMatchObject({
      type: 'POST',
      url: 'http://jf/Lumen/Diagnostics',
      contentType: 'application/json',
      data: '{"Client":"web","ServerVersion":"12.1.0","FailedChecks":["stockPage"]}',
    });
  });

  it('rejects user-scoped calls when signed out', async () => {
    await expect(new LumenApi(createFakeClient(undefined, null)).getItem('x')).rejects.toThrow('Not signed in');
  });
});
```

Run: `cd client && npx vitest run src/compat src/api; cd ..`

Expected: FAIL with `Failed to resolve import "./jellyfin"` and `Failed to resolve import "./lumenApi"`.

- [ ] **Step 4: Implement**

`client/src/compat/jellyfin.ts`:
```ts
/**
 * The ONLY module that knows jellyfin-web internals: globals, selectors, routes, and layout classes.
 * Evidence for each is in docs/reference/jellyfin-web-12.1-notes.md. When jellyfin-web changes, fix it here.
 */
export interface AjaxRequest {
  type: 'GET' | 'POST' | 'DELETE';
  url: string;
  dataType?: 'json';
  data?: string;
  contentType?: string;
}

/** The subset of jellyfin-web's `window.ApiClient` that Lumen uses. */
export interface JellyfinApiClient {
  getCurrentUserId(): string | null;
  accessToken(): string | null;
  /** URL-encoded device id; the server stores the decoded form. */
  deviceId(): string;
  getUrl(name: string, params?: Record<string, unknown>): string;
  ajax(request: AjaxRequest): Promise<unknown>;
  getPublicSystemInfo?(): Promise<{ Version?: string }>;
}

export const SELECTORS = {
  reactRoot: '#reactRoot',
  /** Routed page content in both the Modern and Legacy layouts. Hidden via CSS only. */
  stockPage: '#reactRoot .skinBody',
  backdrop: '.backdropContainer',
  modernAppBar: '.MuiAppBar-root',
  legacyHeader: '.skinHeader',
} as const;

export type Layout = 'tv' | 'mobile' | 'desktop';

export interface CompatReport {
  ok: boolean;
  failed: string[];
}

type JellyfinWindow = Window & { ApiClient?: JellyfinApiClient; __LUMEN_FORCE_COMPAT_FAIL__?: boolean };

export function getApiClient(win: Window = window): JellyfinApiClient | undefined {
  return (win as JellyfinWindow).ApiClient;
}

export function getLayout(doc: Document = document): Layout {
  const classes = doc.documentElement.classList;
  if (classes.contains('layout-tv')) return 'tv';
  if (classes.contains('layout-mobile')) return 'mobile';
  return 'desktop';
}

/** Height of the visible fixed app bar (Modern) or header (Legacy), in CSS pixels. */
export function getAppBarHeight(doc: Document = document): number {
  for (const selector of [SELECTORS.modernAppBar, SELECTORS.legacyHeader]) {
    for (const element of Array.from(doc.querySelectorAll<HTMLElement>(selector))) {
      const height = element.getBoundingClientRect().height;
      if (height > 0) return Math.round(height);
    }
  }
  return 0;
}

export function selfTest(win: Window = window, doc: Document = document): CompatReport {
  if ((win as JellyfinWindow).__LUMEN_FORCE_COMPAT_FAIL__) return { ok: false, failed: ['forced'] };
  const client = getApiClient(win) as unknown as Record<string, unknown> | undefined;

  const checks: Record<string, boolean> = {
    apiClient:
      client !== undefined &&
      ['getCurrentUserId', 'accessToken', 'deviceId', 'getUrl', 'ajax'].every((m) => typeof client[m] === 'function'),
    reactRoot: doc.querySelector(SELECTORS.reactRoot) !== null,
    stockPage: doc.querySelector(SELECTORS.stockPage) !== null,
    layoutClass: ['layout-tv', 'layout-mobile', 'layout-desktop'].some((c) => doc.documentElement.classList.contains(c)),
    history: typeof win.history?.pushState === 'function' && typeof win.history?.replaceState === 'function',
    hashRouting: win.location.hash.startsWith('#/'),
  };
  const failed = Object.entries(checks)
    .filter(([, ok]) => !ok)
    .map(([name]) => name);
  return { ok: failed.length === 0, failed };
}

/** jellyfin-web's hash router follows a manual hash assignment (it fires popstate and hashchange). */
export function navigateTo(hash: string, win: Window = window): void {
  win.location.hash = hash;
}

export function detailsHash(itemId: string, serverId?: string): string {
  const server = serverId ? `&serverId=${encodeURIComponent(serverId)}` : '';
  return `#/details?id=${encodeURIComponent(itemId)}${server}`;
}

/** Server version; the served web client matches it. ApiClient.appVersion() reports the native app's version, so it isn't used. */
export async function getServerVersion(client: JellyfinApiClient): Promise<string> {
  try {
    return (await client.getPublicSystemInfo?.())?.Version ?? 'unknown';
  } catch {
    return 'unknown';
  }
}
```

`client/src/api/lumenApi.ts`. Request parameters are built lazily (`() => ({ ... })`), so a missing user surfaces as a rejected promise instead of a synchronous throw:
```ts
import type { AjaxRequest, JellyfinApiClient } from '../compat/jellyfin';
import type { BaseItem, ClientConfig, HomeResponse, ItemsResult, SessionInfo } from './types';

export interface DiagnosticsReport {
  Client: string;
  ServerVersion: string;
  FailedChecks: string[];
}

type Params = () => Record<string, unknown>;

/** Typed access to Lumen's and Jellyfin's HTTP APIs through jellyfin-web's authenticated ApiClient. */
export class LumenApi {
  constructor(private readonly client: JellyfinApiClient) {}

  getClientConfig(): Promise<ClientConfig> {
    return this.get('Lumen/ClientConfig');
  }

  getHome(): Promise<HomeResponse> {
    return this.get('Lumen/Home');
  }

  postDiagnostics(report: DiagnosticsReport): Promise<void> {
    return this.send('POST', 'Lumen/Diagnostics', undefined, report);
  }

  getItem(id: string): Promise<BaseItem> {
    return this.get(`Items/${id}`, () => ({ userId: this.userId() }));
  }

  getSeasons(seriesId: string): Promise<ItemsResult> {
    return this.get(`Shows/${seriesId}/Seasons`, () => ({ userId: this.userId(), enableUserData: true }));
  }

  getEpisodes(seriesId: string, seasonId: string): Promise<ItemsResult> {
    return this.get(`Shows/${seriesId}/Episodes`, () => ({
      userId: this.userId(),
      seasonId,
      isMissing: false,
      enableUserData: true,
      fields: 'Overview,PrimaryImageAspectRatio',
    }));
  }

  getNextUp(seriesId: string): Promise<ItemsResult> {
    return this.get('Shows/NextUp', () => ({ userId: this.userId(), seriesId, limit: 1, enableResumable: false }));
  }

  getResumeForSeries(seriesId: string): Promise<ItemsResult> {
    return this.get('UserItems/Resume', () => ({ userId: this.userId(), parentId: seriesId, includeItemTypes: 'Episode', limit: 1 }));
  }

  getSimilar(id: string): Promise<ItemsResult> {
    return this.get(`Items/${id}/Similar`, () => ({ userId: this.userId(), limit: 16, fields: 'PrimaryImageAspectRatio' }));
  }

  getLocalTrailers(id: string): Promise<BaseItem[]> {
    return this.get(`Items/${id}/LocalTrailers`, () => ({ userId: this.userId() }));
  }

  getSessions(deviceId: string): Promise<SessionInfo[]> {
    return this.get('Sessions', () => ({ deviceId }));
  }

  playNow(sessionId: string, itemIds: string[], startPositionTicks?: number): Promise<void> {
    return this.send('POST', `Sessions/${sessionId}/Playing`, () => ({
      playCommand: 'PlayNow',
      itemIds: itemIds.join(','),
      startPositionTicks,
    }));
  }

  setPlayed(id: string, played: boolean): Promise<void> {
    return this.send(played ? 'POST' : 'DELETE', `UserPlayedItems/${id}`, () => ({ userId: this.userId() }));
  }

  setFavorite(id: string, favorite: boolean): Promise<void> {
    return this.send(favorite ? 'POST' : 'DELETE', `UserFavoriteItems/${id}`, () => ({ userId: this.userId() }));
  }

  private userId(): string {
    const id = this.client.getCurrentUserId();
    if (!id) throw new Error('Not signed in');
    return id;
  }

  private async get<T>(path: string, params?: Params): Promise<T> {
    return (await this.client.ajax({ type: 'GET', url: this.client.getUrl(path, params?.()), dataType: 'json' })) as T;
  }

  private async send(type: 'POST' | 'DELETE', path: string, params?: Params, body?: unknown): Promise<void> {
    const request: AjaxRequest = { type, url: this.client.getUrl(path, params?.()) };
    if (body !== undefined) {
      request.data = JSON.stringify(body);
      request.contentType = 'application/json';
    }
    await this.client.ajax(request);
  }
}
```

- [ ] **Step 5: Run the client checks**

Expected: every test passes (12 new compat and API tests plus `once`), and typecheck, lint, build, and size all pass.

- [ ] **Step 6: Commit**

```bash
git add client
git commit -m "feat(client): add API types, jellyfin-web compat module, and Lumen API client" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 20: Admin dashboard page

**Files:**
- Create:
  - `client/vite.admin.config.ts`
  - `client/src/admin/adminApi.ts`, `client/src/admin/configModel.ts`, `client/src/admin/AdminApp.tsx`, `client/src/admin/main.tsx`
  - `src/Jellyfin.Plugin.Lumen/Configuration/configPage.html`
- Modify:
  - `client/package.json` (build script)
  - `src/Jellyfin.Plugin.Lumen/LumenPlugin.cs` (`GetPages`)
  - `src/Jellyfin.Plugin.Lumen/Jellyfin.Plugin.Lumen.csproj` (embed `configPage.html`)
  - `tests/Jellyfin.Plugin.Lumen.Tests/LumenPluginTests.cs`
- Test: `client/src/admin/configModel.test.ts`, `client/src/admin/AdminApp.test.tsx`

**Interfaces:**
- Consumes: the admin endpoints (Task 18) and `JellyfinApiClient`/`getApiClient` (Task 19).
- Produces:
  - `dist/lumen-admin.js`, served at `/Lumen/Assets/lumen-admin.js`. It's excluded from the 60 KB budget.
  - Dashboard page `Lumen` (`LumenPlugin.GetPages()`)

- [ ] **Step 1: Write the failing tests**

`client/src/admin/configModel.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import type { LumenConfig, SectionDef } from './adminApi';
import { getParam, moveSection, newSection, normalizeConfig, normalizeId, removeSection, setParam } from './configModel';

const section = (id: string): SectionDef => ({ Id: id, Type: 'NextUp', Enabled: true, Title: null, Params: [] });

describe('configModel', () => {
  it('normalizes a numeric hero source', () => {
    expect(normalizeConfig({ HeroSource: 2, Sections: [] } as unknown as LumenConfig).HeroSource).toBe('Collection');
  });

  it('moves sections within bounds only, and removes them', () => {
    const list = [section('a'), section('b'), section('c')];
    expect(moveSection(list, 0, 1).map((s) => s.Id)).toEqual(['b', 'a', 'c']);
    expect(moveSection(list, 0, -1)).toBe(list);
    expect(removeSection(list, 1).map((s) => s.Id)).toEqual(['a', 'c']);
  });

  it('creates sections with default parameter values', () => {
    const created = newSection(
      {
        Type: 'Genre',
        DisplayName: 'Genre rows',
        Parameters: [
          { Name: 'genreCount', Label: 'n', Kind: 'Integer', Required: false, DefaultValue: '3', Min: 1, Max: 6 },
          { Name: 'x', Label: 'x', Kind: 'Text', Required: false, DefaultValue: null, Min: null, Max: null },
        ],
      },
      'id1',
    );
    expect(created).toEqual({ Id: 'id1', Type: 'Genre', Enabled: true, Title: null, Params: [{ Name: 'genreCount', Value: '3' }] });
  });

  it('sets, replaces, and clears parameters case-insensitively', () => {
    let s = setParam(section('a'), 'libraryId', 'L1');
    s = setParam(s, 'LIBRARYID', 'L2');
    expect(getParam(s, 'libraryid')).toBe('L2');
    expect(setParam(s, 'libraryId', '').Params).toEqual([]);
  });

  it('normalizes ids for comparison', () => {
    expect(normalizeId('AB-CD')).toBe('abcd');
    expect(normalizeId(null)).toBe('');
  });
});
```

`client/src/admin/AdminApp.test.tsx`:
```tsx
import { fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { describe, expect, it, vi } from 'vitest';
import type { AdminApi, LumenConfig, SectionTypeDef } from './adminApi';
import { AdminApp } from './AdminApp';

const types: SectionTypeDef[] = [
  { Type: 'ContinueWatching', DisplayName: 'Continue Watching', Parameters: [] },
  {
    Type: 'Genre',
    DisplayName: 'Genre rows',
    Parameters: [{ Name: 'genreCount', Label: 'Number of genre rows', Kind: 'Integer', Required: false, DefaultValue: '3', Min: 1, Max: 6 }],
  },
];

function config(): LumenConfig {
  return {
    SchemaVersion: 1,
    ConfigVersion: 4,
    Enabled: true,
    HomeTakeover: true,
    DetailsTakeover: true,
    AccentColor: '#f5a524',
    HeroSource: 0,
    HeroCollectionId: null,
    HeroCount: 5,
    HeroIntervalSeconds: 8,
    TrailerPreview: true,
    TrailerDelaySeconds: 4,
    Sections: [
      { Id: 's1', Type: 'ContinueWatching', Enabled: true, Title: null, Params: [] },
      { Id: 's2', Type: 'Genre', Enabled: true, Title: null, Params: [{ Name: 'genreCount', Value: '3' }] },
    ],
  };
}

function fakeApi(overrides: Partial<AdminApi> = {}): AdminApi {
  return {
    getConfig: vi.fn(async () => config()),
    saveConfig: vi.fn(async () => ({ ok: true as const })),
    reset: vi.fn(async () => undefined),
    getSectionTypes: vi.fn(async () => types),
    getDiagnostics: vi.fn(async () => []),
    getLibraries: vi.fn(async () => [{ id: 'lib1', name: 'Movies' }]),
    getCollections: vi.fn(async () => [{ id: 'col1', name: 'Holiday' }]),
    getPlaylists: vi.fn(async () => []),
    ...overrides,
  };
}

describe('AdminApp', () => {
  it('lists sections in order and saves a reordered list', async () => {
    const api = fakeApi();
    render(<AdminApp api={api} />);

    await screen.findByText('Genre rows');
    fireEvent.click(screen.getByRole('button', { name: 'Move Continue Watching down' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(api.saveConfig).toHaveBeenCalled());
    const saved = vi.mocked(api.saveConfig).mock.calls[0]![0];
    expect(saved.Sections.map((s) => s.Id)).toEqual(['s2', 's1']);
    expect(saved.HeroSource).toBe('RecentlyAdded');
    expect(await screen.findByRole('status')).toHaveTextContent('Settings saved.');
  });

  it('adds a section with defaults', async () => {
    const api = fakeApi();
    render(<AdminApp api={api} newId={() => 'new1'} />);

    await screen.findByText('Genre rows');
    fireEvent.change(screen.getByRole('combobox', { name: 'Section type to add' }), { target: { value: 'Genre' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(api.saveConfig).toHaveBeenCalled());
    expect(vi.mocked(api.saveConfig).mock.calls[0]![0].Sections[2]).toEqual({
      Id: 'new1',
      Type: 'Genre',
      Enabled: true,
      Title: null,
      Params: [{ Name: 'genreCount', Value: '3' }],
    });
  });

  it('shows server validation errors', async () => {
    const api = fakeApi({
      saveConfig: vi.fn(async () => ({ ok: false as const, errors: ['Accent color must look like #RRGGBB.'] })),
    });
    render(<AdminApp api={api} />);

    await screen.findByText('Genre rows');
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Accent color must look like #RRGGBB.');
  });

  it('shows the collection picker only for the collection hero source', async () => {
    render(<AdminApp api={fakeApi()} />);

    await screen.findByText('Genre rows');
    expect(screen.queryByLabelText('Collection')).toBeNull();
    fireEvent.change(screen.getByLabelText('Source'), { target: { value: 'Collection' } });
    expect(screen.getByLabelText('Collection')).toBeInTheDocument();
  });

  it('reports load failures', async () => {
    render(<AdminApp api={fakeApi({ getConfig: vi.fn(() => Promise.reject(new Error('x'))) })} />);

    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't load Lumen settings");
  });
});
```

Run: `cd client && npx vitest run src/admin; cd ..`

Expected: FAIL with `Failed to resolve import "./configModel"`.

- [ ] **Step 2: Implement the admin modules**

`client/src/admin/adminApi.ts`:
```ts
import type { JellyfinApiClient } from '../compat/jellyfin';

export interface SectionParamDef {
  Name: string;
  Label: string;
  Kind: string;
  Required: boolean;
  DefaultValue: string | null;
  Min: number | null;
  Max: number | null;
}

export interface SectionTypeDef {
  Type: string;
  DisplayName: string;
  Parameters: SectionParamDef[];
}

export interface SectionDef {
  Id: string;
  Type: string;
  Enabled: boolean;
  Title: string | null;
  Params: { Name: string; Value: string }[];
}

export interface LumenConfig {
  SchemaVersion: number;
  ConfigVersion: number;
  Enabled: boolean;
  HomeTakeover: boolean;
  DetailsTakeover: boolean;
  AccentColor: string;
  /** Jellyfin may serialize the enum as a name or a number; normalizeConfig converts it to a name. */
  HeroSource: string | number;
  HeroCollectionId: string | null;
  HeroCount: number;
  HeroIntervalSeconds: number;
  TrailerPreview: boolean;
  TrailerDelaySeconds: number;
  Sections: SectionDef[];
}

export interface Option {
  id: string;
  name: string;
}

export interface DiagnosticEntry {
  Client: string;
  ServerVersion: string;
  FailedChecks: string[];
  LastSeen: string;
}

export type SaveResult = { ok: true } | { ok: false; errors: string[] };

export interface AdminApi {
  getConfig(): Promise<LumenConfig>;
  saveConfig(config: LumenConfig): Promise<SaveResult>;
  reset(): Promise<void>;
  getSectionTypes(): Promise<SectionTypeDef[]>;
  getDiagnostics(): Promise<DiagnosticEntry[]>;
  getLibraries(): Promise<Option[]>;
  getCollections(): Promise<Option[]>;
  getPlaylists(): Promise<Option[]>;
}

const isResponse = (value: unknown): value is Response =>
  typeof value === 'object' && value !== null && 'status' in value && 'json' in value;

export function createAdminApi(client: JellyfinApiClient): AdminApi {
  const getJson = async <T,>(path: string, params?: Record<string, unknown>): Promise<T> =>
    (await client.ajax({ type: 'GET', url: client.getUrl(path, params), dataType: 'json' })) as T;

  const items = async (type: string): Promise<Option[]> => {
    const result = await getJson<{ Items: { Id: string; Name: string }[] }>('Items', {
      userId: client.getCurrentUserId() ?? undefined,
      includeItemTypes: type,
      recursive: true,
      sortBy: 'SortName',
    });
    return result.Items.map((i) => ({ id: i.Id, name: i.Name }));
  };

  return {
    getConfig: () => getJson('Lumen/Admin/Config'),
    async saveConfig(config) {
      try {
        await client.ajax({
          type: 'POST',
          url: client.getUrl('Lumen/Admin/Config'),
          data: JSON.stringify(config),
          contentType: 'application/json',
        });
        return { ok: true };
      } catch (error) {
        // jellyfin-web's ajax rejects with the Response for status >= 400.
        if (isResponse(error) && error.status === 400) {
          const body = (await error.json()) as { Errors?: string[] };
          return { ok: false, errors: body.Errors ?? ['The configuration is invalid.'] };
        }
        throw error;
      }
    },
    async reset() {
      await client.ajax({ type: 'POST', url: client.getUrl('Lumen/Admin/Config/Reset') });
    },
    getSectionTypes: () => getJson('Lumen/Admin/SectionTypes'),
    getDiagnostics: () => getJson('Lumen/Admin/Diagnostics'),
    getLibraries: async () =>
      (await getJson<{ Name: string; ItemId: string }[]>('Library/VirtualFolders')).map((f) => ({ id: f.ItemId, name: f.Name })),
    getCollections: () => items('BoxSet'),
    getPlaylists: () => items('Playlist'),
  };
}
```

`client/src/admin/configModel.ts`:
```ts
import type { LumenConfig, SectionDef, SectionTypeDef } from './adminApi';

export const HERO_SOURCES = ['RecentlyAdded', 'TopRatedUnplayed', 'Collection'] as const;
export type HeroSourceName = (typeof HERO_SOURCES)[number];
export const HERO_LABELS: Record<HeroSourceName, string> = {
  RecentlyAdded: 'Recently added',
  TopRatedUnplayed: 'Top rated, not yet watched',
  Collection: 'A collection',
};

export function normalizeConfig(config: LumenConfig): LumenConfig {
  const source = typeof config.HeroSource === 'number' ? (HERO_SOURCES[config.HeroSource] ?? 'RecentlyAdded') : config.HeroSource;
  return { ...config, HeroSource: source, Sections: config.Sections ?? [] };
}

export function moveSection(sections: SectionDef[], index: number, delta: -1 | 1): SectionDef[] {
  const target = index + delta;
  if (target < 0 || target >= sections.length) return sections;
  const next = [...sections];
  [next[index], next[target]] = [next[target]!, next[index]!];
  return next;
}

export function removeSection(sections: SectionDef[], index: number): SectionDef[] {
  return sections.filter((_, i) => i !== index);
}

export function newSection(type: SectionTypeDef, id: string): SectionDef {
  return {
    Id: id,
    Type: type.Type,
    Enabled: true,
    Title: null,
    Params: type.Parameters.filter((p) => p.DefaultValue !== null).map((p) => ({ Name: p.Name, Value: p.DefaultValue as string })),
  };
}

export function getParam(section: SectionDef, name: string): string {
  return section.Params.find((p) => p.Name.toLowerCase() === name.toLowerCase())?.Value ?? '';
}

export function setParam(section: SectionDef, name: string, value: string): SectionDef {
  const rest = section.Params.filter((p) => p.Name.toLowerCase() !== name.toLowerCase());
  return { ...section, Params: value === '' ? rest : [...rest, { Name: name, Value: value }] };
}

export const normalizeId = (id: string | null | undefined): string => (id ?? '').replace(/-/g, '').toLowerCase();
```

`client/src/admin/AdminApp.tsx`:
```tsx
import type { ComponentChildren } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import type { AdminApi, DiagnosticEntry, LumenConfig, Option, SectionDef, SectionParamDef, SectionTypeDef } from './adminApi';
import {
  HERO_LABELS,
  HERO_SOURCES,
  getParam,
  moveSection,
  newSection,
  normalizeConfig,
  normalizeId,
  removeSection,
  setParam,
} from './configModel';

type PickerKind = 'Library' | 'Collection' | 'Playlist';
type Lookups = Record<PickerKind, Option[]>;

const inputValue = (event: Event): string => (event.target as HTMLInputElement | HTMLSelectElement).value;
const sectionLabel = (section: SectionDef, types: SectionTypeDef[]): string =>
  section.Title || types.find((t) => t.Type === section.Type)?.DisplayName || section.Type;

interface AdminAppProps {
  api: AdminApi;
  newId?: () => string;
  confirm?: (message: string) => boolean;
}

export function AdminApp({ api, newId = () => crypto.randomUUID(), confirm = (m) => window.confirm(m) }: AdminAppProps) {
  const [config, setConfig] = useState<LumenConfig | null>(null);
  const [types, setTypes] = useState<SectionTypeDef[]>([]);
  const [lookups, setLookups] = useState<Lookups>({ Library: [], Collection: [], Playlist: [] });
  const [diagnostics, setDiagnostics] = useState<DiagnosticEntry[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'saving' | 'saved' | 'failed'>('loading');

  const load = async (): Promise<void> => {
    try {
      const [c, t, libraries, collections, playlists, d] = await Promise.all([
        api.getConfig(),
        api.getSectionTypes(),
        api.getLibraries(),
        api.getCollections(),
        api.getPlaylists(),
        api.getDiagnostics(),
      ]);
      setConfig(normalizeConfig(c));
      setTypes(t);
      setLookups({ Library: libraries, Collection: collections, Playlist: playlists });
      setDiagnostics(d);
      setStatus('ready');
    } catch {
      setStatus('failed');
    }
  };

  useEffect(() => {
    void load();
  }, []);

  if (status === 'failed') return <p role="alert">Couldn't load Lumen settings. Reload the page to try again.</p>;
  if (!config) return <p>Loading Lumen settings…</p>;

  const update = (patch: Partial<LumenConfig>): void => {
    setConfig({ ...config, ...patch });
    if (status === 'saved') setStatus('ready');
  };
  const updateSection = (index: number, section: SectionDef): void =>
    update({ Sections: config.Sections.map((s, i) => (i === index ? section : s)) });

  const save = async (event: Event): Promise<void> => {
    event.preventDefault();
    setStatus('saving');
    try {
      const result = await api.saveConfig(config);
      if (result.ok) {
        setErrors([]);
        setConfig(normalizeConfig(await api.getConfig()));
        setStatus('saved');
      } else {
        setErrors(result.errors);
        setStatus('ready');
      }
    } catch {
      setErrors(['Saving failed. Check the server log.']);
      setStatus('ready');
    }
  };

  const reset = async (): Promise<void> => {
    if (!confirm('Reset all Lumen settings to their defaults?')) return;
    await api.reset();
    setErrors([]);
    await load();
  };

  return (
    <form class="lmn-admin" onSubmit={(e) => void save(e)}>
      {errors.length > 0 && (
        <div class="lmn-admin__errors" role="alert">
          <h3>Please fix these problems</h3>
          <ul>
            {errors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        </div>
      )}

      <fieldset>
        <legend>General</legend>
        <Checkbox label="Enable Lumen" checked={config.Enabled} onChange={(v) => update({ Enabled: v })} />
        <Checkbox label="Replace the home screen" checked={config.HomeTakeover} onChange={(v) => update({ HomeTakeover: v })} />
        <Checkbox
          label="Replace movie and series details pages"
          checked={config.DetailsTakeover}
          onChange={(v) => update({ DetailsTakeover: v })}
        />
        <Field label="Accent color">
          <input type="color" value={config.AccentColor} onInput={(e) => update({ AccentColor: inputValue(e) })} />
        </Field>
      </fieldset>

      <fieldset>
        <legend>Hero banner</legend>
        <Field label="Source">
          <select value={String(config.HeroSource)} onChange={(e) => update({ HeroSource: inputValue(e) })}>
            {HERO_SOURCES.map((s) => (
              <option key={s} value={s}>
                {HERO_LABELS[s]}
              </option>
            ))}
          </select>
        </Field>
        {config.HeroSource === 'Collection' && (
          <Field label="Collection">
            <OptionSelect
              options={lookups.Collection}
              value={config.HeroCollectionId ?? ''}
              onChange={(v) => update({ HeroCollectionId: v || null })}
            />
          </Field>
        )}
        <NumberField label="Items" value={config.HeroCount} min={1} max={10} onChange={(v) => update({ HeroCount: v })} />
        <NumberField
          label="Seconds per slide"
          value={config.HeroIntervalSeconds}
          min={3}
          max={60}
          onChange={(v) => update({ HeroIntervalSeconds: v })}
        />
        <Checkbox
          label="Play muted trailer previews (local trailers only)"
          checked={config.TrailerPreview}
          onChange={(v) => update({ TrailerPreview: v })}
        />
        <NumberField
          label="Seconds before the trailer starts"
          value={config.TrailerDelaySeconds}
          min={0}
          max={30}
          onChange={(v) => update({ TrailerDelaySeconds: v })}
        />
      </fieldset>

      <fieldset>
        <legend>Home sections</legend>
        <ol class="lmn-admin__sections">
          {config.Sections.map((section, index) => (
            <li key={section.Id} class="lmn-admin__section">
              <SectionEditor
                section={section}
                type={types.find((t) => t.Type === section.Type)}
                lookups={lookups}
                onChange={(s) => updateSection(index, s)}
              />
              <div class="lmn-admin__section-actions">
                <button
                  type="button"
                  class="emby-button"
                  aria-label={`Move ${sectionLabel(section, types)} up`}
                  disabled={index === 0}
                  onClick={() => update({ Sections: moveSection(config.Sections, index, -1) })}
                >
                  ↑
                </button>
                <button
                  type="button"
                  class="emby-button"
                  aria-label={`Move ${sectionLabel(section, types)} down`}
                  disabled={index === config.Sections.length - 1}
                  onClick={() => update({ Sections: moveSection(config.Sections, index, 1) })}
                >
                  ↓
                </button>
                <button
                  type="button"
                  class="emby-button"
                  aria-label={`Remove ${sectionLabel(section, types)}`}
                  onClick={() => update({ Sections: removeSection(config.Sections, index) })}
                >
                  Remove
                </button>
              </div>
            </li>
          ))}
        </ol>
        <AddSection types={types} onAdd={(type) => update({ Sections: [...config.Sections, newSection(type, newId())] })} />
      </fieldset>

      <fieldset>
        <legend>Diagnostics</legend>
        {diagnostics.length === 0 ? (
          <p>No compatibility problems reported.</p>
        ) : (
          <table class="lmn-admin__diagnostics">
            <thead>
              <tr>
                <th>Client</th>
                <th>Server</th>
                <th>Failed checks</th>
                <th>Last seen</th>
              </tr>
            </thead>
            <tbody>
              {diagnostics.map((d) => (
                <tr key={`${d.Client}-${d.LastSeen}`}>
                  <td>{d.Client}</td>
                  <td>{d.ServerVersion}</td>
                  <td>{d.FailedChecks.join(', ')}</td>
                  <td>{new Date(d.LastSeen).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </fieldset>

      <div class="lmn-admin__footer">
        <button type="submit" class="raised button-submit block emby-button" disabled={status === 'saving'}>
          Save
        </button>
        <button type="button" class="raised block emby-button" onClick={() => void reset()}>
          Reset to defaults
        </button>
        {status === 'saved' && <p role="status">Settings saved.</p>}
      </div>
    </form>
  );
}

function Field({ label, children }: { label: string; children: ComponentChildren }) {
  return (
    <label class="inputContainer lmn-admin__field">
      <span class="inputLabel">{label}</span>
      {children}
    </label>
  );
}

function Checkbox({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) {
  return (
    <label class="checkboxContainer lmn-admin__checkbox">
      <input type="checkbox" checked={checked} onChange={(e) => onChange((e.target as HTMLInputElement).checked)} />
      <span>{label}</span>
    </label>
  );
}

function NumberField(props: { label: string; value: number; min: number; max: number; onChange: (value: number) => void }) {
  return (
    <Field label={props.label}>
      <input
        type="number"
        min={props.min}
        max={props.max}
        value={props.value}
        onInput={(e) => props.onChange(Number.parseInt(inputValue(e), 10) || 0)}
      />
    </Field>
  );
}

function OptionSelect({ options, value, onChange }: { options: Option[]; value: string; onChange: (value: string) => void }) {
  const selected = options.find((o) => normalizeId(o.id) === normalizeId(value))?.id ?? '';
  return (
    <select value={selected} onChange={(e) => onChange(inputValue(e))}>
      <option value="">(none)</option>
      {options.map((o) => (
        <option key={o.id} value={o.id}>
          {o.name}
        </option>
      ))}
    </select>
  );
}

function ParamInput(props: { param: SectionParamDef; value: string; lookups: Lookups; onChange: (value: string) => void }) {
  const { param, value, lookups, onChange } = props;
  if (param.Kind === 'Library' || param.Kind === 'Collection' || param.Kind === 'Playlist') {
    return <OptionSelect options={lookups[param.Kind]} value={value} onChange={onChange} />;
  }
  if (param.Kind === 'Integer') {
    return (
      <input
        type="number"
        min={param.Min ?? undefined}
        max={param.Max ?? undefined}
        value={value}
        onInput={(e) => onChange(inputValue(e))}
      />
    );
  }
  return <input type="text" value={value} onInput={(e) => onChange(inputValue(e))} />;
}

function SectionEditor(props: {
  section: SectionDef;
  type: SectionTypeDef | undefined;
  lookups: Lookups;
  onChange: (section: SectionDef) => void;
}) {
  const { section, type, lookups, onChange } = props;
  return (
    <div class="lmn-admin__section-body">
      <strong>{type?.DisplayName ?? `Unknown type: ${section.Type}`}</strong>
      <Checkbox label="Enabled" checked={section.Enabled} onChange={(v) => onChange({ ...section, Enabled: v })} />
      <Field label="Title (optional)">
        <input type="text" value={section.Title ?? ''} onInput={(e) => onChange({ ...section, Title: inputValue(e) || null })} />
      </Field>
      {type?.Parameters.map((p) => (
        <Field key={p.Name} label={p.Required ? `${p.Label} *` : p.Label}>
          <ParamInput
            param={p}
            value={getParam(section, p.Name)}
            lookups={lookups}
            onChange={(v) => onChange(setParam(section, p.Name, v))}
          />
        </Field>
      ))}
    </div>
  );
}

function AddSection({ types, onAdd }: { types: SectionTypeDef[]; onAdd: (type: SectionTypeDef) => void }) {
  const [choice, setChoice] = useState('');
  return (
    <div class="lmn-admin__add">
      <select aria-label="Section type to add" value={choice} onChange={(e) => setChoice(inputValue(e))}>
        <option value="">Add a section…</option>
        {types.map((t) => (
          <option key={t.Type} value={t.Type}>
            {t.DisplayName}
          </option>
        ))}
      </select>
      <button
        type="button"
        class="emby-button"
        disabled={!choice}
        onClick={() => {
          const type = types.find((t) => t.Type === choice);
          if (type) {
            onAdd(type);
            setChoice('');
          }
        }}
      >
        Add
      </button>
    </div>
  );
}
```

`client/src/admin/main.tsx`:
```tsx
import { render } from 'preact';
import { getApiClient } from '../compat/jellyfin';
import { AdminApp } from './AdminApp';
import { createAdminApi } from './adminApi';

/** The dashboard re-inserts the page HTML on each visit, so mount on load and on every page show. */
function mount(): void {
  const root = document.getElementById('lmn-admin-root');
  const client = getApiClient();
  if (!root || !client || root.dataset.lmnMounted) return;
  root.dataset.lmnMounted = 'true';
  render(<AdminApp api={createAdminApi(client)} />, root);
}

mount();
document.addEventListener('viewshow', mount);
document.addEventListener('pageshow', mount);
```

`client/vite.admin.config.ts`:
```ts
import preact from '@preact/preset-vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [preact()],
  build: {
    outDir: 'dist',
    emptyOutDir: false,
    target: 'es2020',
    lib: { entry: 'src/admin/main.tsx', formats: ['iife'], name: 'LumenAdmin', fileName: () => 'lumen-admin.js' },
  },
});
```

Update the build script:
```bash
cd client && npm pkg set scripts.build="vite build && vite build -c vite.admin.config.ts" && cd ..
```

- [ ] **Step 3: Add the dashboard page shell and register it**

`src/Jellyfin.Plugin.Lumen/Configuration/configPage.html`:
```html
<div id="LumenConfigPage" data-role="page" class="page type-interior pluginConfigurationPage">
  <div data-role="content">
    <div class="content-primary">
      <div id="lmn-admin-root">Loading Lumen settings…</div>
    </div>
  </div>
  <script src="../Lumen/Assets/lumen-admin.js"></script>
</div>
```

In `Jellyfin.Plugin.Lumen.csproj`, add:
```xml
  <ItemGroup>
    <None Remove="Configuration\configPage.html" />
    <EmbeddedResource Include="Configuration\configPage.html" />
  </ItemGroup>
```

In `LumenPlugin.cs`, replace `GetPages`:
```csharp
    public IEnumerable<PluginPageInfo> GetPages() =>
    [
        new PluginPageInfo
        {
            Name = Name,
            DisplayName = "Lumen",
            EmbeddedResourcePath = $"{GetType().Namespace}.Configuration.configPage.html",
        },
    ];
```

Add to `tests/Jellyfin.Plugin.Lumen.Tests/LumenPluginTests.cs`:
```csharp
    [Fact]
    public void Plugin_ExposesEmbeddedConfigPage()
    {
        var paths = Substitute.For<IApplicationPaths>();
        paths.PluginsPath.Returns("/tmp/lumen-tests/plugins");
        var plugin = new LumenPlugin(paths, Substitute.For<IXmlSerializer>());

        var page = Assert.Single(plugin.GetPages());

        Assert.Equal("Lumen", page.Name);
        Assert.NotNull(typeof(LumenPlugin).Assembly.GetManifestResourceStream(page.EmbeddedResourcePath));
    }
```

- [ ] **Step 4: Run all checks**

Run the client checks, then `source scripts/env.sh && dotnet test --nologo`.

Expected:
- Vitest passes, including 10 new admin tests.
- `client/dist/` contains `lumen.js`, `lumen.css`, and `lumen-admin.js`.
- `dotnet test` passes, including `Plugin_ExposesEmbeddedConfigPage`.

- [ ] **Step 5: Verify in the dashboard**

Run `./scripts/dev.sh` and open Dashboard → Plugins → Lumen.

Expected:
- General, Hero banner, Home sections, and Diagnostics groups render with the default sections.
- Moving a section down and clicking Save shows "Settings saved.", and the order persists after a reload.
- Choosing Hero source "A collection" without picking one and saving shows the server's validation error.

- [ ] **Step 6: Commit**

```bash
git add client src tests
git commit -m "feat: add Lumen admin dashboard page" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 21: Routing, navigation hooks, takeover, and bootstrap

**Files:**
- Create:
  - `client/src/takeover/routes.ts`, `client/src/takeover/navigation.ts`, `client/src/takeover/takeover.ts`, `client/src/takeover/bootstrap.ts`
  - `client/src/views/context.ts`
- Test:
  - `client/src/takeover/routes.test.ts`, `client/src/takeover/navigation.test.ts`, `client/src/takeover/takeover.test.ts`, `client/src/takeover/bootstrap.test.ts`

**Interfaces:**
- Consumes: compat and `LumenApi` (Task 19).
- Produces:
  - `type Route = { kind: 'home' } | { kind: 'details'; id: string } | { kind: 'other' }`, `type TakeoverRoute`, `parseRoute(hash)`
  - `onNavigate(listener, win?) => unsubscribe`
  - `class Takeover(options: TakeoverOptions)` with `handle(route)` and `release()`
  - `interface ViewContext { api; client; config; userId; layout; onFallback(); navigate(hash) }` in `views/context.ts`
  - `startLumen({ mount, unmount, win?, doc?, pollMs?, timeoutMs? }) => stop`
  - `applyAccent(doc, color)`

- [ ] **Step 1: Write the failing tests**

`client/src/takeover/routes.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { parseRoute } from './routes';

describe('parseRoute', () => {
  it.each([
    ['#/home', { kind: 'home' }],
    ['#!/home', { kind: 'home' }],
    ['#/home?tab=0', { kind: 'home' }],
    ['#/home?tab=1', { kind: 'other' }],
    ['#/details?id=0123456789abcdef0123456789abcdef&serverId=s', { kind: 'details', id: '0123456789abcdef0123456789abcdef' }],
    ['#/details?id=not-an-id', { kind: 'other' }],
    ['#/details', { kind: 'other' }],
    ['#/movies?topParentId=x', { kind: 'other' }],
    ['', { kind: 'other' }],
  ])('%s', (hash, expected) => {
    expect(parseRoute(hash)).toEqual(expected);
  });
});
```

`client/src/takeover/navigation.test.ts`:
```ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import { onNavigate } from './navigation';

describe('onNavigate', () => {
  const stops: (() => void)[] = [];
  afterEach(() => stops.splice(0).forEach((stop) => stop()));

  it('reports pushState and replaceState navigations once per new href', () => {
    const listener = vi.fn();
    stops.push(onNavigate(listener));

    history.pushState(null, '', '#/details?id=a');
    history.replaceState(null, '', '#/details?id=a');
    history.replaceState(null, '', '#/home');

    expect(listener.mock.calls.map(([href]) => new URL(href as string).hash)).toEqual(['#/details?id=a', '#/home']);
  });

  it('stops reporting after unsubscribe', () => {
    const listener = vi.fn();
    const stop = onNavigate(listener);

    history.pushState(null, '', '#/x');
    stop();
    history.pushState(null, '', '#/y');
    window.dispatchEvent(new PopStateEvent('popstate'));

    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('wraps history methods only once', () => {
    stops.push(onNavigate(vi.fn()));
    const wrapped = history.pushState;
    stops.push(onNavigate(vi.fn()));

    expect(history.pushState).toBe(wrapped);
  });
});
```

`client/src/takeover/takeover.test.ts`:
```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ClientConfig } from '../api/types';
import { Takeover, type TakeoverOptions } from './takeover';

const config: ClientConfig = {
  Enabled: true,
  HomeTakeover: true,
  DetailsTakeover: false,
  AccentColor: '#f5a524',
  HeroIntervalSeconds: 8,
  TrailerPreview: true,
  TrailerDelaySeconds: 4,
  BuildHash: 'h',
};

function create(overrides: Partial<TakeoverOptions> = {}) {
  const options: TakeoverOptions = {
    config,
    win: window,
    doc: document,
    mount: vi.fn(),
    unmount: vi.fn(),
    selfTest: vi.fn(() => ({ ok: true, failed: [] })),
    report: vi.fn(),
    ...overrides,
  };
  return { takeover: new Takeover(options), options };
}

describe('Takeover', () => {
  beforeEach(() => history.replaceState(null, '', '#/home'));
  afterEach(() => {
    document.documentElement.className = '';
    document.getElementById('lmn-root')?.remove();
  });

  it('mounts home once into its own root and marks <html>', () => {
    const { takeover, options } = create();

    takeover.handle({ kind: 'home' });
    takeover.handle({ kind: 'home' });

    expect(document.getElementById('lmn-root')?.parentElement).toBe(document.body);
    expect(document.documentElement.classList.contains('lmn-active')).toBe(true);
    expect(document.documentElement.classList.contains('lmn-home')).toBe(true);
    expect(options.mount).toHaveBeenCalledTimes(1);
  });

  it('leaves disabled routes and other routes to the stock UI', () => {
    const { takeover, options } = create();

    takeover.handle({ kind: 'details', id: 'a' });
    takeover.handle({ kind: 'other' });

    expect(options.mount).not.toHaveBeenCalled();
    expect(document.documentElement.classList.contains('lmn-active')).toBe(false);
  });

  it('reports a failed compatibility check once and never takes over', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { takeover, options } = create({ selfTest: vi.fn(() => ({ ok: false, failed: ['stockPage'] })) });

    takeover.handle({ kind: 'home' });
    takeover.handle({ kind: 'home' });

    expect(options.report).toHaveBeenCalledTimes(1);
    expect(options.mount).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('release unmounts and clears classes', () => {
    const { takeover, options } = create();
    takeover.handle({ kind: 'home' });

    takeover.release();

    expect(options.unmount).toHaveBeenCalledTimes(1);
    expect(document.documentElement.className).toBe('');
  });

  it('a view fallback suppresses takeover for that URL until navigation', () => {
    let fallback: () => void = () => undefined;
    const { takeover, options } = create({
      mount: vi.fn((_route, _root, fb: () => void) => {
        fallback = fb;
      }),
    });
    takeover.handle({ kind: 'home' });

    fallback();
    takeover.handle({ kind: 'home' });
    expect(options.mount).toHaveBeenCalledTimes(1);
    expect(document.documentElement.classList.contains('lmn-active')).toBe(false);

    history.replaceState(null, '', '#/home?tab=0');
    takeover.handle({ kind: 'home' });
    expect(options.mount).toHaveBeenCalledTimes(2);
  });
});
```

`client/src/takeover/bootstrap.test.ts`:
```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeClient, routes, type FakeClient } from '../../test/fakeClient';
import { startLumen } from './bootstrap';

const clientConfig = {
  Enabled: true,
  HomeTakeover: true,
  DetailsTakeover: true,
  AccentColor: '#112233',
  HeroIntervalSeconds: 8,
  TrailerPreview: true,
  TrailerDelaySeconds: 4,
  BuildHash: 'h',
};

describe('startLumen', () => {
  let client: FakeClient;
  let stop: () => void = () => undefined;

  beforeEach(() => {
    document.body.innerHTML = '<div id="reactRoot"><div class="skinBody"></div></div>';
    document.documentElement.className = 'layout-desktop';
    history.replaceState(null, '', '#/home');
    client = createFakeClient(routes({ 'Lumen/ClientConfig': clientConfig, 'Lumen/Diagnostics': {} }));
    Object.assign(window, { ApiClient: client, __LUMEN_FORCE_COMPAT_FAIL__: false });
  });

  afterEach(() => {
    stop();
    vi.restoreAllMocks();
    document.getElementById('lmn-root')?.remove();
    document.documentElement.removeAttribute('style');
  });

  const start = () => {
    const mount = vi.fn();
    const unmount = vi.fn();
    stop = startLumen({ mount, unmount, pollMs: 5, timeoutMs: 1000 });
    return { mount, unmount };
  };

  it('waits for a signed-in user, then takes over home and applies the accent', async () => {
    client.userId = null;
    const { mount } = start();
    await new Promise((r) => setTimeout(r, 20));
    expect(mount).not.toHaveBeenCalled();

    client.userId = 'user1';
    await vi.waitFor(() => expect(mount).toHaveBeenCalledTimes(1));
    expect(mount.mock.calls[0]![0]).toEqual({ kind: 'home' });
    expect(mount.mock.calls[0]![2]).toMatchObject({ userId: 'user1', layout: 'desktop' });
    expect(document.documentElement.style.getPropertyValue('--lmn-accent')).toBe('#112233');
  });

  it('releases takeover when the user signs out', async () => {
    const { mount, unmount } = start();
    await vi.waitFor(() => expect(mount).toHaveBeenCalled());

    client.userId = null;
    history.pushState(null, '', '#/login');

    await vi.waitFor(() => expect(unmount).toHaveBeenCalled());
    expect(document.documentElement.classList.contains('lmn-active')).toBe(false);
  });

  it('starts a fresh session for a different user', async () => {
    const { mount } = start();
    await vi.waitFor(() => expect(mount).toHaveBeenCalledTimes(1));

    client.userId = 'user2';
    history.pushState(null, '', '#/home?tab=0');

    await vi.waitFor(() => expect(mount).toHaveBeenCalledTimes(2));
    expect(mount.mock.calls[1]![2]).toMatchObject({ userId: 'user2' });
  });

  it('fails open when the client config cannot be loaded', async () => {
    client.respond = () => Promise.reject(new Error('down'));
    const { mount } = start();

    await new Promise((r) => setTimeout(r, 30));
    expect(mount).not.toHaveBeenCalled();
  });

  it('does nothing when Lumen is disabled', async () => {
    client.respond = routes({ 'Lumen/ClientConfig': { ...clientConfig, Enabled: false } });
    const { mount } = start();

    await new Promise((r) => setTimeout(r, 30));
    expect(mount).not.toHaveBeenCalled();
  });

  it('reports compatibility failures to the server', async () => {
    Object.assign(window, { __LUMEN_FORCE_COMPAT_FAIL__: true });
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    start();

    await vi.waitFor(() => expect(client.requests.some((r) => r.url.endsWith('Lumen/Diagnostics'))).toBe(true));
    const report = client.requests.find((r) => r.url.endsWith('Lumen/Diagnostics'))!;
    expect(JSON.parse(report.data!)).toMatchObject({ ServerVersion: '12.1.0', FailedChecks: ['forced'] });
  });
});
```

Run: `cd client && npx vitest run src/takeover; cd ..`

Expected: FAIL with `Failed to resolve import "./routes"` (and the other modules).

- [ ] **Step 2: Implement**

`client/src/takeover/routes.ts`:
```ts
export type Route = { kind: 'home' } | { kind: 'details'; id: string } | { kind: 'other' };
export type TakeoverRoute = Exclude<Route, { kind: 'other' }>;

const ITEM_ID = /^[0-9a-f]{32}$|^[0-9a-f-]{36}$/i;

/** Maps jellyfin-web hash routes to Lumen routes. Home tabs other than 0 (e.g. Favorites) stay stock. */
export function parseRoute(hash: string): Route {
  const value = hash.replace(/^#!?/, '');
  const queryStart = value.indexOf('?');
  const path = (queryStart < 0 ? value : value.slice(0, queryStart)).toLowerCase();
  const query = new URLSearchParams(queryStart < 0 ? '' : value.slice(queryStart + 1));

  if (path === '/home') {
    const tab = query.get('tab');
    return tab === null || tab === '0' ? { kind: 'home' } : { kind: 'other' };
  }
  if (path === '/details') {
    const id = query.get('id');
    if (id && ITEM_ID.test(id)) return { kind: 'details', id };
  }
  return { kind: 'other' };
}
```

`client/src/takeover/navigation.ts`:
```ts
const NAVIGATE_EVENT = 'lmn:navigate';
type HookedWindow = Window & { __lmnNavigationHooked?: boolean };

/**
 * jellyfin-web navigates with history.pushState, which fires no event. Wrap pushState/replaceState once so they
 * emit one, and also listen to popstate/hashchange. Listeners are called once per new href.
 */
export function onNavigate(listener: (href: string) => void, win: Window = window): () => void {
  installHooks(win);
  let last = win.location.href;
  const handler = (): void => {
    const href = win.location.href;
    if (href === last) return;
    last = href;
    listener(href);
  };
  const events = [NAVIGATE_EVENT, 'popstate', 'hashchange'];
  events.forEach((e) => win.addEventListener(e, handler));
  return () => events.forEach((e) => win.removeEventListener(e, handler));
}

function installHooks(win: Window): void {
  const hooked = win as HookedWindow;
  if (hooked.__lmnNavigationHooked) return;
  hooked.__lmnNavigationHooked = true;
  for (const method of ['pushState', 'replaceState'] as const) {
    const original = win.history[method].bind(win.history);
    win.history[method] = (...args: Parameters<History['pushState']>) => {
      original(...args);
      win.dispatchEvent(new Event(NAVIGATE_EVENT));
    };
  }
}
```

`client/src/views/context.ts`:
```ts
import type { LumenApi } from '../api/lumenApi';
import type { ClientConfig } from '../api/types';
import type { JellyfinApiClient, Layout } from '../compat/jellyfin';

/** Everything a view needs; created per signed-in user by the bootstrap. */
export interface ViewContext {
  api: LumenApi;
  client: JellyfinApiClient;
  config: ClientConfig;
  userId: string;
  layout: Layout;
  /** Give the current route back to the stock UI (on errors or unsupported items). */
  onFallback: () => void;
  navigate: (hash: string) => void;
}
```

`client/src/takeover/takeover.ts`:
```ts
import type { ClientConfig } from '../api/types';
import { type CompatReport, getAppBarHeight } from '../compat/jellyfin';
import type { Route, TakeoverRoute } from './routes';

export interface TakeoverOptions {
  config: ClientConfig;
  win: Window;
  doc: Document;
  mount: (route: TakeoverRoute, root: HTMLElement, fallback: () => void) => void;
  unmount: (root: HTMLElement) => void;
  selfTest: () => CompatReport;
  report: (report: CompatReport) => void;
}

const ROUTE_CLASSES = ['lmn-active', 'lmn-home', 'lmn-details'];

/** Owns #lmn-root and the <html> classes that hide the stock page. Never touches jellyfin-web's own DOM. */
export class Takeover {
  private root: HTMLElement | null = null;
  private mountedKey: string | null = null;
  private compat: CompatReport | null = null;
  private suppressedHref: string | null = null;

  constructor(private readonly options: TakeoverOptions) {}

  handle(route: Route): void {
    const { win, doc } = this.options;
    const href = win.location.href;
    if (this.suppressedHref !== null && this.suppressedHref !== href) this.suppressedHref = null;

    if (route.kind === 'other' || !this.isEnabled(route) || this.suppressedHref === href || !this.isCompatible()) {
      this.release();
      return;
    }

    const root = this.ensureRoot();
    doc.documentElement.classList.remove(...ROUTE_CLASSES);
    doc.documentElement.classList.add('lmn-active', route.kind === 'home' ? 'lmn-home' : 'lmn-details');
    root.style.setProperty('--lmn-top-offset', `${getAppBarHeight(doc)}px`);

    const key = route.kind === 'home' ? 'home' : `details:${route.id}`;
    if (this.mountedKey !== key) {
      this.mountedKey = key;
      doc.documentElement.scrollTop = 0;
      doc.body.scrollTop = 0;
      this.options.mount(route, root, () => this.fallback(href));
    }
  }

  release(): void {
    this.options.doc.documentElement.classList.remove(...ROUTE_CLASSES);
    if (this.root && this.mountedKey !== null) this.options.unmount(this.root);
    this.mountedKey = null;
  }

  private fallback(href: string): void {
    this.suppressedHref = href;
    this.release();
  }

  private isEnabled(route: TakeoverRoute): boolean {
    return route.kind === 'home' ? this.options.config.HomeTakeover : this.options.config.DetailsTakeover;
  }

  private isCompatible(): boolean {
    if (!this.compat) {
      this.compat = this.options.selfTest();
      if (!this.compat.ok) {
        console.warn('[Lumen] jellyfin-web compatibility check failed; using the stock UI.', this.compat.failed);
        this.options.report(this.compat);
      }
    }
    return this.compat.ok;
  }

  private ensureRoot(): HTMLElement {
    if (!this.root || !this.root.isConnected) {
      const existing = this.options.doc.getElementById('lmn-root');
      this.root = existing ?? this.options.doc.createElement('div');
      this.root.id = 'lmn-root';
      if (!existing) this.options.doc.body.appendChild(this.root);
    }
    return this.root;
  }
}
```

`client/src/takeover/bootstrap.ts`:
```ts
import { LumenApi } from '../api/lumenApi';
import type { ClientConfig } from '../api/types';
import { getApiClient, getLayout, getServerVersion, navigateTo, selfTest, type JellyfinApiClient } from '../compat/jellyfin';
import type { ViewContext } from '../views/context';
import { onNavigate } from './navigation';
import { parseRoute, type TakeoverRoute } from './routes';
import { Takeover } from './takeover';

export interface BootstrapOptions {
  mount: (route: TakeoverRoute, root: HTMLElement, ctx: ViewContext) => void;
  unmount: (root: HTMLElement) => void;
  win?: Window;
  doc?: Document;
  pollMs?: number;
  timeoutMs?: number;
}

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

export function applyAccent(doc: Document, color: string): void {
  if (HEX_COLOR.test(color)) doc.documentElement.style.setProperty('--lmn-accent', color);
}

/** window.ApiClient exists before sign-in but has no user; wait until it does (or give up). */
function waitForUser(win: Window, pollMs: number, timeoutMs: number): Promise<void> {
  const started = Date.now();
  return new Promise((resolve) => {
    const check = (): void => {
      if (getApiClient(win)?.getCurrentUserId() || Date.now() - started >= timeoutMs) resolve();
      else win.setTimeout(check, pollMs);
    };
    check();
  });
}

interface Session {
  userId: string;
  /** null = Lumen is disabled or unavailable for this user; the stock UI is used everywhere. */
  takeover: Takeover | null;
}

/** Starts Lumen: one session per signed-in user, re-evaluated on every navigation. Returns a stop function. */
export function startLumen(options: BootstrapOptions): () => void {
  const win = options.win ?? window;
  const doc = options.doc ?? document;
  let session: Session | null = null;
  let starting: Promise<void> | null = null;
  let stopped = false;

  const createSession = async (client: JellyfinApiClient, userId: string): Promise<Session> => {
    const api = new LumenApi(client);
    let config: ClientConfig;
    try {
      config = await api.getClientConfig();
    } catch {
      return { userId, takeover: null };
    }
    if (!config.Enabled) return { userId, takeover: null };

    applyAccent(doc, config.AccentColor);
    const takeover = new Takeover({
      config,
      win,
      doc,
      selfTest: () => selfTest(win, doc),
      report: (report) => {
        void getServerVersion(client)
          .then((ServerVersion) =>
            api.postDiagnostics({
              Client: `${getLayout(doc)} ${win.navigator.userAgent}`.slice(0, 100),
              ServerVersion,
              FailedChecks: report.failed,
            }),
          )
          .catch(() => undefined);
      },
      mount: (route, root, fallback) =>
        options.mount(route, root, {
          api,
          client,
          config,
          userId,
          layout: getLayout(doc),
          onFallback: fallback,
          navigate: (hash) => navigateTo(hash, win),
        }),
      unmount: options.unmount,
    });
    return { userId, takeover };
  };

  const sync = async (): Promise<void> => {
    if (stopped) return;
    const client = getApiClient(win);
    const userId = client?.getCurrentUserId() ?? null;

    if (session && session.userId !== userId) {
      session.takeover?.release();
      session = null;
    }
    if (!session && client && userId) {
      starting ??= createSession(client, userId)
        .then((created) => {
          session = created;
        })
        .finally(() => {
          starting = null;
        });
      await starting;
    }
    if (!stopped) session?.takeover?.handle(parseRoute(win.location.hash));
  };

  const stopNavigation = onNavigate(() => void sync(), win);
  void waitForUser(win, options.pollMs ?? 100, options.timeoutMs ?? 60_000).then(sync);

  return () => {
    stopped = true;
    stopNavigation();
    session?.takeover?.release();
  };
}
```

- [ ] **Step 3: Run the client checks**

Expected: all takeover tests pass (9 route cases, 3 navigation, 5 takeover, and 6 bootstrap tests), plus the earlier suites.

- [ ] **Step 4: Commit**

```bash
git add client
git commit -m "feat(client): add route detection, navigation hooks, takeover, and bootstrap" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 22: Shared components and theme

**Files:**
- Create:
  - `client/src/components/images.ts`, `client/src/components/ProgressBar.tsx`, `client/src/components/Card.tsx`, `client/src/components/ErrorBoundary.tsx`
- Modify: `client/src/styles/lumen.css` (the full theme)
- Test: `client/src/components/images.test.ts`, `client/src/components/Card.test.tsx`, `client/src/components/ErrorBoundary.test.tsx`

**Interfaces:**
- Consumes: `BaseItem` and `JellyfinApiClient` (Task 19).
- Produces:
  - Images:
    - `type ImageType`, `interface ImageRef`, `type CardVariant = 'poster' | 'thumb'`, `CARD_SIZES`
    - `resolveImage(item, preferred)`, `imageUrl(client, ref, size, dpr?)`, `cardImage(item, variant)`
  - `ProgressBar({ percent })` and `playedPercent(item)`
  - `Card({ item, client, variant, caption?, onSelect })`, which renders `<button class="lmn-card" data-item-id>`
  - `ErrorBoundary({ fallback, onError?, children })`

- [ ] **Step 1: Write the failing tests**

`client/src/components/images.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { createFakeClient } from '../../test/fakeClient';
import type { BaseItem } from '../api/types';
import { cardImage, imageUrl, resolveImage } from './images';

const episode: BaseItem = {
  Id: 'ep',
  Name: 'Pilot',
  Type: 'Episode',
  ImageTags: { Primary: 'p1' },
  ParentBackdropItemId: 'series',
  ParentBackdropImageTags: ['b1'],
  ParentLogoItemId: 'series',
  ParentLogoImageTag: 'l1',
};

describe('images', () => {
  it('prefers own images and falls back to parent images', () => {
    expect(resolveImage(episode, ['Backdrop'])).toEqual({ itemId: 'series', type: 'Backdrop', tag: 'b1' });
    expect(resolveImage(episode, ['Logo'])).toEqual({ itemId: 'series', type: 'Logo', tag: 'l1' });
    expect(resolveImage(episode, ['Primary'])).toEqual({ itemId: 'ep', type: 'Primary', tag: 'p1' });
    expect(resolveImage({ Id: 'x', Name: 'x', Type: 'Movie' }, ['Primary', 'Backdrop'])).toBeNull();
  });

  it('requests images at rendered size times device pixel ratio, rounded up', () => {
    const url = imageUrl(createFakeClient(), { itemId: 'i', type: 'Primary', tag: 't' }, { width: 180, height: 270 }, 1.5);

    expect(url).toBe('http://jf/Items/i/Images/Primary?fillWidth=270&fillHeight=405&quality=90&tag=t');
  });

  it('uses episode stills for thumb cards and posters for poster cards', () => {
    expect(cardImage(episode, 'thumb')?.type).toBe('Primary');
    expect(cardImage({ Id: 'm', Name: 'm', Type: 'Movie', BackdropImageTags: ['b'] }, 'thumb')?.type).toBe('Backdrop');
    expect(cardImage({ Id: 'm', Name: 'm', Type: 'Movie', BackdropImageTags: ['b'] }, 'poster')).toBeNull();
  });
});
```

`client/src/components/Card.test.tsx`:
```tsx
import { fireEvent, render, screen } from '@testing-library/preact';
import { describe, expect, it, vi } from 'vitest';
import { createFakeClient } from '../../test/fakeClient';
import type { BaseItem } from '../api/types';
import { Card } from './Card';

const movie: BaseItem = { Id: 'm1', Name: 'Lumen Alpha', Type: 'Movie', ImageTags: { Primary: 'tag1' } };

describe('Card', () => {
  it('renders a lazy poster image and selects on click', () => {
    const onSelect = vi.fn();
    render(<Card item={movie} client={createFakeClient()} variant="poster" onSelect={onSelect} />);

    const button = screen.getByRole('button', { name: 'Lumen Alpha' });
    const img = button.querySelector('img')!;
    expect(img.getAttribute('src')).toContain('Items/m1/Images/Primary');
    expect(img.getAttribute('loading')).toBe('lazy');
    fireEvent.click(button);
    expect(onSelect).toHaveBeenCalledWith(movie);
  });

  it('renders a title placeholder when the item has no image', () => {
    render(<Card item={{ Id: 'x', Name: 'No Art', Type: 'Movie' }} client={createFakeClient()} variant="poster" onSelect={vi.fn()} />);

    expect(screen.getByRole('button').querySelector('img')).toBeNull();
    expect(screen.getByText('No Art')).toBeInTheDocument();
  });

  it('shows progress for partially watched items and includes the caption in its label', () => {
    const item: BaseItem = { ...movie, RunTimeTicks: 100, UserData: { PlaybackPositionTicks: 40 } };
    render(<Card item={item} client={createFakeClient()} variant="thumb" caption="S1:E2" onSelect={vi.fn()} />);

    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '40');
    expect(screen.getByRole('button', { name: 'Lumen Alpha, S1:E2' })).toBeInTheDocument();
  });
});
```

`client/src/components/ErrorBoundary.test.tsx`:
```tsx
import { render, screen } from '@testing-library/preact';
import { describe, expect, it, vi } from 'vitest';
import { ErrorBoundary } from './ErrorBoundary';

function Boom(): never {
  throw new Error('boom');
}

describe('ErrorBoundary', () => {
  it('renders the fallback and reports the error', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const onError = vi.fn();

    render(
      <ErrorBoundary fallback={<p>fallback</p>} onError={onError}>
        <Boom />
      </ErrorBoundary>,
    );

    expect(screen.getByText('fallback')).toBeInTheDocument();
    expect(onError).toHaveBeenCalledWith(expect.any(Error));
  });
});
```

Run: `cd client && npx vitest run src/components; cd ..`

Expected: FAIL with unresolved imports.

- [ ] **Step 2: Implement**

`client/src/components/images.ts`:
```ts
import type { BaseItem } from '../api/types';
import type { JellyfinApiClient } from '../compat/jellyfin';

export type ImageType = 'Primary' | 'Backdrop' | 'Logo' | 'Thumb';

export interface ImageRef {
  itemId: string;
  type: ImageType;
  tag: string;
}

export type CardVariant = 'poster' | 'thumb';

export const CARD_SIZES: Record<CardVariant, { width: number; height: number }> = {
  poster: { width: 180, height: 270 },
  thumb: { width: 320, height: 180 },
};

/** The first available image among `preferred`, using the item's own image or its parent's (series). */
export function resolveImage(item: BaseItem, preferred: readonly ImageType[]): ImageRef | null {
  for (const type of preferred) {
    const ref = ownImage(item, type) ?? parentImage(item, type);
    if (ref) return ref;
  }
  return null;
}

function ownImage(item: BaseItem, type: ImageType): ImageRef | null {
  const tag = type === 'Backdrop' ? item.BackdropImageTags?.[0] : item.ImageTags?.[type];
  return tag ? { itemId: item.Id, type, tag } : null;
}

function parentImage(item: BaseItem, type: ImageType): ImageRef | null {
  const pick = (itemId: string | undefined, tag: string | undefined): ImageRef | null =>
    itemId && tag ? { itemId, type, tag } : null;
  switch (type) {
    case 'Backdrop':
      return pick(item.ParentBackdropItemId, item.ParentBackdropImageTags?.[0]);
    case 'Logo':
      return pick(item.ParentLogoItemId, item.ParentLogoImageTag);
    case 'Thumb':
      return pick(item.ParentThumbItemId, item.ParentThumbImageTag);
    default:
      return null;
  }
}

/** Image URL sized for the rendered box. Dimensions must be integers or the server rejects the request. */
export function imageUrl(
  client: Pick<JellyfinApiClient, 'getUrl'>,
  ref: ImageRef,
  size: { width?: number; height?: number },
  dpr: number = globalThis.devicePixelRatio || 1,
): string {
  return client.getUrl(`Items/${ref.itemId}/Images/${ref.type}`, {
    fillWidth: size.width ? Math.ceil(size.width * dpr) : undefined,
    fillHeight: size.height ? Math.ceil(size.height * dpr) : undefined,
    quality: 90,
    tag: ref.tag,
  });
}

export function cardImage(item: BaseItem, variant: CardVariant): ImageRef | null {
  if (variant === 'poster') return resolveImage(item, ['Primary']);
  return item.Type === 'Episode'
    ? resolveImage(item, ['Primary', 'Thumb', 'Backdrop'])
    : resolveImage(item, ['Thumb', 'Backdrop', 'Primary']);
}
```

`client/src/components/ProgressBar.tsx`:
```tsx
import type { BaseItem } from '../api/types';

export function playedPercent(item: BaseItem): number {
  if (item.UserData?.PlayedPercentage !== undefined) return item.UserData.PlayedPercentage;
  const position = item.UserData?.PlaybackPositionTicks ?? 0;
  return item.RunTimeTicks ? (position / item.RunTimeTicks) * 100 : 0;
}

export function ProgressBar({ percent }: { percent: number }) {
  const value = Math.max(0, Math.min(100, percent));
  return (
    <span class="lmn-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(value)}>
      <span class="lmn-progress__fill" style={{ width: `${value}%` }} />
    </span>
  );
}
```

`client/src/components/Card.tsx`:
```tsx
import type { BaseItem } from '../api/types';
import type { JellyfinApiClient } from '../compat/jellyfin';
import { CARD_SIZES, type CardVariant, cardImage, imageUrl } from './images';
import { ProgressBar, playedPercent } from './ProgressBar';

interface CardProps {
  item: BaseItem;
  client: Pick<JellyfinApiClient, 'getUrl'>;
  variant: CardVariant;
  caption?: string;
  onSelect: (item: BaseItem) => void;
}

export function Card({ item, client, variant, caption, onSelect }: CardProps) {
  const ref = cardImage(item, variant);
  const size = CARD_SIZES[variant];
  const progress = playedPercent(item);
  return (
    <button
      type="button"
      class={`lmn-card lmn-card--${variant}`}
      data-item-id={item.Id}
      aria-label={caption ? `${item.Name}, ${caption}` : item.Name}
      onClick={() => onSelect(item)}
    >
      <span class="lmn-card__art">
        {ref ? (
          <img src={imageUrl(client, ref, size)} alt="" loading="lazy" decoding="async" width={size.width} height={size.height} />
        ) : (
          <span class="lmn-card__placeholder">{item.Name}</span>
        )}
        {progress > 0 && progress < 100 && <ProgressBar percent={progress} />}
      </span>
      {caption && <span class="lmn-card__caption">{caption}</span>}
    </button>
  );
}
```

`client/src/components/ErrorBoundary.tsx`:
```tsx
import { Component, type ComponentChildren } from 'preact';

interface Props {
  fallback: ComponentChildren;
  onError?: (error: unknown) => void;
  children: ComponentChildren;
}

/** Contains render errors: a failing row or view shows `fallback` instead of breaking the page. */
export class ErrorBoundary extends Component<Props, { failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  override componentDidCatch(error: unknown): void {
    console.error('[Lumen]', error);
    this.props.onError?.(error);
  }

  override render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}
```

Replace `client/src/styles/lumen.css` with the full theme:
```css
/* Lumen theme. Every selector targets Lumen-owned elements or is scoped by html.lmn-active. */
:root {
  --lmn-accent: #f5a524;
  --lmn-bg: var(--jf-palette-background-default, #101010);
  --lmn-surface: var(--jf-palette-background-paper, #202020);
  --lmn-text: var(--jf-palette-text-primary, #fff);
  --lmn-text-dim: var(--jf-palette-text-secondary, rgba(255, 255, 255, 0.7));
  --lmn-radius: 6px;
  --lmn-gutter: clamp(16px, 4vw, 56px);
}

/* Hide the stock page (both layouts) while Lumen owns the route. The stock page keeps running hidden. */
html.lmn-active #reactRoot .skinBody,
html.lmn-active .backdropContainer {
  display: none !important;
}

/* Let the stock app bar float over Lumen's hero. */
html.lmn-active .MuiAppBar-root,
html.lmn-active .skinHeader {
  background: linear-gradient(to bottom, rgba(0, 0, 0, 0.75), transparent) !important;
  box-shadow: none !important;
}

#lmn-root {
  display: none;
}

html.lmn-active #lmn-root {
  display: block;
  position: relative;
  min-height: 100vh;
  padding-bottom: 96px; /* clears the now-playing bar */
  background: var(--lmn-bg);
  color: var(--lmn-text);
}

/* Buttons */
.lmn-button {
  display: inline-flex;
  align-items: center;
  gap: 0.5em;
  min-height: 40px;
  padding: 0.6em 1.4em;
  border: 0;
  border-radius: var(--lmn-radius);
  background: rgba(109, 109, 110, 0.7);
  color: #fff;
  font: inherit;
  font-weight: 600;
  cursor: pointer;
}
.lmn-button:hover {
  background: rgba(109, 109, 110, 0.5);
}
.lmn-button--primary {
  background: #fff;
  color: #000;
}
.lmn-button--primary:hover {
  background: rgba(255, 255, 255, 0.8);
}
.lmn-button[aria-pressed='true'] {
  box-shadow: inset 0 0 0 2px var(--lmn-accent);
}
.lmn-button:focus-visible,
.lmn-card:focus-visible,
.lmn-episode:focus-visible,
.lmn-person:focus-visible,
.lmn-season-select:focus-visible {
  outline: 3px solid var(--lmn-accent);
  outline-offset: 2px;
}

/* Hero */
.lmn-hero {
  position: relative;
  height: min(80vh, 56.25vw);
  min-height: 420px;
  overflow: hidden;
}
.lmn-hero__backdrop,
.lmn-hero__video {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  animation: lmn-fade 0.6s ease;
}
.lmn-hero__trailer {
  position: absolute;
  inset: 0;
}
.lmn-hero__scrim {
  position: absolute;
  inset: 0;
  background:
    linear-gradient(77deg, rgba(0, 0, 0, 0.75) 0%, transparent 60%),
    linear-gradient(to top, var(--lmn-bg) 0%, transparent 30%);
}
.lmn-hero__content {
  position: absolute;
  left: var(--lmn-gutter);
  bottom: 18%;
  width: min(560px, 80vw);
}
.lmn-hero__logo {
  display: block;
  max-width: 100%;
  max-height: 160px;
  object-fit: contain;
  object-position: left bottom;
}
.lmn-hero__title {
  margin: 0;
  font-size: clamp(2rem, 5vw, 3.5rem);
  line-height: 1.1;
}
.lmn-hero__overview {
  display: -webkit-box;
  margin: 1rem 0;
  overflow: hidden;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.6);
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
}
.lmn-hero__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
}
.lmn-hero__dots {
  position: absolute;
  right: var(--lmn-gutter);
  bottom: 18%;
  display: flex;
  gap: 6px;
}
.lmn-hero__dot {
  width: 10px;
  height: 10px;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.4);
  cursor: pointer;
}
.lmn-hero__dot.is-active {
  background: var(--lmn-accent);
}

/* Home */
.lmn-home--no-hero {
  padding-top: calc(var(--lmn-top-offset, 56px) + 16px);
}
.lmn-home--loading,
.lmn-details--loading {
  min-height: 100vh;
}
.lmn-row {
  position: relative;
  margin: 0 0 2rem;
}
.lmn-hero + .lmn-row {
  margin-top: -4vw;
}
.lmn-row__title {
  margin: 0 var(--lmn-gutter) 0.5rem;
  font-size: clamp(1rem, 1.6vw, 1.4rem);
  font-weight: 600;
}
.lmn-row__scroller {
  display: flex;
  gap: 8px;
  padding: 4px var(--lmn-gutter) 12px;
  overflow-x: auto;
  overscroll-behavior-x: contain;
  scroll-snap-type: x proximity;
  scrollbar-width: none;
}
.lmn-row__scroller::-webkit-scrollbar {
  display: none;
}

/* Cards */
.lmn-card {
  flex: 0 0 auto;
  padding: 0;
  border: 0;
  background: none;
  color: inherit;
  text-align: left;
  cursor: pointer;
  scroll-snap-align: start;
  transition: transform 0.2s ease;
}
.lmn-card:hover,
.lmn-card:focus-visible {
  transform: scale(1.05);
  z-index: 1;
}
.lmn-card__art {
  position: relative;
  display: block;
  overflow: hidden;
  border-radius: var(--lmn-radius);
  background: var(--lmn-surface);
}
.lmn-card--poster .lmn-card__art {
  width: 180px;
  aspect-ratio: 2 / 3;
}
.lmn-card--thumb .lmn-card__art {
  width: 320px;
  aspect-ratio: 16 / 9;
}
.lmn-card__art img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.lmn-card__placeholder {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0.5rem;
  color: var(--lmn-text-dim);
  font-size: 0.9rem;
  text-align: center;
}
.lmn-card__caption {
  display: block;
  max-width: 320px;
  margin-top: 0.35rem;
  overflow: hidden;
  color: var(--lmn-text-dim);
  font-size: 0.85rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* Progress */
.lmn-progress {
  position: absolute;
  right: 0;
  bottom: 0;
  left: 0;
  display: block;
  height: 4px;
  background: rgba(255, 255, 255, 0.25);
}
.lmn-progress__fill {
  display: block;
  height: 100%;
  background: var(--lmn-accent);
}
.lmn-button .lmn-progress {
  position: static;
  width: 60px;
  height: 3px;
}

/* Details */
.lmn-details__header {
  position: relative;
  display: flex;
  align-items: flex-end;
  min-height: min(75vh, 56.25vw);
}
.lmn-details__backdrop {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.lmn-details__scrim {
  position: absolute;
  inset: 0;
  background:
    linear-gradient(77deg, rgba(0, 0, 0, 0.85) 0%, transparent 70%),
    linear-gradient(to top, var(--lmn-bg) 0%, transparent 40%);
}
.lmn-details__info {
  position: relative;
  max-width: 720px;
  padding: calc(var(--lmn-top-offset, 56px) + 2rem) var(--lmn-gutter) 2rem;
}
.lmn-details__logo {
  display: block;
  max-width: min(480px, 100%);
  max-height: 140px;
  object-fit: contain;
  object-position: left bottom;
}
.lmn-details__title {
  margin: 0;
  font-size: clamp(2rem, 4.5vw, 3.2rem);
}
.lmn-details__meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.6rem;
  margin: 0.75rem 0;
  color: var(--lmn-text-dim);
}
.lmn-badge {
  padding: 0 0.4em;
  border: 1px solid var(--lmn-text-dim);
  border-radius: 3px;
  font-size: 0.8em;
}
.lmn-details__overview {
  line-height: 1.5;
}
.lmn-details__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
  margin-top: 1rem;
}
.lmn-toast {
  margin: 1rem var(--lmn-gutter);
  padding: 0.75rem 1rem;
  border-left: 4px solid var(--lmn-accent);
  background: var(--lmn-surface);
}

/* Episodes */
.lmn-episodes-section {
  padding: 0 var(--lmn-gutter) 2rem;
}
.lmn-episodes-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
}
.lmn-season-select {
  padding: 0.5em 1em;
  border: 1px solid rgba(255, 255, 255, 0.2);
  border-radius: var(--lmn-radius);
  background: var(--lmn-surface);
  color: var(--lmn-text);
  font: inherit;
}
.lmn-episodes {
  margin: 0;
  padding: 0;
  list-style: none;
}
.lmn-episode {
  display: flex;
  gap: 1rem;
  width: 100%;
  padding: 1rem;
  border: 0;
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: var(--lmn-radius);
  background: none;
  color: inherit;
  text-align: left;
  cursor: pointer;
}
.lmn-episode:hover {
  background: var(--lmn-surface);
}
.lmn-episode__thumb {
  position: relative;
  flex: 0 0 240px;
  aspect-ratio: 16 / 9;
  overflow: hidden;
  border-radius: var(--lmn-radius);
  background: var(--lmn-surface);
}
.lmn-episode__thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.lmn-episode__body {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}
.lmn-episode__title {
  font-weight: 600;
}
.lmn-episode__runtime,
.lmn-episode__overview {
  color: var(--lmn-text-dim);
  font-size: 0.9rem;
}

/* Cast */
.lmn-person {
  flex: 0 0 auto;
  width: 120px;
  padding: 0;
  border: 0;
  background: none;
  color: inherit;
  text-align: center;
  cursor: pointer;
}
.lmn-person__photo {
  display: block;
  width: 120px;
  height: 120px;
  border-radius: 50%;
  background: var(--lmn-surface);
  object-fit: cover;
}
.lmn-person__name {
  display: block;
  margin-top: 0.4rem;
  font-size: 0.85rem;
}
.lmn-person__role {
  display: block;
  color: var(--lmn-text-dim);
  font-size: 0.75rem;
}

/* Small screens (official mobile apps) */
@media (max-width: 600px) {
  .lmn-hero {
    height: 70vh;
    min-height: 360px;
  }
  .lmn-hero__content {
    bottom: 10%;
  }
  .lmn-card--poster .lmn-card__art {
    width: 120px;
  }
  .lmn-card--thumb .lmn-card__art {
    width: 220px;
  }
  .lmn-button {
    min-height: 44px;
  }
  .lmn-episode {
    flex-direction: column;
  }
  .lmn-episode__thumb {
    flex-basis: auto;
    width: 100%;
  }
}

@media (prefers-reduced-motion: reduce) {
  .lmn-card,
  .lmn-hero__backdrop,
  .lmn-hero__video {
    transition: none;
    animation: none;
  }
}

@keyframes lmn-fade {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}
```

- [ ] **Step 3: Run the client checks**

Expected: the images (3), card (3), and error boundary (1) tests pass, and the size budget still passes.

- [ ] **Step 4: Commit**

```bash
git add client
git commit -m "feat(client): add cards, images, progress, error boundary, and theme" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 23: Playback and the hero (with trailer preview)

**Files:**
- Create:
  - `client/src/playback/play.ts`
  - `client/src/components/useVisible.ts`, `client/src/components/usePrefersReducedMotion.ts`
  - `client/src/views/home/Hero.tsx`, `client/src/views/home/TrailerPreview.tsx`
- Test: `client/src/playback/play.test.ts`, `client/src/views/home/Hero.test.tsx`, `client/src/views/home/TrailerPreview.test.tsx`

**Interfaces:**
- Consumes: `LumenApi` and compat (Task 19); `images` and `strings` (Tasks 8, 22).
- Produces:
  - Playback:
    - `class PlaybackError extends Error`
    - `findOwnSession(api, client): Promise<SessionInfo | null>`
    - `playItem(api, client, itemId, startPositionTicks?): Promise<void>`
    - `resumeTicks(item): number | undefined`
  - `Hero({ items, client, config, onPlay, onInfo })`
  - `TrailerPreview({ trailerId, delaySeconds, client })`
  - `useVisible(ref, threshold?)` and `usePrefersReducedMotion()`

- [ ] **Step 1: Write the failing tests**

`client/src/playback/play.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { createFakeClient, routes } from '../../test/fakeClient';
import { LumenApi } from '../api/lumenApi';
import type { AjaxRequest } from '../compat/jellyfin';
import { findOwnSession, PlaybackError, playItem, resumeTicks } from './play';

const deviceParam = (r: AjaxRequest): string | null => new URL(r.url).searchParams.get('deviceId');

describe('playback', () => {
  it('finds the own session by decoded device id and starts playback with a resume position', async () => {
    const client = createFakeClient(
      routes({
        Sessions: (r: AjaxRequest) => (deviceParam(r) === 'dev+ice' ? [{ Id: 's1', DeviceId: 'dev+ice', UserId: 'USER1' }] : []),
        'Sessions/s1/Playing': {},
      }),
    );

    await playItem(new LumenApi(client), client, 'item1', 500);

    expect(client.requests.at(-1)?.url).toBe('http://jf/Sessions/s1/Playing?playCommand=PlayNow&itemIds=item1&startPositionTicks=500');
  });

  it('falls back to the raw device id', async () => {
    const client = createFakeClient(
      routes({ Sessions: (r: AjaxRequest) => (deviceParam(r) === 'dev%2Bice' ? [{ Id: 's2', DeviceId: 'dev%2Bice' }] : []) }),
    );

    expect((await findOwnSession(new LumenApi(client), client))?.Id).toBe('s2');
  });

  it('fails closed on ambiguous sessions', async () => {
    const client = createFakeClient(
      routes({
        Sessions: [
          { Id: 'a', DeviceId: 'dev+ice' },
          { Id: 'b', DeviceId: 'dev+ice' },
        ],
      }),
    );

    await expect(playItem(new LumenApi(client), client, 'x')).rejects.toBeInstanceOf(PlaybackError);
  });

  it('computes resume ticks only for started items', () => {
    expect(resumeTicks({ Id: 'a', Name: 'a', Type: 'Movie', UserData: { PlaybackPositionTicks: 9 } })).toBe(9);
    expect(resumeTicks({ Id: 'a', Name: 'a', Type: 'Movie' })).toBeUndefined();
  });
});
```

`client/src/views/home/TrailerPreview.test.tsx`:
```tsx
import { act, render } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeClient } from '../../../test/fakeClient';
import { TrailerPreview } from './TrailerPreview';

describe('TrailerPreview', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
  });

  it('starts a muted, authenticated, static trailer after the delay', () => {
    const { container } = render(<TrailerPreview trailerId="t1" delaySeconds={4} client={createFakeClient()} />);
    expect(container.querySelector('video')).toBeNull();

    act(() => vi.advanceTimersByTime(4000));

    const video = container.querySelector('video')!;
    expect(video.muted).toBe(true);
    expect(video.getAttribute('src')).toBe('http://jf/Videos/t1/stream?static=true&ApiKey=token1');
  });

  it('removes the video on error so the backdrop shows', () => {
    const { container } = render(<TrailerPreview trailerId="t1" delaySeconds={0} client={createFakeClient()} />);
    act(() => vi.advanceTimersByTime(0));

    act(() => {
      container.querySelector('video')!.dispatchEvent(new Event('error'));
    });

    expect(container.querySelector('video')).toBeNull();
  });

  it('stops when the page becomes hidden', () => {
    const { container } = render(<TrailerPreview trailerId="t1" delaySeconds={0} client={createFakeClient()} />);
    act(() => vi.advanceTimersByTime(0));
    expect(container.querySelector('video')).not.toBeNull();

    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });

    expect(container.querySelector('video')).toBeNull();
  });
});
```

`client/src/views/home/Hero.test.tsx`:
```tsx
import { act, fireEvent, render, screen } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeClient } from '../../../test/fakeClient';
import type { ClientConfig, HeroItem } from '../../api/types';
import { Hero } from './Hero';

const config: ClientConfig = {
  Enabled: true,
  HomeTakeover: true,
  DetailsTakeover: true,
  AccentColor: '#f5a524',
  HeroIntervalSeconds: 8,
  TrailerPreview: true,
  TrailerDelaySeconds: 4,
  BuildHash: 'h',
};

const items: HeroItem[] = [
  { Item: { Id: 'a', Name: 'Alpha', Type: 'Movie', Overview: 'First', BackdropImageTags: ['b'], ImageTags: { Logo: 'l' } }, TrailerItemId: 't1' },
  { Item: { Id: 'b', Name: 'Beta', Type: 'Movie', BackdropImageTags: ['b'] }, TrailerItemId: null },
];

describe('Hero', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    Reflect.deleteProperty(window, 'matchMedia');
  });

  it('shows the first item with logo, overview, and actions', () => {
    const onPlay = vi.fn();
    const onInfo = vi.fn();
    render(<Hero items={items} client={createFakeClient()} config={config} onPlay={onPlay} onInfo={onInfo} />);

    expect(screen.getByRole('img', { name: 'Alpha' })).toBeInTheDocument();
    expect(screen.getByText('First')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Play' }));
    fireEvent.click(screen.getByRole('button', { name: 'More Info' }));
    expect(onPlay).toHaveBeenCalledWith(items[0]!.Item);
    expect(onInfo).toHaveBeenCalledWith(items[0]!.Item);
  });

  it('rotates on the configured interval and pauses while hovered', () => {
    const { container } = render(<Hero items={items} client={createFakeClient()} config={config} onPlay={vi.fn()} onInfo={vi.fn()} />);

    act(() => vi.advanceTimersByTime(8000));
    expect(screen.getByRole('heading', { name: 'Beta' })).toBeInTheDocument();

    fireEvent.mouseEnter(container.querySelector('.lmn-hero')!);
    act(() => vi.advanceTimersByTime(20000));
    expect(screen.getByRole('heading', { name: 'Beta' })).toBeInTheDocument();
  });

  it('renders a trailer slot only when enabled and the item has a trailer', () => {
    const { container, rerender } = render(<Hero items={items} client={createFakeClient()} config={config} onPlay={vi.fn()} onInfo={vi.fn()} />);
    expect(container.querySelector('.lmn-hero__trailer')).not.toBeNull();

    rerender(<Hero items={items} client={createFakeClient()} config={{ ...config, TrailerPreview: false }} onPlay={vi.fn()} onInfo={vi.fn()} />);
    expect(container.querySelector('.lmn-hero__trailer')).toBeNull();
  });

  it('respects reduced motion', () => {
    window.matchMedia = vi.fn().mockReturnValue({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() });
    const { container } = render(<Hero items={items} client={createFakeClient()} config={config} onPlay={vi.fn()} onInfo={vi.fn()} />);

    expect(container.querySelector('.lmn-hero__trailer')).toBeNull();
  });
});
```

Run: `cd client && npx vitest run src/playback src/views/home; cd ..`

Expected: FAIL with unresolved imports.

- [ ] **Step 2: Implement**

`client/src/playback/play.ts`:
```ts
import type { LumenApi } from '../api/lumenApi';
import type { BaseItem, SessionInfo } from '../api/types';
import type { JellyfinApiClient } from '../compat/jellyfin';
import { strings } from '../strings';

export class PlaybackError extends Error {}

const normalizeId = (id: string | null | undefined): string => (id ?? '').replace(/-/g, '').toLowerCase();

/**
 * This browser's own session. ApiClient.deviceId() is URL-encoded but the server stores the decoded form, so try
 * the decoded value first, then the raw one. More than one match (e.g. ambiguous tabs) fails closed.
 */
export async function findOwnSession(api: LumenApi, client: JellyfinApiClient): Promise<SessionInfo | null> {
  const raw = client.deviceId();
  let decoded = raw;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    // keep the raw value
  }
  const userId = normalizeId(client.getCurrentUserId());
  for (const deviceId of new Set([decoded, raw])) {
    const sessions = await api.getSessions(deviceId);
    const mine = sessions.filter((s) => s.DeviceId === deviceId && (!s.UserId || normalizeId(s.UserId) === userId));
    if (mine.length === 1) return mine[0] ?? null;
    if (mine.length > 1) return null;
  }
  return null;
}

/** Starts playback in jellyfin-web's own player, which keeps resume, subtitles, device profiles, and native players. */
export async function playItem(api: LumenApi, client: JellyfinApiClient, itemId: string, startPositionTicks?: number): Promise<void> {
  const session = await findOwnSession(api, client);
  if (!session) throw new PlaybackError(strings.playbackFailed);
  await api.playNow(session.Id, [itemId], startPositionTicks && startPositionTicks > 0 ? startPositionTicks : undefined);
}

export function resumeTicks(item: BaseItem): number | undefined {
  const ticks = item.UserData?.PlaybackPositionTicks ?? 0;
  return ticks > 0 ? ticks : undefined;
}
```

`client/src/components/useVisible.ts`:
```ts
import type { RefObject } from 'preact';
import { useEffect, useState } from 'preact/hooks';

/** True while the element is at least `threshold` in view and the page is visible. */
export function useVisible(ref: RefObject<Element>, threshold = 0.5): boolean {
  const [inView, setInView] = useState(typeof IntersectionObserver === 'undefined');
  const [pageVisible, setPageVisible] = useState(!document.hidden);

  useEffect(() => {
    const element = ref.current;
    if (!element || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(
      ([entry]) => setInView(!!entry && entry.isIntersecting && entry.intersectionRatio >= threshold),
      { threshold },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref, threshold]);

  useEffect(() => {
    const onChange = (): void => setPageVisible(!document.hidden);
    document.addEventListener('visibilitychange', onChange);
    return () => document.removeEventListener('visibilitychange', onChange);
  }, []);

  return inView && pageVisible;
}
```

`client/src/components/usePrefersReducedMotion.ts`:
```ts
import { useEffect, useState } from 'preact/hooks';

const QUERY = '(prefers-reduced-motion: reduce)';

export function usePrefersReducedMotion(): boolean {
  const supported = typeof window.matchMedia === 'function';
  const [reduced, setReduced] = useState(() => supported && window.matchMedia(QUERY).matches);
  useEffect(() => {
    if (!supported) return;
    const media = window.matchMedia(QUERY);
    const onChange = (): void => setReduced(media.matches);
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, [supported]);
  return reduced;
}
```

`client/src/views/home/TrailerPreview.tsx`:
```tsx
import { useEffect, useRef, useState } from 'preact/hooks';
import type { JellyfinApiClient } from '../../compat/jellyfin';
import { useVisible } from '../../components/useVisible';

interface Props {
  trailerId: string;
  delaySeconds: number;
  client: Pick<JellyfinApiClient, 'getUrl' | 'accessToken'>;
}

/**
 * Muted local-trailer preview. It starts after a delay while visible. Unmounting the <video> stops and releases it,
 * and any playback error leaves the backdrop showing.
 */
export function TrailerPreview({ trailerId, delaySeconds, client }: Props) {
  const wrapper = useRef<HTMLDivElement>(null);
  const visible = useVisible(wrapper);
  const [state, setState] = useState<'waiting' | 'playing' | 'done'>('waiting');

  useEffect(() => {
    if (state !== 'waiting' || !visible) return;
    const timer = setTimeout(() => setState('playing'), delaySeconds * 1000);
    return () => clearTimeout(timer);
  }, [state, visible, delaySeconds]);

  useEffect(() => {
    if (!visible && state === 'playing') setState('waiting');
  }, [visible, state]);

  const src = client.getUrl(`Videos/${trailerId}/stream`, { static: true, ApiKey: client.accessToken() ?? undefined });
  return (
    <div ref={wrapper} class="lmn-hero__trailer" aria-hidden="true">
      {state === 'playing' && (
        <video
          class="lmn-hero__video"
          src={src}
          muted
          autoPlay
          playsInline
          preload="none"
          onError={() => setState('done')}
          onEnded={() => setState('done')}
        />
      )}
    </div>
  );
}
```

`client/src/views/home/Hero.tsx`:
```tsx
import { useEffect, useState } from 'preact/hooks';
import type { BaseItem, ClientConfig, HeroItem } from '../../api/types';
import type { JellyfinApiClient } from '../../compat/jellyfin';
import { imageUrl, resolveImage } from '../../components/images';
import { usePrefersReducedMotion } from '../../components/usePrefersReducedMotion';
import { strings } from '../../strings';
import { TrailerPreview } from './TrailerPreview';

interface Props {
  items: HeroItem[];
  client: Pick<JellyfinApiClient, 'getUrl' | 'accessToken'>;
  config: ClientConfig;
  onPlay: (item: BaseItem) => void;
  onInfo: (item: BaseItem) => void;
}

export function Hero({ items, client, config, onPlay, onInfo }: Props) {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const reducedMotion = usePrefersReducedMotion();

  useEffect(() => {
    if (items.length < 2 || paused) return;
    const timer = setInterval(() => setIndex((i) => (i + 1) % items.length), config.HeroIntervalSeconds * 1000);
    return () => clearInterval(timer);
  }, [items.length, paused, config.HeroIntervalSeconds]);

  const current = items[index % items.length];
  if (!current) return null;
  const item = current.Item;
  const backdrop = resolveImage(item, ['Backdrop']);
  const logo = resolveImage(item, ['Logo']);
  const trailerId = config.TrailerPreview && !reducedMotion ? current.TrailerItemId : null;

  return (
    <section
      class="lmn-hero"
      aria-roledescription="carousel"
      aria-label="Featured"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocusIn={() => setPaused(true)}
      onFocusOut={() => setPaused(false)}
    >
      {backdrop && <img key={item.Id} class="lmn-hero__backdrop" src={imageUrl(client, backdrop, { width: 1920 })} alt="" />}
      {trailerId && <TrailerPreview key={trailerId} trailerId={trailerId} delaySeconds={config.TrailerDelaySeconds} client={client} />}
      <div class="lmn-hero__scrim" />
      <div class="lmn-hero__content">
        {logo ? (
          <img class="lmn-hero__logo" src={imageUrl(client, logo, { width: 600 })} alt={item.Name} />
        ) : (
          <h1 class="lmn-hero__title">{item.Name}</h1>
        )}
        {item.Overview && <p class="lmn-hero__overview">{item.Overview}</p>}
        <div class="lmn-hero__actions">
          <button type="button" class="lmn-button lmn-button--primary lmn-autofocus" onClick={() => onPlay(item)}>
            {strings.play}
          </button>
          <button type="button" class="lmn-button" onClick={() => onInfo(item)}>
            {strings.moreInfo}
          </button>
        </div>
      </div>
      {items.length > 1 && (
        <div class="lmn-hero__dots" role="tablist">
          {items.map((h, i) => (
            <button
              key={h.Item.Id}
              type="button"
              role="tab"
              tabIndex={-1}
              aria-selected={i === index}
              aria-label={`Show ${h.Item.Name}`}
              class={`lmn-hero__dot${i === index ? ' is-active' : ''}`}
              onClick={() => setIndex(i)}
            />
          ))}
        </div>
      )}
    </section>
  );
}
```

- [ ] **Step 3: Run the client checks**

Expected: the playback (4), trailer (3), and hero (4) tests pass.

- [ ] **Step 4: Commit**

```bash
git add client
git commit -m "feat(client): add own-session playback and the hero with trailer preview" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 24: Home view, rows, app shell, and entry point

**Files:**
- Create:
  - `client/src/views/home/homeStore.ts`, `client/src/views/home/Row.tsx`, `client/src/views/home/HomeView.tsx`
  - `client/src/views/App.tsx`
  - `client/test/viewContext.ts`
- Modify: `client/src/main.tsx`
- Test: `client/src/views/home/HomeView.test.tsx`, `client/src/views/home/homeStore.test.ts`

**Interfaces:**
- Consumes: `ViewContext` (Task 21); `Card` and `ErrorBoundary` (Task 22); `Hero`, `playItem`, and `resumeTicks` (Task 23); `detailsHash` (Task 19).
- Produces:
  - Home cache: `getCachedHome(userId)`, `setCachedHome(userId, home)`, `fetchHome(api, retryDelayMs?)`, `isEmptyHome(home)`
  - `Row({ row, client, onSelect })` and `captionFor(item)`
  - `HomeView({ ctx })`
  - `App({ route, ctx })`. Details routes go back to the stock UI until Task 25.
  - Test helpers `makeContext(client, overrides?)` and `testConfig`

- [ ] **Step 1: Write the failing tests**

`client/test/viewContext.ts`:
```ts
import { vi } from 'vitest';
import { LumenApi } from '../src/api/lumenApi';
import type { ClientConfig } from '../src/api/types';
import type { ViewContext } from '../src/views/context';
import type { FakeClient } from './fakeClient';

export const testConfig: ClientConfig = {
  Enabled: true,
  HomeTakeover: true,
  DetailsTakeover: true,
  AccentColor: '#f5a524',
  HeroIntervalSeconds: 8,
  TrailerPreview: false,
  TrailerDelaySeconds: 4,
  BuildHash: 'h',
};

export function makeContext(client: FakeClient, overrides: Partial<ViewContext> = {}): ViewContext {
  return {
    api: new LumenApi(client),
    client,
    config: testConfig,
    userId: client.userId ?? 'user1',
    layout: 'desktop',
    onFallback: vi.fn(),
    navigate: vi.fn(),
    ...overrides,
  };
}
```

`client/src/views/home/homeStore.test.ts`:
```ts
import { describe, expect, it, vi } from 'vitest';
import type { LumenApi } from '../../api/lumenApi';
import { fetchHome, getCachedHome, isEmptyHome, setCachedHome } from './homeStore';

const home = { ConfigVersion: 1, Hero: [], Rows: [] };

describe('homeStore', () => {
  it('keeps only the current user', () => {
    setCachedHome('a', home);
    setCachedHome('b', home);

    expect(getCachedHome('a')).toBeUndefined();
    expect(getCachedHome('b')).toBe(home);
  });

  it('retries once', async () => {
    const getHome = vi.fn().mockRejectedValueOnce(new Error('x')).mockResolvedValueOnce(home);

    await expect(fetchHome({ getHome } as unknown as LumenApi, 0)).resolves.toBe(home);
    expect(getHome).toHaveBeenCalledTimes(2);
  });

  it('detects empty homes', () => {
    expect(isEmptyHome(home)).toBe(true);
  });
});
```

`client/src/views/home/HomeView.test.tsx`:
```tsx
import { fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { beforeEach, describe, expect, it } from 'vitest';
import { createFakeClient, routes } from '../../../test/fakeClient';
import { makeContext } from '../../../test/viewContext';
import type { HomeResponse } from '../../api/types';
import { HomeView } from './HomeView';
import { setCachedHome } from './homeStore';

const home: HomeResponse = {
  ConfigVersion: 1,
  Hero: [],
  Rows: [
    {
      Id: 'r1',
      Type: 'ContinueWatching',
      Title: 'Continue Watching',
      Items: [
        { Id: 'e1', Name: 'Pilot', Type: 'Episode', SeriesName: 'Show', ParentIndexNumber: 1, IndexNumber: 1, UserData: { PlaybackPositionTicks: 77 } },
      ],
    },
    { Id: 'r2', Type: 'RecentlyAdded', Title: 'Recently Added', Items: [{ Id: 'm1', Name: 'Alpha', Type: 'Movie', ServerId: 's' }] },
  ],
};

describe('HomeView', () => {
  beforeEach(() => setCachedHome('nobody', { ConfigVersion: 0, Hero: [], Rows: [] }));

  it('renders rows and opens details for movies', async () => {
    const ctx = makeContext(createFakeClient(routes({ 'Lumen/Home': home })));
    render(<HomeView ctx={ctx} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Alpha' }));

    expect(screen.getByRole('region', { name: 'Recently Added' })).toBeInTheDocument();
    expect(ctx.navigate).toHaveBeenCalledWith('#/details?id=m1&serverId=s');
  });

  it('resumes continue-watching items in place', async () => {
    const client = createFakeClient(routes({ 'Lumen/Home': home, Sessions: [{ Id: 's1', DeviceId: 'dev+ice' }], 'Sessions/s1/Playing': {} }));
    render(<HomeView ctx={makeContext(client)} />);

    fireEvent.click(await screen.findByRole('button', { name: /Pilot/ }));

    await waitFor(() => expect(client.requests.at(-1)?.url).toContain('Sessions/s1/Playing?playCommand=PlayNow&itemIds=e1&startPositionTicks=77'));
  });

  it('falls back to stock when home is empty', async () => {
    const ctx = makeContext(createFakeClient(routes({ 'Lumen/Home': { ConfigVersion: 1, Hero: [], Rows: [] } })));
    render(<HomeView ctx={ctx} />);

    await waitFor(() => expect(ctx.onFallback).toHaveBeenCalled());
  });

  it('falls back to stock when the request fails and nothing is cached', async () => {
    const ctx = makeContext(createFakeClient(() => Promise.reject(new Error('down'))));
    render(<HomeView ctx={ctx} />);

    await waitFor(() => expect(ctx.onFallback).toHaveBeenCalled(), { timeout: 2000 });
  });

  it('shows the cached home instantly and keeps it when the refresh fails', async () => {
    setCachedHome('user1', home);
    const ctx = makeContext(createFakeClient(() => Promise.reject(new Error('down'))));
    render(<HomeView ctx={ctx} />);

    expect(screen.getByRole('button', { name: 'Alpha' })).toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 700));
    expect(ctx.onFallback).not.toHaveBeenCalled();
  });

  it("does not show another user's cached home", () => {
    setCachedHome('someone-else', home);
    render(<HomeView ctx={makeContext(createFakeClient(() => new Promise(() => undefined)))} />);

    expect(screen.queryByRole('button', { name: 'Alpha' })).toBeNull();
  });
});
```

Run: `cd client && npx vitest run src/views/home/HomeView.test.tsx src/views/home/homeStore.test.ts; cd ..`

Expected: FAIL with unresolved imports.

- [ ] **Step 2: Implement**

`client/src/views/home/homeStore.ts`:
```ts
import type { LumenApi } from '../../api/lumenApi';
import type { HomeResponse } from '../../api/types';

/** The last home response for the current user only. Gives instant back-navigation and is never shown to another user. */
let cached: { userId: string; home: HomeResponse } | null = null;

export function getCachedHome(userId: string): HomeResponse | undefined {
  return cached?.userId === userId ? cached.home : undefined;
}

export function setCachedHome(userId: string, home: HomeResponse): void {
  cached = { userId, home };
}

export async function fetchHome(api: LumenApi, retryDelayMs = 500): Promise<HomeResponse> {
  try {
    return await api.getHome();
  } catch {
    await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
    return api.getHome();
  }
}

export const isEmptyHome = (home: HomeResponse): boolean => home.Hero.length === 0 && home.Rows.length === 0;
```

`client/src/views/home/Row.tsx`:
```tsx
import type { BaseItem, HomeRow } from '../../api/types';
import type { JellyfinApiClient } from '../../compat/jellyfin';
import { Card } from '../../components/Card';
import type { CardVariant } from '../../components/images';

const THUMB_ROWS = new Set(['ContinueWatching', 'NextUp']);

export function captionFor(item: BaseItem): string {
  return item.Type === 'Episode' ? `${item.SeriesName ?? ''} · S${item.ParentIndexNumber ?? 0}:E${item.IndexNumber ?? 0}` : item.Name;
}

interface Props {
  row: HomeRow;
  client: Pick<JellyfinApiClient, 'getUrl'>;
  onSelect: (item: BaseItem, row: HomeRow) => void;
}

export function Row({ row, client, onSelect }: Props) {
  const variant: CardVariant = THUMB_ROWS.has(row.Type) ? 'thumb' : 'poster';
  return (
    <section class="lmn-row" aria-label={row.Title}>
      <h2 class="lmn-row__title">{row.Title}</h2>
      <div class="lmn-row__scroller focuscontainer-x">
        {row.Items.map((item) => (
          <Card
            key={item.Id}
            item={item}
            client={client}
            variant={variant}
            caption={variant === 'thumb' ? captionFor(item) : undefined}
            onSelect={(selected) => onSelect(selected, row)}
          />
        ))}
      </div>
    </section>
  );
}
```

`client/src/views/home/HomeView.tsx`:
```tsx
import { useEffect, useState } from 'preact/hooks';
import type { BaseItem, HomeResponse, HomeRow } from '../../api/types';
import { detailsHash } from '../../compat/jellyfin';
import { ErrorBoundary } from '../../components/ErrorBoundary';
import { playItem, resumeTicks } from '../../playback/play';
import { strings } from '../../strings';
import type { ViewContext } from '../context';
import { Hero } from './Hero';
import { fetchHome, getCachedHome, isEmptyHome, setCachedHome } from './homeStore';
import { Row } from './Row';

export function HomeView({ ctx }: { ctx: ViewContext }) {
  const [home, setHome] = useState<HomeResponse | null>(() => getCachedHome(ctx.userId) ?? null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchHome(ctx.api)
      .then((fresh) => {
        if (cancelled) return;
        setCachedHome(ctx.userId, fresh);
        if (isEmptyHome(fresh)) ctx.onFallback();
        else setHome(fresh);
      })
      .catch(() => {
        if (!cancelled && !getCachedHome(ctx.userId)) ctx.onFallback();
      });
    return () => {
      cancelled = true;
    };
  }, [ctx.api, ctx.userId]);

  const play = (item: BaseItem): void => {
    setError(null);
    playItem(ctx.api, ctx.client, item.Id, resumeTicks(item)).catch(() => setError(strings.playbackFailed));
  };
  const open = (item: BaseItem): void => ctx.navigate(detailsHash(item.Id, item.ServerId));
  const select = (item: BaseItem, row: HomeRow): void => {
    if (item.Type === 'Episode' || row.Type === 'ContinueWatching') play(item);
    else open(item);
  };

  if (!home) return <div class="lmn-home lmn-home--loading" aria-busy="true" />;

  return (
    <div class={`lmn-home${home.Hero.length === 0 ? ' lmn-home--no-hero' : ''}`}>
      {home.Hero.length > 0 && (
        <ErrorBoundary fallback={null}>
          <Hero items={home.Hero} client={ctx.client} config={ctx.config} onPlay={play} onInfo={open} />
        </ErrorBoundary>
      )}
      {error && (
        <p class="lmn-toast" role="alert">
          {error}
        </p>
      )}
      {home.Rows.map((row) => (
        <ErrorBoundary key={row.Id} fallback={null}>
          <Row row={row} client={ctx.client} onSelect={select} />
        </ErrorBoundary>
      ))}
    </div>
  );
}
```

`client/src/views/App.tsx`:
```tsx
import { useEffect } from 'preact/hooks';
import { ErrorBoundary } from '../components/ErrorBoundary';
import type { TakeoverRoute } from '../takeover/routes';
import type { ViewContext } from './context';
import { HomeView } from './home/HomeView';

/** Hands the route back to the stock UI. Task 25 replaces it with DetailsView for details routes. */
function StockFallback({ ctx }: { ctx: ViewContext }) {
  useEffect(() => ctx.onFallback(), [ctx]);
  return null;
}

export function App({ route, ctx }: { route: TakeoverRoute; ctx: ViewContext }) {
  return (
    <ErrorBoundary fallback={null} onError={ctx.onFallback}>
      {route.kind === 'home' ? <HomeView ctx={ctx} /> : <StockFallback ctx={ctx} />}
    </ErrorBoundary>
  );
}
```

Replace `client/src/main.tsx`:
```tsx
import { render } from 'preact';
import './styles/lumen.css';
import { startLumen } from './takeover/bootstrap';
import { App } from './views/App';

startLumen({
  mount: (route, root, ctx) => render(<App route={route} ctx={ctx} />, root),
  unmount: (root) => render(null, root),
});
```

- [ ] **Step 3: Run the client checks**

Expected: the home store (3) and home view (6) tests pass, and the bundle stays well under budget.

- [ ] **Step 4: Verify on the dev server**

Run `./scripts/dev.sh`, then open http://localhost:8096 with a hard reload and sign in as `admin`.

Expected:
- **Hero.** It rotates through the fixture movies. Alpha and Gamma show a logo; Beta shows its title. After 4 s a muted trailer plays when the browser can decode VP9 (desktop Chrome and Firefox can).
- **Rows.** "Recently Added in Movies", "Recently Added in Shows", and one or more genre rows appear.
- **Details.** Clicking a movie opens the **stock** details page; details takeover arrives in Task 25. Browser Back returns to the Lumen home instantly.
- **Disabling.** In Dashboard → Plugins → Lumen, untick "Replace the home screen" and save. After a reload, home is stock again.

- [ ] **Step 5: Commit**

```bash
git add client
git commit -m "feat(client): add the home view, rows, and app entry point" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 25: Details view and movie details

**Files:**
- Create:
  - `client/src/views/details/badges.ts`, `client/src/views/details/useItemActions.ts`
  - `client/src/views/details/DetailsHeader.tsx`, `client/src/views/details/CastRow.tsx`, `client/src/views/details/SimilarRow.tsx`
  - `client/src/views/details/MovieDetails.tsx`, `client/src/views/details/DetailsView.tsx`
- Modify: `client/src/views/App.tsx` (route details to `DetailsView` and delete `StockFallback`)
- Test: `client/src/views/details/badges.test.ts`, `client/src/views/details/DetailsView.test.tsx`

**Interfaces:**
- Consumes: components (Task 22), playback (Task 23), and `Row` (Task 24).
- Produces:
  - `deriveBadges(streams?)`, `formatRuntime(ticks?)`, `metaFor(item)`
  - `useItemActions(item, ctx)` returns `{ played, favorite, error, toggleWatched, toggleFavorite, play }`
  - `DetailsHeader(props)`, `CastRow({ people, client, onSelect })`, `SimilarRow({ itemId, ctx })`
  - `MovieDetails({ item, ctx })`
  - `DetailsView({ id, ctx })` and `resolveDetails(api, id)`. This task handles Movie; Series and Season come in Task 26.

- [ ] **Step 1: Write the failing tests**

`client/src/views/details/badges.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { deriveBadges, formatRuntime, metaFor } from './badges';

describe('badges', () => {
  it('derives resolution, dynamic range, and audio badges', () => {
    expect(
      deriveBadges([
        { Type: 'Video', Width: 3840, Height: 2160, VideoRange: 'HDR', VideoRangeType: 'DOVIWithHDR10' },
        { Type: 'Audio', Profile: 'Dolby TrueHD + Dolby Atmos', Channels: 8 },
      ]),
    ).toEqual(['4K', 'Dolby Vision', 'Atmos']);
    expect(
      deriveBadges([
        { Type: 'Video', Width: 1920, VideoRange: 'HDR', VideoRangeType: 'HDR10' },
        { Type: 'Audio', Channels: 6 },
      ]),
    ).toEqual(['HD', 'HDR', '5.1']);
    expect(deriveBadges(undefined)).toEqual([]);
  });

  it('formats runtimes', () => {
    expect(formatRuntime(67_200_000_000)).toBe('1h 52m');
    expect(formatRuntime(27_000_000_000)).toBe('45m');
    expect(formatRuntime(undefined)).toBeNull();
  });

  it('builds the metadata line', () => {
    expect(metaFor({ Id: 'a', Name: 'a', Type: 'Movie', ProductionYear: 2001, OfficialRating: 'PG-13', RunTimeTicks: 27_000_000_000 })).toEqual([
      '2001',
      'PG-13',
      '45m',
    ]);
  });
});
```

`client/src/views/details/DetailsView.test.tsx`:
```tsx
import { fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { describe, expect, it } from 'vitest';
import { createFakeClient, routes } from '../../../test/fakeClient';
import { makeContext } from '../../../test/viewContext';
import type { BaseItem } from '../../api/types';
import { DetailsView } from './DetailsView';

const movie: BaseItem = {
  Id: 'm1',
  Name: 'Lumen Alpha',
  Type: 'Movie',
  ServerId: 's',
  Overview: 'A test movie.',
  ProductionYear: 2001,
  RunTimeTicks: 1000,
  LocalTrailerCount: 1,
  BackdropImageTags: ['b'],
  UserData: { PlaybackPositionTicks: 400, Played: false, IsFavorite: false },
  MediaStreams: [{ Type: 'Video', Width: 1920 }],
  People: [{ Id: 'p1', Name: 'Jane Doe', Role: 'Hero', Type: 'Actor' }],
};

function client() {
  return createFakeClient(
    routes({
      'Items/m1': movie,
      'Items/m1/LocalTrailers': [{ Id: 't1', Name: 'Trailer', Type: 'Trailer' }],
      'Items/m1/Similar': { Items: [{ Id: 'm2', Name: 'Lumen Beta', Type: 'Movie', ServerId: 's' }] },
      Sessions: [{ Id: 's1', DeviceId: 'dev+ice' }],
      'Sessions/s1/Playing': {},
      'UserPlayedItems/m1': {},
      'UserFavoriteItems/m1': {},
    }),
  );
}

describe('DetailsView', () => {
  it('renders a movie with resume, trailer, badges, cast, and similar titles', async () => {
    render(<DetailsView id="m1" ctx={makeContext(client())} />);

    expect(await screen.findByRole('heading', { name: 'Lumen Alpha' })).toBeInTheDocument();
    expect(screen.getByText('A test movie.')).toBeInTheDocument();
    expect(screen.getByText('HD')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Resume/ })).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Trailer' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Jane Doe/ })).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Lumen Beta' })).toBeInTheDocument();
  });

  it('resumes from the saved position', async () => {
    const c = client();
    render(<DetailsView id="m1" ctx={makeContext(c)} />);

    fireEvent.click(await screen.findByRole('button', { name: /Resume/ }));

    await waitFor(() => expect(c.requests.at(-1)?.url).toContain('itemIds=m1&startPositionTicks=400'));
  });

  it('toggles watched optimistically', async () => {
    const c = client();
    render(<DetailsView id="m1" ctx={makeContext(c)} />);

    const watched = await screen.findByRole('button', { name: 'Mark as watched' });
    fireEvent.click(watched);

    expect(watched).toHaveAttribute('aria-pressed', 'true');
    await waitFor(() => expect(c.requests.some((r) => r.type === 'POST' && r.url.includes('UserPlayedItems/m1'))).toBe(true));
  });

  it('shows an inline error when playback cannot start', async () => {
    const c = client();
    c.respond = routes({ 'Items/m1': movie, 'Items/m1/LocalTrailers': [], 'Items/m1/Similar': { Items: [] }, Sessions: [] });
    render(<DetailsView id="m1" ctx={makeContext(c)} />);

    fireEvent.click(await screen.findByRole('button', { name: /Resume/ }));

    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't start playback");
  });

  it('hands unsupported item types back to the stock page', async () => {
    const ctx = makeContext(createFakeClient(routes({ 'Items/x1': { Id: 'x1', Name: 'Song', Type: 'Audio' } })));
    render(<DetailsView id="x1" ctx={ctx} />);

    await waitFor(() => expect(ctx.onFallback).toHaveBeenCalled());
  });

  it('falls back when the item cannot be loaded', async () => {
    const ctx = makeContext(createFakeClient(() => Promise.reject(new Error('404'))));
    render(<DetailsView id="m1" ctx={ctx} />);

    await waitFor(() => expect(ctx.onFallback).toHaveBeenCalled());
  });
});
```

Run: `cd client && npx vitest run src/views/details; cd ..`

Expected: FAIL with unresolved imports.

- [ ] **Step 2: Implement**

`client/src/views/details/badges.ts`:
```ts
import type { BaseItem, MediaStream } from '../../api/types';

const TICKS_PER_MINUTE = 600_000_000;

export function deriveBadges(streams: MediaStream[] | undefined): string[] {
  const badges: string[] = [];
  const video = streams?.find((s) => s.Type === 'Video');
  const audio = streams?.filter((s) => s.Type === 'Audio') ?? [];

  if ((video?.Width ?? 0) >= 3800 || (video?.Height ?? 0) >= 2100) badges.push('4K');
  else if ((video?.Width ?? 0) >= 1900 || (video?.Height ?? 0) >= 1000) badges.push('HD');

  const rangeType = video?.VideoRangeType ?? '';
  if (/^DOVI/i.test(rangeType)) badges.push('Dolby Vision');
  else if (video?.VideoRange === 'HDR' || /HDR10|HLG/i.test(rangeType)) badges.push('HDR');

  if (audio.some((a) => /atmos/i.test(`${a.Profile ?? ''} ${a.DisplayTitle ?? ''} ${a.Title ?? ''}`))) badges.push('Atmos');
  else if (audio.some((a) => (a.Channels ?? 0) >= 6)) badges.push('5.1');

  return badges;
}

export function formatRuntime(ticks: number | undefined): string | null {
  if (!ticks) return null;
  const minutes = Math.round(ticks / TICKS_PER_MINUTE);
  const hours = Math.floor(minutes / 60);
  return hours > 0 ? `${hours}h ${minutes % 60}m` : `${minutes}m`;
}

export function metaFor(item: BaseItem): string[] {
  return [item.ProductionYear?.toString(), item.OfficialRating, formatRuntime(item.RunTimeTicks) ?? undefined].filter(
    (value): value is string => !!value,
  );
}
```

`client/src/views/details/useItemActions.ts`:
```ts
import { useState } from 'preact/hooks';
import type { BaseItem } from '../../api/types';
import { playItem } from '../../playback/play';
import { strings } from '../../strings';
import type { ViewContext } from '../context';

/** Watched/favorite toggles (optimistic, reverted on failure) and playback with an inline error. */
export function useItemActions(item: BaseItem, ctx: ViewContext) {
  const [played, setPlayed] = useState(!!item.UserData?.Played);
  const [favorite, setFavorite] = useState(!!item.UserData?.IsFavorite);
  const [error, setError] = useState<string | null>(null);

  const toggleWatched = (): void => {
    const next = !played;
    setPlayed(next);
    ctx.api.setPlayed(item.Id, next).catch(() => setPlayed(!next));
  };
  const toggleFavorite = (): void => {
    const next = !favorite;
    setFavorite(next);
    ctx.api.setFavorite(item.Id, next).catch(() => setFavorite(!next));
  };
  const play = (itemId: string, startTicks?: number): void => {
    setError(null);
    playItem(ctx.api, ctx.client, itemId, startTicks).catch(() => setError(strings.playbackFailed));
  };

  return { played, favorite, error, toggleWatched, toggleFavorite, play };
}
```

`client/src/views/details/DetailsHeader.tsx`:
```tsx
import type { BaseItem } from '../../api/types';
import type { JellyfinApiClient } from '../../compat/jellyfin';
import { imageUrl, resolveImage } from '../../components/images';
import { ProgressBar } from '../../components/ProgressBar';
import { strings } from '../../strings';

export interface PrimaryAction {
  label: string;
  progress?: number;
  onClick: () => void;
}

interface Props {
  item: BaseItem;
  client: Pick<JellyfinApiClient, 'getUrl'>;
  primary: PrimaryAction | null;
  onTrailer?: () => void;
  meta: string[];
  badges: string[];
  played: boolean;
  favorite: boolean;
  error: string | null;
  toggleWatched: () => void;
  toggleFavorite: () => void;
}

export function DetailsHeader(props: Props) {
  const { item, client, primary } = props;
  const backdrop = resolveImage(item, ['Backdrop']);
  const logo = resolveImage(item, ['Logo']);
  return (
    <header class="lmn-details__header">
      {backdrop && <img class="lmn-details__backdrop" src={imageUrl(client, backdrop, { width: 1920 })} alt="" />}
      <div class="lmn-details__scrim" />
      <div class="lmn-details__info">
        {logo ? (
          <img class="lmn-details__logo" src={imageUrl(client, logo, { width: 480 })} alt={item.Name} />
        ) : (
          <h1 class="lmn-details__title">{item.Name}</h1>
        )}
        <p class="lmn-details__meta">
          {props.meta.map((m) => (
            <span key={m}>{m}</span>
          ))}
          {props.badges.map((b) => (
            <span key={b} class="lmn-badge">
              {b}
            </span>
          ))}
        </p>
        {item.Overview && <p class="lmn-details__overview">{item.Overview}</p>}
        <div class="lmn-details__actions">
          {primary && (
            <button type="button" class="lmn-button lmn-button--primary lmn-autofocus" onClick={primary.onClick}>
              {primary.label}
              {primary.progress ? <ProgressBar percent={primary.progress} /> : null}
            </button>
          )}
          {props.onTrailer && (
            <button type="button" class="lmn-button" onClick={props.onTrailer}>
              {strings.trailer}
            </button>
          )}
          <button type="button" class="lmn-button" aria-pressed={props.played} aria-label={strings.markWatched} onClick={props.toggleWatched}>
            {strings.watched}
          </button>
          <button
            type="button"
            class="lmn-button"
            aria-pressed={props.favorite}
            aria-label={strings.addFavorite}
            onClick={props.toggleFavorite}
          >
            {strings.favorite}
          </button>
        </div>
        {props.error && (
          <p class="lmn-toast" role="alert">
            {props.error}
          </p>
        )}
      </div>
    </header>
  );
}
```

`client/src/views/details/CastRow.tsx`:
```tsx
import type { Person } from '../../api/types';
import type { JellyfinApiClient } from '../../compat/jellyfin';
import { imageUrl } from '../../components/images';
import { strings } from '../../strings';

const MAX_CAST = 15;

interface Props {
  people: Person[];
  client: Pick<JellyfinApiClient, 'getUrl'>;
  onSelect: (person: Person) => void;
}

export function CastRow({ people, client, onSelect }: Props) {
  const cast = people.filter((p) => p.Type === 'Actor').slice(0, MAX_CAST);
  if (cast.length === 0) return null;
  return (
    <section class="lmn-row lmn-cast" aria-label={strings.cast}>
      <h2 class="lmn-row__title">{strings.cast}</h2>
      <div class="lmn-row__scroller focuscontainer-x">
        {cast.map((person) => (
          <button key={person.Id} type="button" class="lmn-person" onClick={() => onSelect(person)}>
            {person.PrimaryImageTag ? (
              <img
                class="lmn-person__photo"
                src={imageUrl(client, { itemId: person.Id, type: 'Primary', tag: person.PrimaryImageTag }, { width: 120, height: 120 })}
                alt=""
                loading="lazy"
              />
            ) : (
              <span class="lmn-person__photo" />
            )}
            <span class="lmn-person__name">{person.Name}</span>
            {person.Role && <span class="lmn-person__role">{person.Role}</span>}
          </button>
        ))}
      </div>
    </section>
  );
}
```

`client/src/views/details/SimilarRow.tsx`:
```tsx
import { useEffect, useState } from 'preact/hooks';
import type { BaseItem } from '../../api/types';
import { detailsHash } from '../../compat/jellyfin';
import { strings } from '../../strings';
import type { ViewContext } from '../context';
import { Row } from '../home/Row';

export function SimilarRow({ itemId, ctx }: { itemId: string; ctx: ViewContext }) {
  const [items, setItems] = useState<BaseItem[]>([]);

  useEffect(() => {
    let cancelled = false;
    ctx.api
      .getSimilar(itemId)
      .then((result) => {
        if (!cancelled) setItems(result.Items);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [itemId]);

  if (items.length === 0) return null;
  return (
    <Row
      row={{ Id: `similar-${itemId}`, Type: 'Similar', Title: strings.moreLikeThis, Items: items }}
      client={ctx.client}
      onSelect={(item) => ctx.navigate(detailsHash(item.Id, item.ServerId))}
    />
  );
}
```

`client/src/views/details/MovieDetails.tsx`:
```tsx
import { useEffect, useState } from 'preact/hooks';
import type { BaseItem } from '../../api/types';
import { detailsHash } from '../../compat/jellyfin';
import { playedPercent } from '../../components/ProgressBar';
import { resumeTicks } from '../../playback/play';
import { strings } from '../../strings';
import type { ViewContext } from '../context';
import { deriveBadges, metaFor } from './badges';
import { CastRow } from './CastRow';
import { DetailsHeader } from './DetailsHeader';
import { SimilarRow } from './SimilarRow';
import { useItemActions } from './useItemActions';

export function MovieDetails({ item, ctx }: { item: BaseItem; ctx: ViewContext }) {
  const actions = useItemActions(item, ctx);
  const [trailerId, setTrailerId] = useState<string | null>(null);

  useEffect(() => {
    if ((item.LocalTrailerCount ?? 0) === 0) return;
    ctx.api
      .getLocalTrailers(item.Id)
      .then((trailers) => setTrailerId(trailers[0]?.Id ?? null))
      .catch(() => undefined);
  }, [item.Id]);

  const ticks = resumeTicks(item);
  return (
    <article class="lmn-details lmn-details--movie">
      <DetailsHeader
        item={item}
        client={ctx.client}
        primary={{
          label: ticks ? strings.resume : strings.play,
          progress: ticks ? playedPercent(item) : undefined,
          onClick: () => actions.play(item.Id, ticks),
        }}
        onTrailer={trailerId ? () => actions.play(trailerId) : undefined}
        meta={metaFor(item)}
        badges={deriveBadges(item.MediaStreams)}
        {...actions}
      />
      <CastRow people={item.People ?? []} client={ctx.client} onSelect={(p) => ctx.navigate(detailsHash(p.Id, item.ServerId))} />
      <SimilarRow itemId={item.Id} ctx={ctx} />
    </article>
  );
}
```

`client/src/views/details/DetailsView.tsx`:
```tsx
import { useEffect, useState } from 'preact/hooks';
import type { LumenApi } from '../../api/lumenApi';
import type { BaseItem } from '../../api/types';
import type { ViewContext } from '../context';
import { MovieDetails } from './MovieDetails';

export interface ResolvedDetails {
  item: BaseItem;
  seasonId?: string;
}

/** Which Lumen view handles an item. Null means the stock details page keeps it. */
export async function resolveDetails(api: LumenApi, id: string): Promise<ResolvedDetails | null> {
  const item = await api.getItem(id);
  if (item.Type === 'Movie') return { item };
  return null;
}

export function DetailsView({ id, ctx }: { id: string; ctx: ViewContext }) {
  const [resolved, setResolved] = useState<ResolvedDetails | null>(null);

  useEffect(() => {
    let cancelled = false;
    resolveDetails(ctx.api, id)
      .then((result) => {
        if (cancelled) return;
        if (result) setResolved(result);
        else ctx.onFallback();
      })
      .catch(() => {
        if (!cancelled) ctx.onFallback();
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  if (!resolved) return <div class="lmn-details lmn-details--loading" aria-busy="true" />;
  return <MovieDetails item={resolved.item} ctx={ctx} />;
}
```

Replace `client/src/views/App.tsx`:
```tsx
import { ErrorBoundary } from '../components/ErrorBoundary';
import type { TakeoverRoute } from '../takeover/routes';
import type { ViewContext } from './context';
import { DetailsView } from './details/DetailsView';
import { HomeView } from './home/HomeView';

export function App({ route, ctx }: { route: TakeoverRoute; ctx: ViewContext }) {
  return (
    <ErrorBoundary fallback={null} onError={ctx.onFallback}>
      {route.kind === 'home' ? <HomeView ctx={ctx} /> : <DetailsView key={route.id} id={route.id} ctx={ctx} />}
    </ErrorBoundary>
  );
}
```

- [ ] **Step 3: Run the client checks**

Expected: the badges (3) and details view (6) tests pass.

- [ ] **Step 4: Verify on the dev server**

Run `./scripts/dev.sh` and hard-reload.

Expected:
- Clicking **Lumen Alpha** opens the Lumen movie page: backdrop, logo, metadata, and the Play, Trailer, Watched, and Favorite buttons. There's no resolution badge, because the fixtures are 640×360.
- **Play** opens the stock player at `#/video`. **Trailer** plays the trailer.
- A series still opens the stock page; Task 26 adds the series view.

- [ ] **Step 5: Commit**

```bash
git add client
git commit -m "feat(client): add the details view and movie details page" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 26: Series details

**Files:**
- Create: `client/src/views/details/smartPlay.ts`, `client/src/views/details/EpisodeList.tsx`, `client/src/views/details/SeriesDetails.tsx`
- Modify: `client/src/views/details/DetailsView.tsx` (handle Series and Season)
- Test: `client/src/views/details/smartPlay.test.ts`, `client/src/views/details/SeriesDetails.test.tsx`

**Interfaces:**
- Consumes: the details building blocks (Task 25).
- Produces:
  - `interface SmartPlay { label; episodeId; startTicks?; progress? }`
  - `computeSmartPlay(resume?, nextUp?, first?)` and `episodeCode(episode)`
  - `EpisodeList({ episodes, client, onPlay })`
  - `SeriesDetails({ series, initialSeasonId?, ctx })`
  - `resolveDetails` now also returns Series as `{ item }` and Season as `{ item: series, seasonId }`

- [ ] **Step 1: Write the failing tests**

`client/src/views/details/smartPlay.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import type { BaseItem } from '../../api/types';
import { computeSmartPlay, episodeCode } from './smartPlay';

const ep = (id: string, s: number, e: number, extra: Partial<BaseItem> = {}): BaseItem => ({
  Id: id,
  Name: id,
  Type: 'Episode',
  ParentIndexNumber: s,
  IndexNumber: e,
  ...extra,
});

describe('computeSmartPlay', () => {
  it('prefers resuming, then next up, then the first episode', () => {
    const resume = ep('r', 2, 5, { RunTimeTicks: 100, UserData: { PlaybackPositionTicks: 25 } });
    expect(computeSmartPlay(resume, ep('n', 2, 6), ep('f', 1, 1))).toEqual({
      label: 'Resume S2:E5',
      episodeId: 'r',
      startTicks: 25,
      progress: 25,
    });
    expect(computeSmartPlay(undefined, ep('n', 2, 6), ep('f', 1, 1))).toEqual({ label: 'Play S2:E6', episodeId: 'n' });
    expect(computeSmartPlay(undefined, undefined, ep('f', 1, 1))).toEqual({ label: 'Play S1:E1', episodeId: 'f' });
    expect(computeSmartPlay()).toBeNull();
  });

  it('formats episode codes', () => {
    expect(episodeCode(ep('x', 0, 3))).toBe('S0:E3');
  });
});
```

`client/src/views/details/SeriesDetails.test.tsx`:
```tsx
import { fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { describe, expect, it } from 'vitest';
import { createFakeClient, routes } from '../../../test/fakeClient';
import { makeContext } from '../../../test/viewContext';
import type { AjaxRequest } from '../../compat/jellyfin';
import { DetailsView } from './DetailsView';

const series = { Id: 'sr', Name: 'Lumen Show', Type: 'Series', ServerId: 's', Overview: 'A series.' };
const seasons = {
  Items: [
    { Id: 'sp', Name: 'Specials', Type: 'Season', IndexNumber: 0 },
    { Id: 's1', Name: 'Season 1', Type: 'Season', IndexNumber: 1 },
    { Id: 's2', Name: 'Season 2', Type: 'Season', IndexNumber: 2 },
  ],
};
const episodes = (seasonId: string) => ({
  Items: [1, 2].map((n) => ({
    Id: `${seasonId}e${n}`,
    Name: `Episode ${n}`,
    Type: 'Episode',
    SeasonId: seasonId,
    ParentIndexNumber: seasonId === 's2' ? 2 : 1,
    IndexNumber: n,
    RunTimeTicks: 9_000_000_000,
  })),
});

function client(nextUp: unknown[] = [], resume: unknown[] = []) {
  return createFakeClient(
    routes({
      'Items/sr': series,
      'Items/s2': { Id: 's2', Name: 'Season 2', Type: 'Season', SeriesId: 'sr' },
      'Shows/sr/Seasons': seasons,
      'Shows/sr/Episodes': (r: AjaxRequest) => episodes(new URL(r.url).searchParams.get('seasonId')!),
      'Shows/NextUp': { Items: nextUp },
      'UserItems/Resume': { Items: resume },
      'Items/sr/Similar': { Items: [] },
      Sessions: [{ Id: 'ss', DeviceId: 'dev+ice' }],
      'Sessions/ss/Playing': {},
    }),
  );
}

describe('SeriesDetails', () => {
  it('defaults to the first regular season and offers Play S1:E1 for a new show', async () => {
    render(<DetailsView id="sr" ctx={makeContext(client())} />);

    expect(await screen.findByRole('button', { name: 'Play S1:E1' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Season' })).toHaveValue('s1');
    expect(screen.getByText('1. Episode 1')).toBeInTheDocument();
  });

  it('resumes the in-progress episode and selects its season', async () => {
    const resume = [
      { Id: 's2e1', Name: 'Episode 1', Type: 'Episode', SeasonId: 's2', ParentIndexNumber: 2, IndexNumber: 1, UserData: { PlaybackPositionTicks: 50 } },
    ];
    const c = client([], resume);
    render(<DetailsView id="sr" ctx={makeContext(c)} />);

    fireEvent.click(await screen.findByRole('button', { name: /Resume S2:E1/ }));

    expect(screen.getByRole('combobox', { name: 'Season' })).toHaveValue('s2');
    await waitFor(() => expect(c.requests.at(-1)?.url).toContain('itemIds=s2e1&startPositionTicks=50'));
  });

  it('switches seasons and plays an episode', async () => {
    const c = client();
    render(<DetailsView id="sr" ctx={makeContext(c)} />);

    fireEvent.change(await screen.findByRole('combobox', { name: 'Season' }), { target: { value: 's2' } });
    fireEvent.click(await screen.findByRole('button', { name: /2\. Episode 2/ }));

    await waitFor(() => expect(c.requests.at(-1)?.url).toContain('itemIds=s2e2'));
  });

  it('opens a season route as its series with that season selected', async () => {
    render(<DetailsView id="s2" ctx={makeContext(client())} />);

    expect(await screen.findByRole('heading', { name: 'Lumen Show' })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Season' })).toHaveValue('s2'));
  });

  it('labels season 0 as Specials', async () => {
    render(<DetailsView id="sr" ctx={makeContext(client())} />);

    expect(await screen.findByRole('option', { name: 'Specials' })).toBeInTheDocument();
  });
});
```

Run: `cd client && npx vitest run src/views/details; cd ..`

Expected: FAIL. `./smartPlay` won't resolve, and the series tests see a fallback instead of a series page.

- [ ] **Step 2: Implement**

`client/src/views/details/smartPlay.ts`:
```ts
import type { BaseItem } from '../../api/types';
import { playedPercent } from '../../components/ProgressBar';

export interface SmartPlay {
  label: string;
  episodeId: string;
  startTicks?: number;
  progress?: number;
}

export const episodeCode = (episode: BaseItem): string => `S${episode.ParentIndexNumber ?? 0}:E${episode.IndexNumber ?? 0}`;

/** Resume the in-progress episode, else play next up, else start from the first episode. */
export function computeSmartPlay(resume?: BaseItem, nextUp?: BaseItem, first?: BaseItem): SmartPlay | null {
  if (resume) {
    return {
      label: `Resume ${episodeCode(resume)}`,
      episodeId: resume.Id,
      startTicks: resume.UserData?.PlaybackPositionTicks,
      progress: playedPercent(resume),
    };
  }
  if (nextUp) return { label: `Play ${episodeCode(nextUp)}`, episodeId: nextUp.Id };
  if (first) return { label: `Play ${episodeCode(first)}`, episodeId: first.Id };
  return null;
}
```

`client/src/views/details/EpisodeList.tsx`:
```tsx
import type { BaseItem } from '../../api/types';
import type { JellyfinApiClient } from '../../compat/jellyfin';
import { imageUrl, resolveImage } from '../../components/images';
import { ProgressBar, playedPercent } from '../../components/ProgressBar';
import { formatRuntime } from './badges';

interface Props {
  episodes: BaseItem[];
  client: Pick<JellyfinApiClient, 'getUrl'>;
  onPlay: (episode: BaseItem) => void;
}

export function EpisodeList({ episodes, client, onPlay }: Props) {
  return (
    <ol class="lmn-episodes">
      {episodes.map((episode) => {
        const image = resolveImage(episode, ['Primary', 'Thumb']);
        const percent = playedPercent(episode);
        const runtime = formatRuntime(episode.RunTimeTicks);
        return (
          <li key={episode.Id}>
            <button type="button" class="lmn-episode" data-item-id={episode.Id} onClick={() => onPlay(episode)}>
              <span class="lmn-episode__thumb">
                {image ? (
                  <img src={imageUrl(client, image, { width: 240, height: 135 })} alt="" loading="lazy" width={240} height={135} />
                ) : (
                  <span class="lmn-card__placeholder">{episode.Name}</span>
                )}
                {percent > 0 && percent < 100 && <ProgressBar percent={percent} />}
              </span>
              <span class="lmn-episode__body">
                <span class="lmn-episode__title">
                  {episode.IndexNumber}. {episode.Name}
                </span>
                {runtime && <span class="lmn-episode__runtime">{runtime}</span>}
                {episode.Overview && <span class="lmn-episode__overview">{episode.Overview}</span>}
              </span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}
```

`client/src/views/details/SeriesDetails.tsx`:
```tsx
import { useEffect, useState } from 'preact/hooks';
import type { BaseItem } from '../../api/types';
import { detailsHash } from '../../compat/jellyfin';
import { resumeTicks } from '../../playback/play';
import { strings } from '../../strings';
import type { ViewContext } from '../context';
import { metaFor } from './badges';
import { CastRow } from './CastRow';
import { DetailsHeader } from './DetailsHeader';
import { EpisodeList } from './EpisodeList';
import { SimilarRow } from './SimilarRow';
import { computeSmartPlay, type SmartPlay } from './smartPlay';
import { useItemActions } from './useItemActions';

const seasonLabel = (season: BaseItem): string => (season.IndexNumber === 0 ? strings.specials : season.Name);

interface Props {
  series: BaseItem;
  initialSeasonId?: string;
  ctx: ViewContext;
}

export function SeriesDetails({ series, initialSeasonId, ctx }: Props) {
  const actions = useItemActions(series, ctx);
  const [seasons, setSeasons] = useState<BaseItem[]>([]);
  const [seasonId, setSeasonId] = useState<string | undefined>(initialSeasonId);
  const [episodesBySeason, setEpisodesBySeason] = useState<Record<string, BaseItem[]>>({});
  const [smartPlay, setSmartPlay] = useState<SmartPlay | null>(null);

  const storeEpisodes = (id: string, items: BaseItem[]): void => setEpisodesBySeason((current) => ({ ...current, [id]: items }));

  useEffect(() => {
    let cancelled = false;
    const empty = { Items: [] as BaseItem[] };
    (async () => {
      const [seasonResult, resume, nextUp] = await Promise.all([
        ctx.api.getSeasons(series.Id),
        ctx.api.getResumeForSeries(series.Id).catch(() => empty),
        ctx.api.getNextUp(series.Id).catch(() => empty),
      ]);
      if (cancelled) return;
      const list = seasonResult.Items;
      const defaultSeason = list.find((s) => (s.IndexNumber ?? 0) > 0) ?? list[0];
      const target = resume.Items[0] ?? nextUp.Items[0];
      setSeasons(list);
      setSeasonId(initialSeasonId ?? target?.SeasonId ?? defaultSeason?.Id);

      let first: BaseItem | undefined;
      if (defaultSeason) {
        const firstSeason = (await ctx.api.getEpisodes(series.Id, defaultSeason.Id)).Items;
        if (cancelled) return;
        storeEpisodes(defaultSeason.Id, firstSeason);
        first = firstSeason[0];
      }
      setSmartPlay(computeSmartPlay(resume.Items[0], nextUp.Items[0], first));
    })().catch(() => {
      if (!cancelled) ctx.onFallback();
    });
    return () => {
      cancelled = true;
    };
  }, [series.Id]);

  useEffect(() => {
    if (!seasonId || episodesBySeason[seasonId]) return;
    ctx.api
      .getEpisodes(series.Id, seasonId)
      .then((result) => storeEpisodes(seasonId, result.Items))
      .catch(() => undefined);
  }, [seasonId]);

  const episodes = seasonId ? episodesBySeason[seasonId] : undefined;
  return (
    <article class="lmn-details lmn-details--series">
      <DetailsHeader
        item={series}
        client={ctx.client}
        primary={
          smartPlay
            ? { label: smartPlay.label, progress: smartPlay.progress, onClick: () => actions.play(smartPlay.episodeId, smartPlay.startTicks) }
            : null
        }
        meta={metaFor(series)}
        badges={[]}
        {...actions}
      />
      <section class="lmn-episodes-section" aria-label={strings.episodes}>
        <div class="lmn-episodes-header">
          <h2>{strings.episodes}</h2>
          {seasons.length > 0 && (
            <select
              class="lmn-season-select"
              aria-label={strings.season}
              value={seasonId}
              onChange={(e) => setSeasonId((e.target as HTMLSelectElement).value)}
            >
              {seasons.map((s) => (
                <option key={s.Id} value={s.Id}>
                  {seasonLabel(s)}
                </option>
              ))}
            </select>
          )}
        </div>
        {episodes && <EpisodeList episodes={episodes} client={ctx.client} onPlay={(ep) => actions.play(ep.Id, resumeTicks(ep))} />}
      </section>
      <CastRow people={series.People ?? []} client={ctx.client} onSelect={(p) => ctx.navigate(detailsHash(p.Id, series.ServerId))} />
      <SimilarRow itemId={series.Id} ctx={ctx} />
    </article>
  );
}
```

In `DetailsView.tsx`, add `import { SeriesDetails } from './SeriesDetails';` and replace `resolveDetails` with:
```tsx
export async function resolveDetails(api: LumenApi, id: string): Promise<ResolvedDetails | null> {
  const item = await api.getItem(id);
  if (item.Type === 'Movie' || item.Type === 'Series') return { item };
  if (item.Type === 'Season' && item.SeriesId) return { item: await api.getItem(item.SeriesId), seasonId: item.Id };
  return null;
}
```
Replace the final `return` with:
```tsx
  return resolved.item.Type === 'Movie' ? (
    <MovieDetails item={resolved.item} ctx={ctx} />
  ) : (
    <SeriesDetails series={resolved.item} initialSeasonId={resolved.seasonId} ctx={ctx} />
  );
```

- [ ] **Step 3: Run the client checks**

Expected: the smart-play (2) and series (5) tests pass, and the movie details tests still pass.

- [ ] **Step 4: Verify on the dev server**

Run `./scripts/dev.sh` and hard-reload.

Expected:
- Opening **Lumen Show** shows "Play S1:E1", a season selector, and Season 1's episodes with thumbnails and runtimes.
- Play S1E1 for about 10 s, stop, and return to the show. The button reads "Resume S1:E1" with a progress bar.

- [ ] **Step 5: Commit**

```bash
git add client
git commit -m "feat(client): add series details with smart play and season browsing" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 27: TV navigation and focus restoration

**Files:**
- Create: `client/src/components/useAutoFocus.ts`
- Modify:
  - `client/src/views/home/homeStore.ts`
  - `client/src/views/home/HomeView.tsx`
  - `client/src/views/details/MovieDetails.tsx`, `client/src/views/details/SeriesDetails.tsx`
  - `client/src/styles/lumen.css`
  - `client/test/setup.ts`
- Test: `client/src/components/useAutoFocus.test.tsx`, plus a new case in `client/src/views/home/HomeView.test.tsx`

**Interfaces:**
- Consumes: the views from Tasks 24–26.
- Produces:
  - `useAutoFocus(ref, ready, layout, preferredItemId?)`
  - In `homeStore`: `rememberSelection(userId, itemId, scrollY)` and `getSelection(userId)`

- [ ] **Step 1: Write the failing tests**

`client/src/components/useAutoFocus.test.tsx`:
```tsx
import { render } from '@testing-library/preact';
import { useRef } from 'preact/hooks';
import { describe, expect, it } from 'vitest';
import type { Layout } from '../compat/jellyfin';
import { useAutoFocus } from './useAutoFocus';

function Harness({ layout, preferred }: { layout: Layout; preferred?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useAutoFocus(ref, true, layout, preferred);
  return (
    <div ref={ref}>
      <button>first</button>
      <button class="lmn-autofocus">primary</button>
      <button data-item-id="abc123">card</button>
    </div>
  );
}

describe('useAutoFocus', () => {
  it('focuses the primary action in TV layout', () => {
    const { getByText } = render(<Harness layout="tv" />);
    expect(document.activeElement).toBe(getByText('primary'));
  });

  it('restores focus to the previously selected item', () => {
    const { getByText } = render(<Harness layout="tv" preferred="abc123" />);
    expect(document.activeElement).toBe(getByText('card'));
  });

  it('does not move focus on desktop or mobile', () => {
    (document.activeElement as HTMLElement | null)?.blur();
    render(<Harness layout="desktop" />);
    expect(document.activeElement).toBe(document.body);
  });
});
```

Add to `client/src/views/home/HomeView.test.tsx` (inside the `describe`), and add `getSelection` to the `./homeStore` import:
```tsx
  it('remembers the selected card so returning home can restore it', async () => {
    const ctx = makeContext(createFakeClient(routes({ 'Lumen/Home': home })));
    render(<HomeView ctx={ctx} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Alpha' }));

    expect(getSelection('user1')?.itemId).toBe('m1');
  });
```

Run: `cd client && npx vitest run src/components/useAutoFocus.test.tsx src/views/home; cd ..`

Expected: FAIL. `useAutoFocus` and `getSelection` aren't resolved.

- [ ] **Step 2: Implement**

`client/src/components/useAutoFocus.ts`:
```ts
import type { RefObject } from 'preact';
import { useEffect } from 'preact/hooks';
import type { Layout } from '../compat/jellyfin';

const SAFE_ID = /^[\w-]+$/;

/**
 * TV layout only: D-pad users need a focused element, pointer users don't. Focus goes to the previously selected item
 * if present, else the view's primary action (.lmn-autofocus), else its first button. jellyfin-web's own focus
 * manager then handles the arrow keys inside #lmn-root.
 */
export function useAutoFocus(ref: RefObject<HTMLElement>, ready: boolean, layout: Layout, preferredItemId?: string): void {
  useEffect(() => {
    const root = ref.current;
    if (!ready || layout !== 'tv' || !root) return;
    const preferred =
      preferredItemId && SAFE_ID.test(preferredItemId) ? root.querySelector<HTMLElement>(`[data-item-id="${preferredItemId}"]`) : null;
    (preferred ?? root.querySelector<HTMLElement>('.lmn-autofocus') ?? root.querySelector<HTMLElement>('button'))?.focus();
  }, [ready, layout, preferredItemId]);
}
```

Append to `client/src/views/home/homeStore.ts`:
```ts
let selection: { userId: string; itemId: string; scrollY: number } | null = null;

export function rememberSelection(userId: string, itemId: string, scrollY: number): void {
  selection = { userId, itemId, scrollY };
}

export function getSelection(userId: string): { itemId: string; scrollY: number } | undefined {
  return selection?.userId === userId ? { itemId: selection.itemId, scrollY: selection.scrollY } : undefined;
}
```

Edit `client/src/views/home/HomeView.tsx`:
- Change the hooks import to `import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';`.
- Add `import { useAutoFocus } from '../../components/useAutoFocus';`.
- Extend the homeStore import with `getSelection, rememberSelection`.
- After the `useState` calls, add:
```tsx
  const rootRef = useRef<HTMLDivElement>(null);
  const previous = getSelection(ctx.userId);
  useAutoFocus(rootRef, home !== null, ctx.layout, previous?.itemId);
  useLayoutEffect(() => {
    if (home && previous) window.scrollTo({ top: previous.scrollY });
  }, [home !== null]);
```
- Replace `select` with:
```tsx
  const select = (item: BaseItem, row: HomeRow): void => {
    rememberSelection(ctx.userId, item.Id, window.scrollY);
    if (item.Type === 'Episode' || row.Type === 'ContinueWatching') play(item);
    else open(item);
  };
```
- Add `ref={rootRef}` to the outer `<div class={`lmn-home...`}>`.

Edit `MovieDetails.tsx` and `SeriesDetails.tsx` the same way in each:
- Add `import { useRef } from 'preact/hooks';`, merging it with the existing hooks import.
- Add `import { useAutoFocus } from '../../components/useAutoFocus';`.
- Add `const rootRef = useRef<HTMLElement>(null);` and `useAutoFocus(rootRef, true, ctx.layout);`.
- Add `ref={rootRef}` to the `<article>`.

Append to `client/test/setup.ts`:
```ts
// jsdom does not implement scrolling.
window.scrollTo = () => undefined;
```

Append to `client/src/styles/lumen.css`:
```css
/* TV layout: large, always-visible focus for D-pad navigation. */
.layout-tv .lmn-card:focus,
.layout-tv .lmn-episode:focus,
.layout-tv .lmn-button:focus,
.layout-tv .lmn-person:focus,
.layout-tv .lmn-season-select:focus {
  outline: 4px solid var(--lmn-accent);
  outline-offset: 3px;
}
.layout-tv .lmn-card:focus {
  transform: scale(1.08);
}
```

- [ ] **Step 3: Run the client checks**

Expected: all tests pass, including the 4 new ones.

- [ ] **Step 4: Verify the TV layout manually**

In the dev server's browser, go to user settings → Display → Layout, choose **TV**, and reload.

Expected:
- On home, the hero's Play button is focused.
- Arrow Down moves into the first row, Arrow Right moves along it, and Enter opens a movie with its Play button focused.
- Back (Backspace/Escape) returns home with the same card focused.

Set Layout back to **Auto** afterwards.

- [ ] **Step 5: Commit**

```bash
git add client
git commit -m "feat(client): add TV focus handling and home focus/scroll restoration" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Phase D: End-to-end tests, CI, and release

### Task 28: End-to-end tests against a real Jellyfin

**Files:**
- Create:
  - `e2e/package.json` (via npm), `e2e/tsconfig.json`, `e2e/playwright.config.ts`
  - `e2e/support/api.ts`, `e2e/support/global-setup.ts`, `e2e/support/login.ts`
  - `e2e/specs/home.spec.ts`, `e2e/specs/details.spec.ts`, `e2e/specs/playback.spec.ts`, `e2e/specs/fallback.spec.ts`
  - `e2e/specs/restricted-user.spec.ts`, `e2e/specs/curated.spec.ts`, `e2e/specs/admin.spec.ts`, `e2e/specs/tv-layout.spec.ts`
  - `scripts/e2e-local.sh`
- Test: the specs themselves

**Interfaces:**
- Consumes: the whole plugin; `scripts/gen-test-media.sh` (Task 18).
- Produces:
  - `npm test` in `e2e/` runs against `LUMEN_E2E_BASE_URL` (default `http://localhost:8096`) with media at `LUMEN_E2E_MEDIA_PATH` (as seen by the server; `/media` in CI).
  - `support/api.ts` exports `api`, `authenticate`, `loadState`, `ADMIN`, `KID`, and `BASE_URL`.

Local runs need Chromium's system libraries. If `npx playwright test` reports missing libraries such as `libnss3`, ask the user to run `! sudo npx --prefix e2e playwright install-deps chromium` once. Until then, CI (Task 29) is the source of truth for E2E. Do not skip or delete specs to make a local run pass.

- [ ] **Step 1: Initialize the E2E package**

Run:
```bash
mkdir -p e2e/support e2e/specs && cd e2e
npm init -y >/dev/null
npm pkg set name=lumen-e2e private=true type=module scripts.test="playwright test"
npm pkg delete main
npm install -D @playwright/test typescript @types/node
npx playwright install chromium
cd ..
```

`e2e/tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "noEmit": true,
    "skipLibCheck": true,
    "types": ["node"]
  },
  "include": ["**/*.ts"]
}
```

`e2e/playwright.config.ts`:
```ts
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './specs',
  globalSetup: './support/global-setup.ts',
  fullyParallel: false,
  workers: 1, // specs share one server and some change its configuration
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: process.env.LUMEN_E2E_BASE_URL ?? 'http://localhost:8096',
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
```

- [ ] **Step 2: Write the support code**

`e2e/support/api.ts`:
```ts
import { readFileSync, writeFileSync } from 'node:fs';

export const BASE_URL = process.env.LUMEN_E2E_BASE_URL ?? 'http://localhost:8096';
export const MEDIA_PATH = process.env.LUMEN_E2E_MEDIA_PATH ?? '/media';
export const ADMIN = { name: 'admin', password: 'lumen-admin' };
export const KID = { name: 'kid', password: 'kid-pass' };

const STATE_FILE = new URL('../.state.json', import.meta.url);
const CLIENT_HEADER = 'MediaBrowser Client="Lumen E2E", Device="Playwright", DeviceId="lumen-e2e", Version="1.0.0"';

export interface Auth {
  token: string;
  userId: string;
}

export interface E2EState {
  admin: Auth;
  kid: Auth;
  /** Movie and series ids by name. */
  items: Record<string, string>;
  libraries: { movies: string; shows: string };
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'DELETE';
  token?: string;
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined>;
}

export async function api<T = unknown>(path: string, options: RequestOptions = {}): Promise<T> {
  const url = new URL(path.replace(/^\//, ''), BASE_URL.endsWith('/') ? BASE_URL : `${BASE_URL}/`);
  for (const [key, value] of Object.entries(options.query ?? {})) {
    if (value !== undefined) url.searchParams.set(key, String(value));
  }
  const response = await fetch(url, {
    method: options.method ?? 'GET',
    headers: {
      Authorization: options.token ? `${CLIENT_HEADER}, Token="${options.token}"` : CLIENT_HEADER,
      ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  if (!response.ok) throw new Error(`${options.method ?? 'GET'} ${path} -> ${response.status} ${await response.text()}`);
  const text = await response.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

export async function authenticate(user: { name: string; password: string }): Promise<Auth> {
  const result = await api<{ AccessToken: string; User: { Id: string } }>('/Users/AuthenticateByName', {
    method: 'POST',
    body: { Username: user.name, Pw: user.password },
  });
  return { token: result.AccessToken, userId: result.User.Id };
}

export async function waitFor<T>(probe: () => Promise<T | undefined>, timeoutMs: number, what: string): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await probe().catch(() => undefined);
    if (value !== undefined) return value;
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 1000));
  }
}

export function saveState(state: E2EState): void {
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

export function loadState(): E2EState {
  return JSON.parse(readFileSync(STATE_FILE, 'utf8')) as E2EState;
}

export async function resetLumen(): Promise<void> {
  await api('/Lumen/Admin/Config/Reset', { method: 'POST', token: loadState().admin.token });
}
```

`e2e/support/global-setup.ts`:
```ts
import { ADMIN, BASE_URL, KID, MEDIA_PATH, api, authenticate, saveState, waitFor, type Auth } from './api';

const noRemoteMetadata = (types: string[]) => ({
  LibraryOptions: {
    EnableRealtimeMonitor: false,
    TypeOptions: types.map((Type) => ({ Type, MetadataFetchers: [], ImageFetchers: [] })),
  },
});

async function setPolicy(admin: Auth, userId: string, change: (policy: Record<string, unknown>) => Record<string, unknown>): Promise<void> {
  const user = await api<{ Policy: Record<string, unknown> }>(`/Users/${userId}`, { token: admin.token });
  await api(`/Users/${userId}/Policy`, { method: 'POST', token: admin.token, body: change(user.Policy) });
}

/** Idempotent: completes the startup wizard, creates libraries and users, and resets Lumen's config. */
export default async function globalSetup(): Promise<void> {
  await waitFor(async () => ((await fetch(`${BASE_URL}/health`)).ok ? true : undefined), 120_000, 'server health');

  const info = await api<{ StartupWizardCompleted: boolean }>('/System/Info/Public');
  if (!info.StartupWizardCompleted) {
    await api('/Startup/Configuration', {
      method: 'POST',
      body: { UICulture: 'en-US', MetadataCountryCode: 'US', PreferredMetadataLanguage: 'en' },
    });
    await api('/Startup/User');
    await api('/Startup/User', { method: 'POST', body: { Name: ADMIN.name, Password: ADMIN.password } });
    await api('/Startup/Complete', { method: 'POST' });
  }

  const admin = await authenticate(ADMIN);
  await api('/Lumen/ClientConfig', { token: admin.token }).catch(() => {
    throw new Error('Lumen is not loaded on the server (GET /Lumen/ClientConfig failed). Is the plugin installed?');
  });

  const existing = await api<{ Name: string }[]>('/Library/VirtualFolders', { token: admin.token });
  const ensureLibrary = async (name: string, collectionType: string, folder: string, types: string[]) => {
    if (existing.some((f) => f.Name === name)) return;
    await api('/Library/VirtualFolders', {
      method: 'POST',
      token: admin.token,
      query: { name, collectionType, paths: `${MEDIA_PATH}/${folder}`, refreshLibrary: true },
      body: noRemoteMetadata(types),
    });
  };
  await ensureLibrary('Movies', 'movies', 'movies', ['Movie']);
  await ensureLibrary('Shows', 'tvshows', 'tv', ['Series', 'Season', 'Episode']);
  await api('/Library/Refresh', { method: 'POST', token: admin.token });

  const count = async (type: string) =>
    (await api<{ TotalRecordCount: number }>('/Items', {
      token: admin.token,
      query: { userId: admin.userId, recursive: true, includeItemTypes: type, limit: 0 },
    })).TotalRecordCount;
  await waitFor(async () => ((await count('Movie')) >= 3 && (await count('Episode')) >= 6 ? true : undefined), 180_000, 'library scan');

  const libraries = await api<{ Name: string; ItemId: string }[]>('/Library/VirtualFolders', { token: admin.token });
  const libraryId = (name: string) => libraries.find((l) => l.Name === name)!.ItemId;

  const users = await api<{ Name: string; Id: string }[]>('/Users', { token: admin.token });
  const kidId =
    users.find((u) => u.Name === KID.name)?.Id ??
    (await api<{ Id: string }>('/Users/New', { method: 'POST', token: admin.token, body: { Name: KID.name, Password: KID.password } })).Id;
  // Hidden users make the login page show the manual username/password form.
  await setPolicy(admin, admin.userId, (p) => ({ ...p, IsHidden: true }));
  await setPolicy(admin, kidId, (p) => ({ ...p, IsHidden: true, EnableAllFolders: false, EnabledFolders: [libraryId('Shows')] }));
  const kid = await authenticate(KID);

  const all = await api<{ Items: { Id: string; Name: string }[] }>('/Items', {
    token: admin.token,
    query: { userId: admin.userId, recursive: true, includeItemTypes: 'Movie,Series' },
  });

  // Re-seed defaults now that libraries exist (per-library Recently Added rows).
  await api('/Lumen/Admin/Config/Reset', { method: 'POST', token: admin.token });

  saveState({
    admin,
    kid,
    items: Object.fromEntries(all.Items.map((i) => [i.Name, i.Id])),
    libraries: { movies: libraryId('Movies'), shows: libraryId('Shows') },
  });
}
```

`e2e/support/login.ts`:
```ts
import type { Page } from '@playwright/test';

/** Signs in through jellyfin-web's manual login form (users are hidden, so the form is shown directly). */
export async function login(page: Page, user: { name: string; password: string }): Promise<void> {
  await page.goto('/web/#/login');
  await page.locator('#txtManualName').fill(user.name);
  await page.locator('#txtManualPassword').fill(user.password);
  await page.locator('.manualLoginForm button[type="submit"]').click();
  await page.waitForURL(/#\/home/);
}
```

- [ ] **Step 3: Write the specs**

`e2e/specs/home.spec.ts`:
```ts
import { expect, test } from '@playwright/test';
import { ADMIN, api, loadState } from '../support/api';
import { login } from '../support/login';

test('Lumen replaces the home screen with a hero and rows', async ({ page }) => {
  await login(page, ADMIN);

  await expect(page.locator('#lmn-root .lmn-home')).toBeVisible();
  await expect(page.locator('#lmn-root .lmn-hero')).toBeVisible();
  await expect(page.getByRole('region', { name: 'Recently Added in Movies' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Recently Added in Shows' })).toBeVisible();
  await expect(page.locator('#reactRoot .skinBody').first()).toBeHidden();
});

test('a partially watched movie appears in Continue Watching', async ({ page }) => {
  const { admin, items } = loadState();
  await api(`/UserItems/${items['Lumen Beta']}/UserData`, {
    method: 'POST',
    token: admin.token,
    query: { userId: admin.userId },
    body: { PlaybackPositionTicks: 50_000_000, LastPlayedDate: new Date().toISOString() },
  });

  await login(page, ADMIN);

  await expect(page.getByRole('region', { name: 'Continue Watching' }).getByRole('button', { name: /Lumen Beta/ })).toBeVisible();
});
```

`e2e/specs/details.spec.ts`:
```ts
import { expect, test } from '@playwright/test';
import { ADMIN, api, loadState } from '../support/api';
import { login } from '../support/login';

test('movie details are rendered by Lumen, including the local trailer', async ({ page }) => {
  const { items } = loadState();
  await login(page, ADMIN);

  await page.goto(`/web/#/details?id=${items['Lumen Alpha']}`);

  const details = page.locator('#lmn-root .lmn-details--movie');
  await expect(details.getByRole('img', { name: 'Lumen Alpha' })).toBeVisible();
  await expect(details.getByText('2001')).toBeVisible();
  await expect(details.getByRole('button', { name: 'Trailer' })).toBeVisible();
});

test('series details offer smart play and season browsing', async ({ page }) => {
  const { items } = loadState();
  await login(page, ADMIN);

  await page.goto(`/web/#/details?id=${items['Lumen Show']}`);

  const details = page.locator('#lmn-root .lmn-details--series');
  await expect(details.getByRole('button', { name: /S1:E1/ })).toBeVisible();
  await expect(details.getByRole('combobox', { name: 'Season' }).locator('option')).toHaveText(['Season 1', 'Season 2']);
  await expect(details.locator('.lmn-episode')).toHaveCount(3);
});

test('items Lumen does not handle stay on the stock details page', async ({ page }) => {
  const { admin, items } = loadState();
  const episodes = await api<{ Items: { Id: string }[] }>(`/Shows/${items['Lumen Show']}/Episodes`, {
    token: admin.token,
    query: { userId: admin.userId },
  });
  await login(page, ADMIN);

  await page.goto(`/web/#/details?id=${episodes.Items[0]!.Id}`);

  await expect(page.locator('#itemDetailPage:not(.hide)')).toBeVisible();
  await expect(page.locator('#lmn-root')).toBeHidden();
});
```

`e2e/specs/playback.spec.ts`:
```ts
import { expect, test } from '@playwright/test';
import { ADMIN, loadState } from '../support/api';
import { login } from '../support/login';

test("Play hands off to jellyfin-web's own player", async ({ page }) => {
  const { items } = loadState();
  await login(page, ADMIN);
  await page.goto(`/web/#/details?id=${items['Lumen Alpha']}`);

  await page.locator('#lmn-root').getByRole('button', { name: 'Play' }).click();

  await expect(page).toHaveURL(/#\/video/);
  await expect(page.locator('video').first()).toBeVisible();
});
```

`e2e/specs/fallback.spec.ts`:
```ts
import { expect, test } from '@playwright/test';
import { ADMIN, api, loadState, resetLumen } from '../support/api';
import { login } from '../support/login';

test.afterEach(resetLumen);

test('turning off home takeover restores the stock home', async ({ page }) => {
  const { admin } = loadState();
  const config = await api<Record<string, unknown>>('/Lumen/Admin/Config', { token: admin.token });
  await api('/Lumen/Admin/Config', { method: 'POST', token: admin.token, body: { ...config, HomeTakeover: false } });

  await login(page, ADMIN);

  await expect(page.locator('#indexPage')).toBeVisible();
  await expect(page.locator('#lmn-root .lmn-home')).toHaveCount(0);
});

test('a failed compatibility check shows the stock UI and is reported to admins', async ({ page }) => {
  const { admin } = loadState();
  await page.addInitScript(() => {
    (window as unknown as { __LUMEN_FORCE_COMPAT_FAIL__: boolean }).__LUMEN_FORCE_COMPAT_FAIL__ = true;
  });

  await login(page, ADMIN);

  await expect(page.locator('#indexPage')).toBeVisible();
  await expect
    .poll(async () =>
      (await api<{ FailedChecks: string[] }[]>('/Lumen/Admin/Diagnostics', { token: admin.token })).some((d) => d.FailedChecks.includes('forced')),
    )
    .toBe(true);
});
```

`e2e/specs/restricted-user.spec.ts`:
```ts
import { expect, test } from '@playwright/test';
import { KID, api, loadState } from '../support/api';
import { login } from '../support/login';

const MOVIES = /^Lumen (Alpha|Beta|Gamma)$/;

test('a user without access to the Movies library never sees movies', async ({ page }) => {
  const { kid } = loadState();
  const home = await api<{ Hero: { Item: { Name: string } }[]; Rows: { Items: { Name: string }[] }[] }>('/Lumen/Home', { token: kid.token });
  const names = [...home.Hero.map((h) => h.Item.Name), ...home.Rows.flatMap((r) => r.Items.map((i) => i.Name))];

  expect(names).toContain('Lumen Show');
  expect(names.filter((n) => MOVIES.test(n))).toEqual([]);

  await login(page, KID);
  await expect(page.locator('#lmn-root .lmn-home')).toBeVisible();
  await expect(page.locator('#lmn-root').getByRole('button', { name: MOVIES })).toHaveCount(0);
});
```

`e2e/specs/curated.spec.ts`:
```ts
import { expect, test } from '@playwright/test';
import { ADMIN, api, loadState, resetLumen } from '../support/api';
import { login } from '../support/login';

let collectionId: string | undefined;

test.afterEach(async () => {
  await resetLumen();
  if (collectionId) await api('/Items', { method: 'DELETE', token: loadState().admin.token, query: { ids: collectionId } });
});

test('a curated collection row shows the collection', async ({ page }) => {
  const { admin, items } = loadState();
  collectionId = (
    await api<{ Id: string }>('/Collections', {
      method: 'POST',
      token: admin.token,
      query: { name: 'Lumen Picks', ids: [items['Lumen Gamma'], items['Lumen Alpha']].join(',') },
    })
  ).Id;
  const config = await api<{ Sections: unknown[] } & Record<string, unknown>>('/Lumen/Admin/Config', { token: admin.token });
  await api('/Lumen/Admin/Config', {
    method: 'POST',
    token: admin.token,
    body: {
      ...config,
      Sections: [
        { Id: crypto.randomUUID(), Type: 'Curated', Enabled: true, Title: null, Params: [{ Name: 'collectionId', Value: collectionId }] },
        ...config.Sections,
      ],
    },
  });

  await login(page, ADMIN);

  const row = page.getByRole('region', { name: 'Lumen Picks' });
  await expect(row.getByRole('button', { name: 'Lumen Alpha' })).toBeVisible();
  await expect(row.getByRole('button', { name: 'Lumen Gamma' })).toBeVisible();
});
```

`e2e/specs/admin.spec.ts`:
```ts
import { expect, test } from '@playwright/test';
import { ADMIN } from '../support/api';
import { login } from '../support/login';

test('the Lumen dashboard page loads its settings', async ({ page }) => {
  await login(page, ADMIN);

  await page.goto('/web/#/configurationpage?name=Lumen');

  await expect(page.getByRole('group', { name: 'Home sections' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Move Continue Watching down/ })).toBeVisible();
});
```

`e2e/specs/tv-layout.spec.ts`:
```ts
import { expect, test } from '@playwright/test';
import { ADMIN } from '../support/api';
import { login } from '../support/login';

test('TV layout: focus starts on the hero and arrow keys move through rows', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('layout', 'tv'));
  await login(page, ADMIN);

  await expect(page.locator('#lmn-root .lmn-hero .lmn-button--primary')).toBeFocused();

  await page.keyboard.press('ArrowDown');
  await expect(page.locator('#lmn-root .lmn-card:focus')).toHaveCount(1);
  const first = await page.locator('#lmn-root .lmn-card:focus').getAttribute('data-item-id');

  await page.keyboard.press('ArrowRight');
  await expect(page.locator('#lmn-root .lmn-card:focus')).not.toHaveAttribute('data-item-id', first!);
});
```

`scripts/e2e-local.sh`:
```bash
#!/usr/bin/env bash
# Runs the E2E suite against the local portable dev server (see scripts/dev.sh).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
[[ -d "$ROOT/e2e/fixtures/media/movies" ]] || "$ROOT/scripts/gen-test-media.sh"
"$ROOT/scripts/dev.sh"
cd "$ROOT/e2e"
LUMEN_E2E_MEDIA_PATH="$ROOT/e2e/fixtures/media" npx playwright test "$@"
```

- [ ] **Step 4: Run the suite locally (or confirm the dependency blocker)**

Run:
```bash
chmod +x scripts/e2e-local.sh && ./scripts/e2e-local.sh
```

Expected: `12 passed`.

If Chromium fails to launch because of missing system libraries, stop here and ask the user to run `! sudo npx --prefix e2e playwright install-deps chromium`, then re-run. Do not mark this step done until the suite runs either locally or in CI (Task 29).

If the login helper times out, open `e2e/test-results/*/trace.zip` with `npx playwright show-trace` and confirm the login form selectors (`#txtManualName`, `#txtManualPassword`, `.manualLoginForm button[type="submit"]`) against the running jellyfin-web. Fix them in `support/login.ts`, which is the only place they appear.

- [ ] **Step 5: Commit**

```bash
git add e2e scripts/e2e-local.sh
git commit -m "test: add Playwright end-to-end suite against a real Jellyfin server" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 29: Continuous integration and nightly compatibility runs

**Files:**
- Create: `.github/workflows/ci.yml`, `.github/workflows/e2e.yml`, `.github/workflows/nightly.yml`, `.github/dependabot.yml`

**Interfaces:**
- Consumes: client scripts (Task 8), `dotnet test` (Tasks 2–20), the E2E suite (Task 28), and `scripts/gen-test-media.sh`.
- Produces:
  - `e2e.yml` is a reusable workflow with inputs `jellyfin-image` and `report-name`.
  - `ci.yml` runs on pull requests and on pushes to `main`.
  - `nightly.yml` runs the E2E suite against `jellyfin/jellyfin:unstable` every day.

- [ ] **Step 1: Write the workflows**

`.github/workflows/ci.yml`:
```yaml
name: CI
on:
  pull_request:
  push:
    branches: [main]

permissions:
  contents: read

jobs:
  client:
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: client
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 24
          cache: npm
          cache-dependency-path: client/package-lock.json
      - run: npm ci
      - run: npm run lint
      - run: npm run typecheck
      - run: npm test
      - run: npm run build
      - run: npm run size
      - uses: actions/upload-artifact@v4
        with:
          name: client-dist
          path: client/dist

  server:
    needs: client
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-dotnet@v4
        with:
          dotnet-version: 10.0.x
      - uses: actions/download-artifact@v4
        with:
          name: client-dist
          path: client/dist
      - run: dotnet test --nologo -p:SkipClientBuild=true
      - run: dotnet publish src/Jellyfin.Plugin.Lumen -c Release -o artifacts/plugin --nologo -p:SkipClientBuild=true
      - uses: actions/upload-artifact@v4
        with:
          name: plugin
          path: artifacts/plugin/Jellyfin.Plugin.Lumen.dll

  e2e:
    needs: server
    uses: ./.github/workflows/e2e.yml
    with:
      jellyfin-image: jellyfin/jellyfin:12.2
```

`.github/workflows/e2e.yml`:
```yaml
name: E2E
on:
  workflow_call:
    inputs:
      jellyfin-image:
        type: string
        required: true
      report-name:
        type: string
        default: e2e-report

permissions:
  contents: read

jobs:
  e2e:
    runs-on: ubuntu-latest
    timeout-minutes: 30
    steps:
      - uses: actions/checkout@v4
      - uses: actions/download-artifact@v4
        with:
          name: plugin
          path: plugin
      - name: Generate fixture media
        run: |
          sudo apt-get update && sudo apt-get install -y ffmpeg
          FFMPEG=ffmpeg ./scripts/gen-test-media.sh "$PWD/media"
      - name: Start Jellyfin with Lumen installed
        run: |
          mkdir -p config/plugins/Lumen_ci cache
          cp plugin/Jellyfin.Plugin.Lumen.dll config/plugins/Lumen_ci/
          docker run -d --name jellyfin -p 8096:8096 \
            -v "$PWD/config:/config" -v "$PWD/cache:/cache" -v "$PWD/media:/media:ro" \
            "${{ inputs.jellyfin-image }}"
      - uses: actions/setup-node@v4
        with:
          node-version: 24
          cache: npm
          cache-dependency-path: e2e/package-lock.json
      - working-directory: e2e
        run: |
          npm ci
          npx playwright install --with-deps chromium
          npx playwright test
        env:
          CI: 'true'
          LUMEN_E2E_BASE_URL: http://localhost:8096
          LUMEN_E2E_MEDIA_PATH: /media
      - if: failure()
        run: docker logs jellyfin > jellyfin.log 2>&1 || true
      - if: failure()
        uses: actions/upload-artifact@v4
        with:
          name: ${{ inputs.report-name }}-${{ github.run_attempt }}
          path: |
            e2e/playwright-report
            e2e/test-results
            jellyfin.log
```

`.github/workflows/nightly.yml`:
```yaml
name: Nightly compatibility
on:
  schedule:
    - cron: '17 6 * * *'
  workflow_dispatch:

permissions:
  contents: read

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 24
      - uses: actions/setup-dotnet@v4
        with:
          dotnet-version: 10.0.x
      - run: dotnet publish src/Jellyfin.Plugin.Lumen -c Release -o artifacts/plugin --nologo
      - uses: actions/upload-artifact@v4
        with:
          name: plugin
          path: artifacts/plugin/Jellyfin.Plugin.Lumen.dll

  e2e:
    needs: build
    strategy:
      fail-fast: false
      matrix:
        image: ['jellyfin/jellyfin:latest', 'jellyfin/jellyfin:unstable']
    uses: ./.github/workflows/e2e.yml
    with:
      jellyfin-image: ${{ matrix.image }}
      report-name: e2e-report-${{ strategy.job-index }}
```

`.github/dependabot.yml`:
```yaml
version: 2
updates:
  - package-ecosystem: nuget
    directory: /
    schedule: { interval: weekly }
    ignore:
      # Jellyfin packages are bumped deliberately together with targetAbi.
      - dependency-name: 'Jellyfin.*'
  - package-ecosystem: npm
    directory: /client
    schedule: { interval: weekly }
  - package-ecosystem: npm
    directory: /e2e
    schedule: { interval: weekly }
  - package-ecosystem: github-actions
    directory: /
    schedule: { interval: weekly }
```

- [ ] **Step 2: Validate the workflow syntax locally**

Run:
```bash
python3 -c "import yaml,glob; [yaml.safe_load(open(f)) for f in glob.glob('.github/**/*.yml', recursive=True)]; print('ok')"
```
Expected: `ok`. If `yaml` is missing, run `pip install --user pyyaml` first.

- [ ] **Step 3: Commit**

```bash
git add .github
git commit -m "ci: add CI, reusable E2E workflow, nightly compatibility runs, and Dependabot" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

These workflows run only after the user approves creating the GitHub repository and pushing to it. Task 30's final step asks before doing either.

---

### Task 30: Release pipeline, plugin repository manifest, and documentation

**Files:**
- Create:
  - `.github/workflows/release.yml`, `scripts/update-manifest.mjs`, `manifest.json`
  - `README.md`, `CHANGELOG.md`, `docs/manual-test-checklist.md`
- Modify: `docs/superpowers/specs/2026-10-04-lumen-home-ui-design.md` (record the plan-time adjustments)
- Test: `scripts/update-manifest.test.mjs` (`node --test`)

**Interfaces:**
- Consumes: the CI build (Task 29).
- Produces:
  - `node scripts/update-manifest.mjs --version 0.1.0.0 --zip <path> --url <url> --changelog <text>` adds or replaces a version entry in `manifest.json`.
  - Repository URL for users: `https://raw.githubusercontent.com/ahappysloth/jellyfin-plugin-lumen/main/manifest.json`

- [ ] **Step 1: Write the failing manifest test**

`scripts/update-manifest.test.mjs`:
```js
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { updateManifest } from './update-manifest.mjs';

test('adds a version entry with the zip checksum, newest first, replacing an existing entry', () => {
  const dir = mkdtempSync(join(tmpdir(), 'lumen-manifest-'));
  const manifestPath = join(dir, 'manifest.json');
  const zipPath = join(dir, 'lumen.zip');
  writeFileSync(zipPath, 'zip-bytes');
  writeFileSync(
    manifestPath,
    JSON.stringify([{ guid: '186f9cb8-ba8e-4555-a700-ffa619f48264', name: 'Lumen', versions: [{ version: '0.1.0.0', changelog: 'old' }] }]),
  );

  updateManifest({ manifestPath, version: '0.2.0.0', zipPath, url: 'https://x/0.2.zip', changelog: 'new', now: new Date('2026-10-06T00:00:00Z') });
  updateManifest({ manifestPath, version: '0.2.0.0', zipPath, url: 'https://x/0.2b.zip', changelog: 'newer', now: new Date('2026-10-06T00:00:00Z') });

  const [plugin] = JSON.parse(readFileSync(manifestPath, 'utf8'));
  assert.deepEqual(plugin.versions.map((v) => v.version), ['0.2.0.0', '0.1.0.0']);
  assert.deepEqual(plugin.versions[0], {
    version: '0.2.0.0',
    changelog: 'newer',
    targetAbi: '12.1.0.0',
    sourceUrl: 'https://x/0.2b.zip',
    checksum: createHash('md5').update('zip-bytes').digest('hex'),
    timestamp: '2026-10-06T00:00:00Z',
  });
});
```

Run: `node --test scripts/update-manifest.test.mjs`

Expected: FAIL with `Cannot find module '.../update-manifest.mjs'`.

- [ ] **Step 2: Implement the manifest updater and the initial manifest**

`scripts/update-manifest.mjs`:
```js
// Adds (or replaces) a release in the Jellyfin plugin repository manifest. Usage:
//   node scripts/update-manifest.mjs --version 0.1.0.0 --zip artifacts/lumen_0.1.0.0.zip --url <download url> --changelog "<text>"
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';

export const TARGET_ABI = '12.1.0.0';

export function updateManifest({ manifestPath, version, zipPath, url, changelog, now = new Date() }) {
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const plugin = manifest[0];
  const entry = {
    version,
    changelog,
    targetAbi: TARGET_ABI,
    sourceUrl: url,
    checksum: createHash('md5').update(readFileSync(zipPath)).digest('hex'),
    timestamp: now.toISOString().replace(/\.\d{3}Z$/, 'Z'),
  };
  plugin.versions = [entry, ...plugin.versions.filter((v) => v.version !== version)];
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { values } = parseArgs({
    options: {
      manifest: { type: 'string', default: 'manifest.json' },
      version: { type: 'string' },
      zip: { type: 'string' },
      url: { type: 'string' },
      changelog: { type: 'string', default: '' },
    },
  });
  updateManifest({ manifestPath: values.manifest, version: values.version, zipPath: values.zip, url: values.url, changelog: values.changelog });
}
```

`manifest.json`:
```json
[
  {
    "guid": "186f9cb8-ba8e-4555-a700-ffa619f48264",
    "name": "Lumen",
    "overview": "A cinematic home screen and details pages for Jellyfin.",
    "description": "Lumen replaces Jellyfin's web home screen and movie/series details pages with a cinematic hero, personalized rows, and a redesigned details view. Works in browsers and the official mobile and desktop apps. Falls back to the stock UI automatically.",
    "owner": "ahappysloth",
    "category": "General",
    "imageUrl": null,
    "versions": []
  }
]
```

Run: `node --test scripts/update-manifest.test.mjs`

Expected: `pass 1`.

- [ ] **Step 3: Write the release workflow**

`.github/workflows/release.yml`:
```yaml
name: Release
on:
  push:
    tags: ['v*']

permissions:
  contents: write

jobs:
  release:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          ref: main
          fetch-depth: 0
      - uses: actions/setup-node@v4
        with:
          node-version: 24
      - uses: actions/setup-dotnet@v4
        with:
          dotnet-version: 10.0.x
      - name: Compute version
        id: v
        run: |
          TAG="${GITHUB_REF_NAME#v}"
          echo "semver=$TAG" >> "$GITHUB_OUTPUT"
          echo "jellyfin=$TAG.0" >> "$GITHUB_OUTPUT"
      - name: Build and test
        run: |
          git checkout "$GITHUB_REF_NAME"
          (cd client && npm ci && npm run lint && npm test && npm run build && npm run size)
          dotnet test --nologo -p:SkipClientBuild=true
          dotnet publish src/Jellyfin.Plugin.Lumen -c Release -o artifacts/plugin --nologo -p:SkipClientBuild=true \
            -p:Version=${{ steps.v.outputs.jellyfin }} -p:AssemblyVersion=${{ steps.v.outputs.jellyfin }} -p:FileVersion=${{ steps.v.outputs.jellyfin }}
          (cd artifacts/plugin && zip -j "../lumen_${{ steps.v.outputs.jellyfin }}.zip" Jellyfin.Plugin.Lumen.dll)
      - name: Extract changelog section
        run: |
          awk "/^## \\[${{ steps.v.outputs.semver }}\\]/{flag=1;next}/^## \\[/{flag=0}flag" CHANGELOG.md > release-notes.md
          test -s release-notes.md || { echo "CHANGELOG.md has no section for ${{ steps.v.outputs.semver }}"; exit 1; }
      - name: Create GitHub release
        env:
          GH_TOKEN: ${{ github.token }}
        run: gh release create "$GITHUB_REF_NAME" "artifacts/lumen_${{ steps.v.outputs.jellyfin }}.zip" --title "Lumen ${{ steps.v.outputs.semver }}" --notes-file release-notes.md
      - name: Publish to the plugin repository manifest
        run: |
          git checkout main
          node scripts/update-manifest.mjs --version "${{ steps.v.outputs.jellyfin }}" \
            --zip "artifacts/lumen_${{ steps.v.outputs.jellyfin }}.zip" \
            --url "https://github.com/${{ github.repository }}/releases/download/${GITHUB_REF_NAME}/lumen_${{ steps.v.outputs.jellyfin }}.zip" \
            --changelog "$(cat release-notes.md)"
          git config user.name "github-actions[bot]"
          git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
          git commit -am "chore(release): publish ${{ steps.v.outputs.semver }} to manifest"
          git push origin main
```

- [ ] **Step 4: Write the documentation**

`CHANGELOG.md`:
```markdown
# Changelog

All notable changes to Lumen are documented here. Versions follow SemVer; Jellyfin sees them as `MAJOR.MINOR.PATCH.0`.

## [0.1.0]

### Added
- Cinematic home screen: rotating hero with optional muted local-trailer previews, and admin-configurable rows
  (Continue Watching, Next Up, Recently Added, Because You Watched, Genre, New For You, Curated).
- Movie and series details pages with resume, smart play, seasons, cast, and "More Like This".
- Admin dashboard page for sections, hero, and diagnostics.
- Automatic fallback to the stock UI on any error or jellyfin-web incompatibility.
```

`README.md`:
```markdown
# Lumen for Jellyfin

Lumen gives Jellyfin a cinematic home screen and redesigned movie/series details pages:
- a rotating hero with optional muted trailer previews
- personalized rows: Because You Watched, daily genre picks, New For You, curated collections
- details pages built around one-click play and resume

It is a single, self-contained server plugin, with no other plugins required. Whenever anything goes wrong, Jellyfin's stock UI takes over automatically.

## Requirements

- Jellyfin **12.1 or newer**

## Install

1. Dashboard → Plugins → Manage Repositories → **+**, then add
   `https://raw.githubusercontent.com/ahappysloth/jellyfin-plugin-lumen/main/manifest.json`.
2. Dashboard → Plugins → Catalog → **Lumen** → Install. Restart Jellyfin.
3. Dashboard → Plugins → **Lumen** to configure the hero and home sections.

## Where Lumen appears

Lumen changes Jellyfin's *web* interface, so it appears wherever that interface runs:

| Client | Lumen |
|---|---|
| Desktop and mobile browsers | ✅ |
| Official Jellyfin iOS and Android **mobile** apps | ✅ |
| Jellyfin Media Player / desktop app | ✅ |
| LG webOS, Xbox | Best effort (not regularly tested) |
| Samsung Tizen app | ❌ (it ships its own copy of the web interface) |
| Android TV / Google TV, Apple TV (Swiftfin), Roku, Infuse, Streamyfin | ❌ (native apps) |

## Running alongside other plugins

Lumen injects its own script and hides only the stock home and details pages while it shows its own. It can run next to plugins that use the File Transformation plugin, but plugins that also redesign the home screen will be hidden while Lumen's home is showing. If you use one of those, turn off "Replace the home screen" in Lumen's settings.

## Playback tips

Lumen starts playback in Jellyfin's own player, so codecs and transcoding behave exactly as they do without it. For smooth playback:
- enable hardware transcoding (Dashboard → Playback → Transcoding)
- prefer clients that direct-play your files

## Troubleshooting

If Lumen doesn't appear:
1. Hard-reload the page.
2. Check Dashboard → Plugins → Lumen → **Diagnostics**. It lists clients whose compatibility check failed. Please include it in bug reports.

## Development

- Prerequisites: Node 24 and `./scripts/setup-dev.sh`. It installs the .NET 10 SDK and a portable Jellyfin into your home directory; no sudo or Docker needed.
- `./scripts/dev.sh` builds the plugin and (re)starts a dev server at http://localhost:8096.
- Client tests: `cd client && npm test`. Server tests: `dotnet test`. End-to-end tests: `./scripts/e2e-local.sh`.

## License

GPL-3.0. See [LICENSE](LICENSE).
```

`docs/manual-test-checklist.md`:
```markdown
# Manual test checklist (before each release)

Run against the release build on the latest stable Jellyfin.

## Desktop browser (Chrome or Firefox)

- [ ] Home: hero rotates, a trailer preview plays after the delay, and the rows load.
- [ ] Clicking a Continue Watching card resumes playback in the stock player.
- [ ] Movie details: Play/Resume, Trailer, Watched, and Favorite all work, and More Like This opens another title.
- [ ] Series details: smart play label is correct, switching seasons works, and clicking an episode plays it.
- [ ] Back from details returns to home at the same scroll position.
- [ ] Unticking "Replace the home screen" in the dashboard restores the stock home after a reload.

## Official iOS app

- [ ] Home and details render; buttons are easy to tap; layout stacks on narrow screens.
- [ ] Playback starts in the native player from Lumen's Play buttons.

## TV layout (desktop browser with Display → Layout = TV)

- [ ] Focus starts on the hero's Play button, and arrow keys move through rows and buttons.
- [ ] Returning home restores focus to the last selected card.

## Admin

- [ ] Reorder, add, and remove sections; save; the result is reflected on home.
- [ ] An invalid setting (collection hero source with no collection) shows an error and saves nothing.
- [ ] The Diagnostics section lists any reported compatibility failures.
```

- [ ] **Step 5: Record the plan-time adjustments in the spec**

In `docs/superpowers/specs/2026-10-04-lumen-home-ui-design.md`, add this section just before `## 8. Risks`:
```markdown
## 7.6 Plan-time adjustments (2026-10-06)

- No `build.yaml`. The release workflow builds the zip and `manifest.json` directly.
- The dev server runs on Jellyfin's default port 8096.
- The admin page logic is a second Vite bundle (`lumen-admin.js`, TypeScript + Preact, unit-tested). `configPage.html` is a thin shell that loads it from `/Lumen/Assets`.
- Home is served by `HomeController`. `LumenController` serves assets, client config, and diagnostics; `AdminController` serves the admin endpoints.
- Collection/playlist reading and trailer lookup sit behind small adapters (`ILinkedItemsReader`, `ITrailerLookup`), because Jellyfin implements them via static service locators. They are covered by end-to-end tests.
- `CHANGELOG.md` is maintained by hand (Keep a Changelog style). The release workflow publishes the section matching the tag and fails if it's missing.
```
In §7.1, replace `build.yaml, manifest.json` with `manifest.json`. Replace `configPage.js` with `(admin UI lives in client/src/admin)`. In §7.2, change the sentence saying CHANGELOG.md is generated at release so it says CHANGELOG.md is maintained by hand (see §7.6).

- [ ] **Step 6: Run everything once more**

Run:
```bash
source scripts/env.sh
node --test scripts/update-manifest.test.mjs
(cd client && npm run lint && npm run typecheck && npm test && npm run build && npm run size)
dotnet test --nologo
python3 -c "import yaml,glob; [yaml.safe_load(open(f)) for f in glob.glob('.github/**/*.yml', recursive=True)]; print('ok')"
```
Expected:
- The manifest test passes.
- All client checks pass and the bundle is within budget.
- `dotnet test` reports `Failed: 0`.
- The YAML check prints `ok`.

- [ ] **Step 7: Commit**

```bash
git add .github/workflows/release.yml scripts/update-manifest.mjs scripts/update-manifest.test.mjs manifest.json README.md CHANGELOG.md docs
git commit -m "chore: add release pipeline, plugin repository manifest, and docs" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 8: Ask before publishing**

Stop and ask the user before doing either of the following. Do not do them unprompted.

1. **Create the public GitHub repository and push `main`:**
   ```bash
   gh repo create ahappysloth/jellyfin-plugin-lumen --public --source . --push
   ```
2. **Tag the first release.** Do this only after CI is green on `main`:
   ```bash
   git tag v0.1.0 && git push origin v0.1.0
   ```
