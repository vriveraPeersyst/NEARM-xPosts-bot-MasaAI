# NEARM‑xPosts Discord Bot

**DEBUG build (18 Apr 2025)**

A simple Discord bot that watches specified X/Twitter accounts via the Masa Data API and forwards new posts to a Discord channel. Each account is polled in its own loop, with separate persistence logs, deduplication, and robust retry logic.

---

## Features

- Monitors multiple X/Twitter handles independently (`@NEARMobile_app` and `@NEARProtocol`).
- Separate search job and log file per account for clean isolation.
- Uses Masa Data API V1 (Private Beta) to scrape and index tweets securely.
- Exponential backoff and retry for robust error handling.
- Verbose Axios request/response logging for debugging.
- Configurable polling interval (default: every 5 minutes).
- Discord embed‑style link: `𝕏 : [New Post from <user>](https://twitter.com/i/status/<id>)`.

## Requirements

- Node.js v16+ (recommended)
- npm or yarn
- A Masa Data API key (available by private‑beta signup)
- A Discord Bot token with permission to post in your target channel

## Environment Variables

Create a `.env` file in the project root with the following keys:

```bash
DISCORD_TOKEN=your_discord_bot_token
CHANNEL_ID=target_discord_channel_id
MASA_API_KEY=your_masa_data_api_key
```

## Installation

```bash
# clone the repo
git clone https://github.com/your-org/NEARM-xPosts-bot-MasaAI.git
cd NEARM-xPosts-bot-MasaAI

# install dependencies
npm install
```

## Configuration

- **Accounts**: edit the `ACCOUNTS` array in `bot.js` to watch different handles.
- **Polling interval**: modify `CYCLE_DELAY` (milliseconds) for frequency.
- **Retry policy**: adjust `RETRY_DELAY` and `MAX_RETRIES` for backoff behavior.

## Running Locally

```bash
node bot.js
```

You should see logs like:

```
[2025-04-18T09:00:00.000Z] [INFO] Logged in as NEARM-xPosts#7396
[2025-04-18T09:00:00.005Z] [INFO] ⏳  Cycle start for @NEARMobile_app
[2025-04-18T09:00:02.100Z] [INFO] @NEARMobile_app → 2 tweet(s)
[2025-04-18T09:00:02.200Z] [INFO] @NEARMobile_app posted 1913153332568371276
```

## Running with PM2

Install PM2 globally:

```bash
npm install -g pm2
```

Start the bot under PM2:

```bash
pm2 start bot.js --name nearm-xposts-bot --cwd $(pwd)
pm2 save
```

On reboot, restore your processes:

```bash
pm2 startup
# follow printed instructions to enable the service
pm2 save
```

### Managing the process

```bash
pm2 ls                     # list processes
pm2 logs nearm-xposts-bot  # tail logs
pm2 restart nearm-xposts-bot
pm2 stop nearm-xposts-bot
pm2 delete nearm-xposts-bot
```

## Logs & Persistence

- Each account writes to `tweets-log-<handle>.json` in the project root.
- On startup, the bot preloads those logs to avoid reposting old tweets.

## Troubleshooting

- **Missing dependencies**: ensure you ran `npm install`.
- **MODULE_NOT_FOUND** under PM2: pass `--cwd` or start from the project root.
- **.DS_Store** clutter: run:
  ```bash
git rm --cached .DS_Store && git commit -m "Remove .DS_Store" && git push
```

---

Built with ❤️ using Node.js, Discord.js, Axios, and the Masa Data API.

