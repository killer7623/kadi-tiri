# Kali Ni Tidi online

Play Kali Ni Tidi (3 of spades) with friends and family using a 4 letter room code.
Empty seats are filled by computer players, and someone can join late and take over a computer seat.

There is nothing to install. The server uses only Node.js (version 18 or newer) and no packages.

## Try it on your own computer

    node server.js

Open http://localhost:3000. Anyone on the same Wi-Fi can join at http://YOUR-COMPUTER-IP:3000.

To let people anywhere join for one evening, run a tunnel next to it, for example
`cloudflared tunnel --url http://localhost:3000` or `ngrok http 3000`, and share the link it prints.

## Install it as a phone app (no app store)

Once the server is online at an https address, open that address on the phone:

- Android (Chrome): tap Install app on the home page, or the browser menu and Install app.
- iPhone and iPad (Safari): tap Share, then Add to Home Screen.

It then opens full screen with its own icon, keeps the screen awake during a game, and vibrates when it is your turn.
Installing needs https, which Render and similar hosts provide. It will not install from a plain http address, except localhost.

## Put it online for good (Render, free plan)

1. Put this folder in a new GitHub repository.
2. On render.com choose New, then Web Service, and pick the repository.
3. Set Runtime to Node and Start Command to `node server.js`. The build command can stay empty.
4. Deploy. Render gives you an address like https://kali-ni-tidi.onrender.com. Share that.

Railway, Fly.io and any small VPS work the same way: they just need to run `node server.js`.
The port comes from the PORT environment variable.

## Real store apps (Google Play, App Store)

The installable version above is usually enough. If you want a listing in the stores:

- Easiest for Google Play: go to pwabuilder.com, enter your https address, and download the Android package it builds.
- Native shell with Capacitor: the `mobile` folder wraps your online game in an Android and iOS app.
  1. Open `mobile/capacitor.config.json` and replace the server.url value with your https address. Change appId to your own (for example com.yourname.kalinitidi).
  2. In the `mobile` folder run `npm install`, then `npx cap add android` and or `npx cap add ios`, then `npx cap sync`.
  3. Run `npx cap open android` (Android Studio) or `npx cap open ios` (Xcode, needs a Mac) and build from there.
  4. Store accounts are separate: Google Play is a one-time fee, and the Apple Developer Program is a yearly fee.
- Apple can reject apps that only show a website. If you go to the App Store, expect to add some native touches first.
- The app loads the game from your server, so the server must be running for anyone to play.

## Voice chat

Everyone at the table can talk to each other. Players tap Join voice chat (in the lobby or during the game), allow the microphone, and can then mute or leave the call at any time. A green outline shows who is speaking.

- Audio goes directly between the players' phones. The server only passes along the set-up messages.
- It needs an https address (or localhost) so the browser will allow the microphone.
- Use headphones. If two people in the same room join, they will hear an echo.
- Computer players do not talk, and voice is optional, so people who do not join can still play.

Most connections work with the free public STUN servers already set in the app. A minority of networks (some mobile carriers and strict office or school Wi-Fi) block direct audio, and those players will see a message saying they cannot connect. To fix that you need a TURN relay. Get one from a provider (Metered.ca and Twilio have free or cheap plans) or run your own with coturn, then set these environment variables on the server:

    KT_TURN_URLS=turn:your-turn-host:3478,turns:your-turn-host:443?transport=tcp
    KT_TURN_USER=your-username
    KT_TURN_PASS=your-password

On Render, add them under Environment. Relayed audio uses the TURN provider's bandwidth, not your game server's.

## Good to know

- Rooms live in the server's memory. If the server restarts, or a free plan puts it to sleep and wakes it, running games are lost and players start a new room.
- The server deals the cards and checks every move. Each player is only sent their own hand, so nobody can peek.
- If a player loses connection, a computer plays their turn after 7 seconds. They take their seat back when they reconnect (the page remembers them).
- Rooms with nobody connected are deleted after 6 hours.

## Files

- `server.js` rooms, live updates (Server-Sent Events) and the API
- `engine.js` the rules, scoring and computer players
- `public/index.html` the game page, plus `manifest.webmanifest`, `sw.js` and the icons that make it installable
- `mobile/` optional Capacitor shell for store builds
