# Changelog

All notable changes to **ClipMark** will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

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

### Added
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

### Files Modified
- `transcript-server.js` - Added profile and sharing endpoints (~600 lines)
- `app.html` - Added ProfileModal, ShareModal, PendingSharesDropdown components (~400 lines)
- `CLAUDE.md` - Updated documentation

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
