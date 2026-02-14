# Changelog

All notable changes to **ClipMark** will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## [3.0.0] - 2026-02-14

### Added
- **Multi-Source Video Support**: Bookmark videos from multiple platforms beyond YouTube
  - **Vimeo**: Full player support with Vimeo Player SDK
  - **Loom**: Embed support (limited: no programmatic seeking)
  - **Wistia**: Full player support with Wistia JS API
  - **Google Drive**: Embed support (limited: no programmatic seeking)
  - **Direct URLs**: Native HTML5 video player for .mp4, .webm, .ogg, .m3u8 files
- **Video Source Detection**: `parseVideoUrl()` replaces `extractVideoId()` with multi-platform URL parsing
  - Returns `{ sourceType, sourceId, sourceUrl }` for all supported platforms
  - Auto-detects platform from URL patterns
- **Player Adapter Architecture**: Unified `VideoPlayer` wrapper with platform-specific adapters
  - `VimeoPlayerAdapter`: Full Vimeo SDK integration with async time updates
  - `HTML5PlayerAdapter`: Native `<video>` element for direct video URLs
  - `WistiaPlayerAdapter`: Wistia JS API integration with queue system
  - `LoomPlayerAdapter`: Iframe embed with limitations warning (no seekTo/getCurrentTime)
  - `GoogleDrivePlayerAdapter`: Iframe embed with limitations warning (no seekTo/getCurrentTime)
- **VideoSourceBadge Component**: Shows platform icon and name for non-YouTube videos
- **Transcript Upload**: Upload SRT/VTT subtitle files for non-YouTube videos
  - `TranscriptUploadModal` component with file picker and preview
  - `/api/transcript/upload` endpoint parses SRT/VTT to segments
  - `TranscriptStatusBadge` shows transcript source (platform/srt/vtt/ai)
  - `TranscriptHelpModal` with instructions for creating free SRT files (Google Docs, Whisper, online tools)
- **AI Transcription**: Generate transcripts via Gemini for videos without transcripts
  - `/api/transcript/generate` endpoint with rate limiting (5/hour)
  - Works with direct video URLs
- **Data Migration**: Automatic migration of existing YouTube videos to new data structure
  - `migrateVideoData()` adds `sourceType: 'youtube'` and renames `videoId` to `sourceId`
  - Backward compatible: `videoId` field preserved for existing code

### Changed
- **Video Data Structure**: Extended to support multiple sources
  - New fields: `sourceType`, `sourceId`, `sourceUrl`, `transcript`
  - `transcript.segments` stores parsed subtitle/transcription data
  - `transcript.source` indicates origin ('platform', 'srt', 'vtt', 'ai')
- **AddVideoModal**: Detects source type, shows platform badge, fetches oEmbed metadata for Vimeo/Wistia
- **VideoCard/VideoListItem**: Source-aware thumbnails with fallback for unavailable thumbnails
- **Markdown Export**: Now source-aware, exports correct video URLs for all platforms
- **Export Footer**: Updated from "YouTube Bookmarking App" to "ClipMark"

### Files Modified
- `app.html` - Added multi-source support, player adapters, transcript UI (~800 lines)
- `transcript-server.js` - Added SRT/VTT parsing, upload and generate endpoints (~200 lines)

### Known Limitations
- **Loom**: No player control API - timestamp notes use estimated times, no programmatic seeking
- **Google Drive**: No player control API - timestamp notes use estimated times, no programmatic seeking
- **AI Transcription**: Rate limited to 5 transcriptions per hour
- **Direct URLs**: Some servers may not support seeking without proper range request headers
- **Private Videos**: Vimeo/Wistia private videos require embed allowlisting

---

## [Docs] - 2026-02-08

### Fixed
- **CLAUDE.md accuracy overhaul**: Corrected multiple outdated/inaccurate sections
  - Clarified that `transcript-server.js` is the unified backend (not a separate transcript-only server)
  - Documented authentication flow (Bearer tokens, bcryptjs, rate limiting, session management)
  - Added auth endpoints table (`/auth/register`, `/auth/login`, `/auth/logout`, `/auth/check`)
  - Added other endpoints table (`/bookmarks`, `/categories`, `/api/youtube/video`, `/api/gemini`, etc.)
  - Fixed server URL: port 3456 with auto-detection, not `http://localhost:3000`
  - Documented `viewCount` tracking mechanism (client-side increment, synced to server)
  - Documented watch time tracking (separate from view count, syncs every 30s)
  - Added `ytBookmarks_authToken` to localStorage keys
  - Expanded `index.html` description (share token redirects, CTA links to `/app`)
  - Added note about no automated tests and `/test` transcript testing UI
  - Updated dev commands to reflect that `transcript-server.js` serves the full app
  - Updated Co-Authored-By to Claude Opus 4.6

### Files Modified
- `CLAUDE.md`
- `CHANGELOG.md`

---

## [2.0.0] - 2025-01-29

### Changed (Rebranding)
- **Renamed app** from "VideoNoteSnatch" to "ClipMark"
- **New tagline**: "Mark the moments that matter"
- **New color scheme**: Emerald (#10b981) primary with gold (#fbbf24) accents (previously red)
- **New logo**: 5 options created in `/logos/` directory (ClipMark selected)
- **Split architecture**: Landing page (`index.html`) separated from main app (`app.html`)

### Added
- **Email signup notifications**: Admin receives email when new users register
  - Uses Resend API (SMTP blocked on Railway)
  - Branded HTML email template
  - Environment variables: `RESEND_API_KEY`, `ADMIN_EMAIL`, `EMAIL_FROM`
- **Logo assets**: SVG logos and favicons for 5 brand options
- **Logo preview page**: `/logos/preview.html` for comparing logo options

### Fixed
- Server routing updated to serve `app.html` for `/app` and `/admin` routes

---

## [Unreleased]

### Fixed
- **YouTube Live URL support**: Added support for `youtube.com/live/VIDEO_ID` URLs (used for past live streams)
  - Updated `extractVideoId()` in `app.html` to recognize live video URL format
  - Updated test page in `transcript-server.js` with same fix

### Added
- **Library View Modes**: Toggle between grid and list views in the video library
  - Grid/list toggle buttons in library header
  - New `VideoListItem` component for compact list view
  - List view shows thumbnail, title, tags, publish date, view count, and notes count
  - State persisted in `libraryViewMode`
- **Video View Count**: Track how many times each video has been opened
  - View count displayed on video thumbnails (grid view: bottom-left, list view: inline)
  - Eye icon indicator for view count
  - `handleSelectVideo` function increments count and opens video
  - `viewCount` field added to Video data structure
- **User Profiles**: Edit profile with first name, last name, email, and interests
  - New ProfileModal accessible from SettingsModal
  - YouTube category interests plus custom interest support
  - GET/PUT `/api/profile` endpoints
- **Video Sharing (User-to-User)**: Share videos with other ClipMark users
  - ShareModal with user search and autocomplete
  - Option to include notes as snapshot copies
  - Accept/decline workflow for recipients
  - PendingSharesDropdown notification in header
  - "Shared with me" tab in sidebar for accepted shares
- **Shared Video Playback**: Click shared videos to view in player with notes
  - Opens in embedded player instead of linking to YouTube
  - Shows "Shared by [username]" badge on shared videos
  - Recipients can add, edit, and delete notes on shared videos
- **Note Author Attribution**: Notes show first 3 letters of author's username
  - Author badge displayed on each note
  - Hover shows full username
- **Shared Notes Persistence**: PUT `/api/shares/library` endpoint saves shared video notes
- **Video Sharing (Email)**: Share videos via email invitation to non-users
  - Branded email invitation sent via Resend API
  - Share landing page with video preview
  - Auto-claim share after signup/login with token
  - 30-day token expiration
- **Share Rate Limiting**: Maximum 10 shares per hour per user
- **Sharing API Endpoints**:
  - `/api/users/search` - Search users by username
  - `/api/shares` - Create, list, accept, decline, revoke shares
  - `/api/shares/preview` - Public share preview for email links
  - `/api/shares/claim` - Claim email share after authentication
- **Data Storage**:
  - `data/shares.json` - Central share records
  - `data/users/{userId}/shared-with-me.json` - Per-user accepted shares

### Changed
- VideoCard now includes share button on hover
- SettingsModal now has "Edit Profile" link
- AuthModal supports embedded mode for share landing pages

### Fixed
- **Shared Video Toolbar**: "Get Context", "Enhance Notes", and "Download .md" now work for shared videos
  - `handleLoadContext` updated to use `displayVideo` instead of `activeVideo`
  - `handleEnhanceAllNotes` and `handleApplyEnhancements` updated to support shared videos
  - Enhancement toolbar now visible for shared videos
- **Shared Video Transcript**: Fixed transcript fetching for shared videos
  - Shared videos use `youtubeVideoId` property, not `videoId`
  - Updated `handleLoadContext` and `handleEnhanceAllNotes` to use correct property
- **Email Share Links**: Fixed share links pointing to wrong page
  - Links now go to `/app?share_token=xxx` instead of `/?share_token=xxx`
  - Landing page (`index.html`) redirects to `/app` if share_token is present
- **Registration Fields**: Added optional email, first name, last name to registration form
  - Fields saved to user profile on signup
  - Supports collecting user info when signing up via share link

### Known Issues
- **Session Persistence on Railway**: Sessions may be lost on redeploy (ephemeral filesystem)
  - Workaround: Log out and log back in after deployment
  - Future fix: Use Railway persistent volume or external session store

### Files Modified
- `transcript-server.js` - Added profile and sharing endpoints (~600 lines)
- `app.html` - Added ProfileModal, ShareModal, PendingSharesDropdown, VideoListItem components; library view toggle; view count tracking (~500 lines)
- `CLAUDE.md` - Updated documentation with new features and components

---

- **AI Note Enhancement**: Batch-process all notes for a video using Gemini AI to summarize and expand notes with transcript context
  - "Enhance Notes" button in toolbar below video player
  - Progress indicator during enhancement processing
  - Review modal for ambiguous notes with radio button selection for alternatives
  - Custom text input option when AI suggestions don't match user intent
- **Markdown Export**: Download notes as formatted Markdown (.md) file
  - Includes video title, publish date, and YouTube link
  - Notes organized by timestamp with bullet point formatting
  - Export watermark with app attribution
- **Extended Context Function**: New `getExtendedTranscriptContext()` for capturing complete thoughts (75 words before/after timestamp)
- **Enhancement Review Modal**: UI for reviewing and selecting AI-suggested note alternatives

### Changed
- Notes now render bullet point formatting (markdown-style `- ` prefixes) properly
- New toolbar section below video player for note enhancement actions

## [1.0.0] - 2026-01-22

### Added
- Initial release
- Bookmark YouTube videos with metadata
- Add timestamped notes during video playback
- Organize videos into custom categories
- Tag videos with keywords
- Optional AI summaries via Gemini API
- YouTube API integration for metadata
- Data persistence via localStorage and optional server backend
- Transcript context loading for notes
- Import/Export notes functionality
