# Skip Intro: setting up Intro Skipper and SkipMe.db

Lumen's player shows **Skip Intro**, **Skip Recap**, **Skip Credits** and its next-episode card from Jellyfin's
*media segments*: the parts of a file the server knows as an intro, a recap, credits (outro), a preview or a
commercial. Lumen reads whatever segments Jellyfin has for the title playing. It doesn't find them itself, and
neither does Jellyfin: most files carry no segment data, so a **segment provider** plugin has to supply it.

This guide sets up the two most used ones, both from the Intro Skipper project:

- **[Intro Skipper](https://github.com/intro-skipper/intro-skipper)** finds intros, credits, recaps and previews by
  analysing your own files (audio fingerprints, silence, black frames, chapter names), on your server.
- **[SkipMe.db](https://github.com/intro-skipper/skipme.db-plugin)** downloads crowd-sourced intro, recap, credits and
  preview times for your movies and episodes from the SkipMe.db service. Optional: it fills in titles Intro Skipper
  hasn't analysed (or can't, such as a show with a single episode), with no analysis on your server.

You can use either or both. Facts below were checked against each plugin's README, wiki and manifest for Jellyfin 12.

## 1. Add the plugin repository

Both plugins come from Intro Skipper's own repository, not Jellyfin's default catalog.

1. **Dashboard → Plugins → Manage Repositories**, then add one named, say, "Intro Skipper", with the URL:

   ```
   https://intro-skipper.org/manifest.json
   ```

   Opening that address in a browser shows nothing: it answers according to the Jellyfin version that asks, which a
   browser doesn't send. Jellyfin gets the releases made for its version.
2. Back on **Dashboard → Plugins**, switch the filter to **All** or **Available**. A plugin that isn't installed yet
   isn't under **Installed**, which is where the page may open.

Requirements:

- **Jellyfin 12.** The current Intro Skipper release for Jellyfin 12 (12.0.6.0) is built for Jellyfin **12.2 or
  later**, so on 12.0 or 12.1 update Jellyfin first, or the catalog offers an older release or none. SkipMe.db works
  from 12.0.
- **Jellyfin's own ffmpeg** (`jellyfin-ffmpeg` 7.1.3-1 or newer), for Intro Skipper's audio fingerprints. The
  official `jellyfin/jellyfin` and `linuxserver/jellyfin` containers have it, and Debian-based installs get it from
  the `jellyfin-ffmpeg7` package. On macOS native installs, Intro Skipper's wiki explains how to build one.
- Intro Skipper's wiki recommends **TheTVDB** plugin (from Jellyfin's default catalog) for reliable series, season
  and episode identification.

If the plugins still don't show, reload the Plugins page without the browser's cache (Ctrl+F5, or Shift+Cmd+R on a
Mac).

## 2. Install them

1. In the catalog, open **Intro Skipper** and install it. Optionally install **SkipMe.db** the same way.
2. **Restart Jellyfin** (Dashboard → Restart). A plugin starts working only after the restart.
3. After the restart, each shows as **Active** under **Installed**. A plugin marked *NotSupported* was built for a
   different Jellyfin version: update Jellyfin, or the plugin.

## 3. Turn them on in each TV library

Jellyfin runs a segment provider only in the libraries that allow it:

1. **Dashboard → Libraries**, open the library's menu (⋯) and choose **Manage library**.
2. Under **Media segment providers**, tick **Intro Skipper** (and **SkipMe.db** if installed).
3. Their **order** is the order Jellyfin asks them in. It keeps what each one finds rather than only the first, so an
   episode both cover can have an intro from each (usually within a second or two of each other). Intro Skipper's
   analysis of your own files fits them best (another cut can be a few seconds different); if SkipMe.db's times are
   often off for a library's files, untick it there.
4. Save, and do the same for each library with shows (and movies, if you want credits there too).

## 4. Find the segments

- **Intro Skipper:** **Dashboard → Scheduled Tasks → Intro Skipper → Detect and Analyze Media Segments**, and press
  play to analyse the library now. The first run takes a while on a large library (each season's episodes are compared
  with each other); it then runs on its schedule, and new episodes are analysed as they arrive. Intro Skipper writes
  what it finds to Jellyfin's media segments by itself.
- **SkipMe.db:** its **Sync SkipMe.db Segment Database** task (in the same *Intro Skipper* category) runs daily at
  01:00 by default, at most once every eight hours, and asks Jellyfin to read the segments again when it's done.
- Jellyfin's own **Media Segment Scan** task (category *Library*) collects segments from every provider; run it if a
  title's segments don't appear after the providers have finished.

### What SkipMe.db sends and receives

SkipMe.db's sync sends the SkipMe.db service the catalogue ids of your movies and shows (TMDB, TVDB, IMDb or AniList
ids), and for some titles the season and episode number and the file's length, and receives the timestamps others
have marked. It sends no file names, paths, user names or watch history, but the ids it asks about do say which
titles are on your server (and the service sees your server's IP address). The timestamps are kept in a local cache
on your server.

Its **Share** tab (Dashboard → Plugins → SkipMe.db) is the other direction and is **opt-in**: nothing is shared until
you tick libraries, shows, seasons or movies there. Sharing uploads Intro Skipper's timestamps for those titles, with
their ids and lengths, and may ask TVMaze for a show's missing ids.

## 5. Check it worked

- **Lumen's Health tab** (Dashboard → Plugins → Lumen → Health), under **Skip Intro**:
  - *Intro Skipper and SkipMe.db*: installed and running (or why not);
  - *Segment providers in libraries*: names any TV library where a provider is unticked;
  - *Episodes with intros*: how many episodes have an intro segment so far ("1,204 of 3,310 episodes"), which fills
    in as the analysis runs.
- **Play an episode** of a show Intro Skipper has finished: **Skip Intro** shows at bottom right while the intro
  plays, and **Skip Credits** (or the next-episode card) at the credits.
- **Intro Skipper → Timestamps** (Dashboard → Plugins → Intro Skipper) lists what it found per library, show and
  season, and lets you correct a segment by hand.

## 6. Choose what each kind of segment does

Each user chooses, on each device, in Jellyfin's **Settings → Playback → Media Segment Actions**: for Intro, Preview,
Recap, Commercial and Outro (credits) segments, one of:

- **Ask To Skip:** Lumen shows the Skip button (out of the box, for intros and credits).
- **Skip:** Lumen skips it by itself and says "Skipped intro", with **Undo**.
- **None:** nothing (out of the box, for the rest).

Intro Skipper also has its own setting to skip automatically from the server; a user's own Media Segment Actions take
precedence, so most people leave it off and use these.

## When something's off

- **No Skip button on one show:** check that its library allows the provider (step 3) and that the analysis has
  reached it (Intro Skipper → Timestamps). A show whose episodes have different intros, or a season with one
  episode, gives Intro Skipper's audio comparison nothing to match: SkipMe.db, or a file's chapter names ("Intro",
  "Opening"), can fill in there.
- **Skip lands a few seconds off:** a different cut of the episode than the times were marked on. Edit it in Intro
  Skipper → Timestamps, or untick SkipMe.db for that library if its times are the ones that are off.
- **The task fails at once:** usually ffmpeg without the fingerprinting Intro Skipper needs (see the requirements).
  Intro Skipper's [troubleshooting page](https://github.com/intro-skipper/intro-skipper/wiki/Troubleshooting) has
  more.
- Lumen's README has the rest of how its player uses segments: [Skip Intro and credits](../README.md#skip-intro-and-credits).
