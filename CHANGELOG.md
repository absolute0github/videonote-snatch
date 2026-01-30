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
