# ChengJing Notes v0.8.2

<p align="center">
  <a href="README.md">繁體中文</a>
  &nbsp;·&nbsp;
  <a href="README.en.md"><strong>English</strong></a>
</p>

<p align="center"><img src="build/icon-1024.png" width="128" alt="ChengJing Notes icon"></p>

ChengJing is a Traditional-Chinese, local-first visual notes and AI research desktop application. Its central idea is a “Second Brain” that turns everyday fragments, meeting notes, and whiteboard plans into neurons, then helps reveal relationships between them.

> A local-first, frameless visual notebook and Second Brain. Supports OpenRouter, Gemma 4, and Traditional Chinese, Simplified Chinese, English, Japanese, and Korean interfaces.

## Use and licensing

ChengJing can be freely obtained, used, studied, copied, modified, forked, and shared for free. You may use it in personal projects, company workflows, or at large scale, and you may use your own tools or an AI agent to modify it.

The only substantive restriction is resale. You may not sell ChengJing itself, its source code, an installer, or a fork or modified version whose main functionality and value still come from ChengJing. Changing the name, appearance, or a small amount of code does not turn ChengJing into a product that may be sold as your own.

You may use ChengJing at work and integrate it into a larger product or service that adds substantial functionality of its own. The restriction is on selling ChengJing itself or a substantially equivalent modified version, not on ordinary business use.

This is source-available software rather than OSI-approved “Open Source” software, because the Open Source Definition does not allow a license to prohibit selling. It is nevertheless free to use, modify, fork, and share under the project’s [ChengJing Free Use and No Resale License 1.0](LICENSE.md). For a plain-language Traditional-Chinese explanation, see [LICENSE.zh-TW.md](LICENSE.zh-TW.md). Third-party packages and assets remain subject to their own licenses.

## Install

Official installers are currently available for Apple Silicon Macs and Windows ARM64, Intel, and AMD x64 systems:

- [Download the latest release from GitHub Releases](https://github.com/Coyoter/chengjing-notes/releases/latest)
- [Windows ARM64: choose the ARM64 Installer in the latest release](https://github.com/Coyoter/chengjing-notes/releases/latest)
- [Windows Intel/AMD x64: choose the x64 Installer in the latest release](https://github.com/Coyoter/chengjing-notes/releases/latest)
- [Apple Silicon Mac: choose the ARM64 DMG in the latest release](https://github.com/Coyoter/chengjing-notes/releases/latest)

Use the ARM64 installer on a Windows ARM computer. Use the x64 installer on a regular Intel or AMD computer. The Windows installers are not currently signed with a commercial code-signing certificate, so SmartScreen may show “Unknown publisher,” and Smart App Control may block installation. Do not lower the security settings of your main computer just to install the app.

The macOS build is currently ad-hoc signed and is not notarized with an Apple Developer ID. If macOS blocks it, try opening it once, then use System Settings → Privacy & Security → Open Anyway.

## Main features

- Today workspace, quick snippets, and global command search
- Card library, block editor, tags, properties, backlinks, version history, archive, and trash
- Domain → topic → card knowledge hierarchy; moving or renaming a topic does not damage card content
- Global tags shared by cards, whiteboards, journals, and snippets
- Daily journals, cross-editor todos, a custom calendar, date timeline, due dates, source highlights, and restore
- Interactive whiteboard with cards and files placed directly on the canvas, zooming, dragging, connections, minimap, and auto-layout
- Project kanban boards with multiple boards and lists, drag-and-drop, dates, tags, checklists, attachments, search, filters, sorting, and favorites
- Tag database with table, kanban, stage, and custom-tag views
- Import for PDF, DOCX, Markdown, plain text, HTML, images, audio, and video
- Web article capture and YouTube source cards
- OpenRouter integration with local AES-256-GCM key storage, curated models, model synchronization, and custom model names
- Gemma 4 E2B local WebGPU generation with on-demand download, progress display, and removal
- Global AI assistant, card actions, and a safe action plan for creating, editing, and deleting content
- Snippets that can be saved, pinned, edited, copied, converted into cards, or sent to a whiteboard, board, or Second Brain
- System-wide quick capture: ⌘\ on macOS and Ctrl+\ on Windows by default, with customizable shortcuts
- Difference-based undo/redo for global actions, with native text editing behavior preserved while typing
- Wish Pool with anonymous feedback, two-level replies, and in-app moderation
- 3D Second Brain combining cards, journals, whiteboards, todos, and snippets
- Shared Brain with private neurons kept separate from discovered shared neurons
- AI Second Brain for text, semantic, time, and context-based relationship suggestions, with reversible links and daily reflection
- Google cloud and local backup can run together; Google uses only ChengJing's hidden App Data and keeps a current snapshot plus a previous-day rescue point
- Complete JSON backup/restore, Markdown plus attachment ZIP export, and incremental attachment backup with hash-based deduplication
- Follow-system, light, dark, and low-saturation ink themes
- Global interface scale at 90%, 100%, 110%, and 120%
- Five interface languages: Traditional Chinese, Simplified Chinese, English, Japanese, and Korean
- Semi-automatic updates through GitHub, Cloudflare Worker, release feeds, edge cache, and KV fallback layers

## Selected recent releases

### v0.8.2: compact Google button spacing

- Removes the unnecessary fixed minimum width from the Google connection button, eliminating the extra blank space after the label instead of redistributing it.
- The button now follows its localized content width while keeping 12px before the visible G, 10px between icon and label, and 12px after the label.
- Pixel-level QA verifies the insets, vertical alignment, structural spacing, and zero unused width across all five interface languages.

### v0.8.1: visible Google connection button

- Fixes the invisible Google connection button in 0.8.0, where a damaged embedded PNG left only a transparent click target.
- ChengJing now draws the neutral pill button itself and uses Google's official local SVG color G with visible localized text instead of a full-button PNG.
- Visual QA now verifies the rendered size, colors, text, actual SVG load, and a pre-connection screenshot. Google Brand Verification status does not control whether this button appears.

### v0.8.0: Google cloud and local backup

- A simpler settings surface with two independent methods: Google Cloud and Local
- A recommended 30-minute cloud interval that runs only while ChengJing is open and idle, and skips unchanged content
- A current cloud snapshot plus one previous-day rescue point; rescue data expires after 48 hours while the current snapshot remains
- Emergency previous-day restore is collapsed by default, clearly warned, confirmed again, and preceded by a local safety copy
- Cross-device conflict protection pauses uploads instead of silently overwriting a newer cloud snapshot
- Content-addressed attachments upload only once; local AI models, API keys, and OAuth tokens are excluded
- System-browser OAuth with PKCE, state validation, loopback callback, and only the non-sensitive `drive.appdata` scope
- Silent AES-256-GCM token storage on macOS without Keychain prompts, and silent DPAPI protection on Windows

### v0.7.5: native Windows ARM64 and x64 support

- Separate native ARM64 and Intel/AMD x64 installers
- Stable `ChengJing.exe` executable name while the desktop shortcut and interface remain “澄境”
- Native Windows title bar, Segoe UI, Ctrl/Alt shortcuts, and system-tray quick capture
- System-tray show/quit behavior, login background startup, and single-database-process protection
- Architecture-aware updates with file-size and SHA-256 verification before opening the installer

### v0.7.4: hierarchical todos

- Add subtasks from a todo’s context menu, with multiple levels, indentation, and completion progress
- Completing all subtasks completes the parent; reopening a subtask reopens its ancestors
- Completing a parent completes its subtree; adding a subtask to a completed parent reopens the parent
- Subtasks inherit the source card and initial due date

### v0.7.3: unscheduled next steps

- Convert snippets, card-library cards, and board cards into unscheduled todos without removing the original content
- Preserve the source link so users can return to the original context
- Prevent duplicate conversions from the same source while keeping different sources distinct

### v0.7.2: read the original PDF alongside extracted text

- Replace the unreliable white PDF embed with a recognizable source card and real first-page preview
- Open a full reader with page navigation, keyboard controls, zoom, fit-to-width, and saved copies
- Remove the original PDF while keeping extracted, searchable, editable text

### v0.7.1: visible editing entry points

- Put Edit first in context menus for cards, board cards, todos, snippets, highlights, and whiteboards
- Keep full card editing while using lightweight overlays for small items
- Do not treat an untouched, empty journal date as a real card or searchable content

### v0.7.0: long-term data and performance foundation

- Difference-based global undo/redo without copying the whole database for every action
- Viewport loading for the private Second Brain, with complete search across private data
- Indexed search and batched display for cards, databases, todos, snippets, and highlights
- File-system attachment storage with database paths, sizes, and SHA-256 metadata
- Incremental attachment backups and safer cleanup of unreferenced assets

## AI setup

### OpenRouter

1. Open Settings.
2. Choose OpenRouter.
3. Enter your own API key and select Save key.
4. Choose a curated model, synchronize the latest models, or enter `provider/model-name` manually.

The key is not stored in ordinary settings, the notes database, or backups. It is stored locally in the ChengJing data directory using AES-256-GCM encryption. This avoids storing the key in plain text, but it does not provide the same protection as a hardware-backed keychain if someone can fully read your macOS account files.

### Gemma 4 E2B

1. Open Settings.
2. Choose Gemma 4 E2B.
3. Select Download model.

The model is approximately 2.9–3.2 GB. After the first download, it can run offline. Generated text is not sent to OpenRouter or Google.

### Google cloud backup

1. Open Settings → Backup and restore.
2. In Google Cloud, choose Sign in with Google.
3. Keep automatic backup enabled. The default interval is 30 minutes while ChengJing is open and idle.

ChengJing requests only `drive.appdata`, so it can manage only its own hidden backup space and cannot read any other Drive file. Cloud and local backup can run together. Emergency previous-day restore is only for an important deletion that has already synced; do not use it for everyday restore.

## Local data

Cards, whiteboards, journals, chats, and attachments are stored in IndexedDB inside Electron’s user-data directory. We recommend enabling both Google cloud and local backup; Complete JSON Backup can also be saved to an external drive.

## Development and verification

```bash
npm install
npm run dev
npm run typecheck
npm test
npm run qa
npm run qa:functional
npm run qa:second-brain
npm run qa:database-share
npm run qa:journal-polish
npm run qa:board-ime-security
npm run qa:frameless-themes
npm run qa:i18n
npm run qa:update
npm run qa:tags
npm run qa:auto-backup
npm run qa:live-google-backup
npm run qa:task-timeline
npm run smoke:electron-main
npm run smoke:electron
npm run dist:mac
```

The current validation suite covers TypeScript, frontend and Electron tests, persistence, version comparison, release parsing, DMG selection, dark/light/ink themes, responsive layouts, whiteboard interactions, Second Brain flows, database and tag operations, five-language UI, backups, update fallbacks, WebGPU, encrypted local storage, and packaged-app startup.

## Current boundaries

- This is a local-first single-user desktop app. Google accounts are used only for private backup; ChengJing does not provide its own account system, real-time multiplayer collaboration, or a mobile app.
- Daily reflection is a text aid for review, not medical or psychological diagnosis, and does not claim to read personality or the subconscious directly.
- Media cards can store media, subtitles, and notes; a separate built-in Whisper model is not included.
- URL import is currently used instead of a browser Web Clipper. A separate Chrome extension may be added later.
- Official Windows installers support ARM64 and Intel/AMD x64. Official macOS installers currently target Apple Silicon; Intel Mac and Linux installers are not published.
