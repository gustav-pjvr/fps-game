# Music

Recorded music from the VOiD1 "Free Game Menu Music Pack" (free, name your own price, 20 tracks,
https://void1gaming.itch.io/free-game-menu-music-pack). No generative AI was used for it.

## What plays where

| Where | Track | Behaviour |
|---|---|---|
| Every menu and the lobby (main menu, loadout, settings, room screens) | 5 Calm Rock!!, 7 Strange, 9 Space Debris, 10 Boundless Slumber, 15 Star Rock, 18 A Fool's Affair, 20 Diving into Spring | Shuffled, unheard tracks first (below). Fades in over 2.5 s, fades out over 1 s when a match starts. Starts on the first click or key press, because browsers refuse sound before one. |
| A Facility (indoor) match, solo or multiplayer | 12 Floating in the Abyss | Loops softly for the whole match. Fades with pausing and death like the other ambience, and a flash grenade muffles it with everything else. |
| A Valley (outdoor) match | none | The synthesized combat music of the Director and Uplink modes is unchanged. |

In a Facility match the recorded track replaces the synthesized combat mix: two pieces of music
would otherwise play at once.

## The shuffle (`src/audio/lobbyPlaylist.ts`)

Not a plain random pick. A track that has not been heard yet always comes first. Once all seven have
played the round starts over, and the track that just finished is left out of the first pick, so
nothing plays twice in a row. A track counts as heard after 20 seconds of it, or when it ends; a
quick skip leaves it unheard. The state is kept in `localStorage` (`hunter-n-goose.lobby-music`), so
a new visit starts with the tracks not heard last time.

## Volume

Lobby: master volume x music volume x 0.5 (`LOBBY_MUSIC_LEVEL`). Indoor match: master x music x 0.22
(`BED_LEVEL` in `SoundEngine.ts`), softer than the lobby. Both read the settings live, so the
sliders in Settings apply at once. The music slider already existed for the combat mix.

## Files and licence

The game plays `public/assets/music/<slug>.mp3`, converted from the pack's WAVs with
`ffmpeg -i <track>.wav -map_metadata -1 -c:a libmp3lame -q:a 5 <slug>.mp3` (about 8 MB for the
eight). Slugs: `calm-rock`, `strange`, `space-debris`, `boundless-slumber`, `star-rock`,
`a-fools-affair`, `diving-into-spring`, `floating-in-the-abyss`.

The pack's licence (read 2026-11-04): use in a game, including a commercial one, is allowed; no
credit is required (VOiD1 would like one); distributing the source files is not allowed, and neither
is letting players save or export them. Because the repository is public, `public/assets/music/` is
ignored by git (`.gitignore`) and the files exist only in the working folder and the deployed site.
To restore them on another machine, download the pack again from the link above and convert the
eight tracks with the command above. Without the files the game still runs: the lobby gives up
quietly after three failed tracks, and an indoor match plays without music (a 404 shows in the
browser console).
