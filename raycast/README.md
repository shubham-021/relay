# Relay for Raycast

Browse your Relay TorBox library, fetch CDN links, and launch videos directly in your local media player from Raycast.

## Features

- **OAuth 2.0 PKCE Sign-In**: Connects directly to your Relay server using Relay's built-in OAuth flow.
- **Smart Hub + Instant Search**:
  - Open **Relay** to resume from **Continue Watching** or browse **Movies**, **Shows**, and **Other**.
  - Start typing immediately on the home screen to search across your entire library.
  - TV Shows jump straight to episodes if there is 1 season, or provide season sections and a season filter dropdown if multiple seasons exist.
- **Direct Player Binary Launch**:
  - Configure a `.app` bundle (e.g. `/Applications/IINA.app`, `/Applications/VLC.app`) or a CLI binary (e.g. `/opt/homebrew/bin/mpv`, `/Applications/IINA.app/Contents/MacOS/iina-cli`).
  - Automatically passes resume timestamps for `mpv`, `iina-cli`, and `vlc` when enabled.
- **Quick Actions**:
  - `Enter`: Fetch CDN link and play in configured player
  - `Cmd+C`: Copy CDN link to clipboard
  - `Cmd+Shift+P`: Configure player binary / arguments
  - `Cmd+R`: Sync TorBox library

## Setup (Local Development in Raycast)

1. Make sure your Relay server is accessible (default `https://relay.kshiyo.dpdns.org` or your self-hosted URL).
2. Install dependencies inside `raycast/`:
   ```bash
   cd raycast
   npm install
   ```
3. In Raycast, run **Import Extension** and select this `raycast/` folder (or run `npm run dev` with `@raycast/api` / `ray`).
4. On first launch, set your **Relay Server URL** in Extension Preferences and sign in via OAuth in your browser.

