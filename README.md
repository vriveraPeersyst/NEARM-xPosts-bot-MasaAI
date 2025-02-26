# xPosts-bot

xPosts-bot is a Discord bot that monitors tweets from a specified Twitter query using the new Masa Data API V1 (Private Beta). The bot submits an X/Twitter search job to the Masa API, polls for job completion, retrieves the latest tweets, and posts them to a designated Discord channel.

## Features

- **Masa Data API Integration**: Leverages the new Masa Data API V1 for secure, on-demand tweet scraping and indexing.
- **Dynamic Query Generation**: Automatically generates Twitter queries with a date range.
- **Discord Notifications**: Posts new tweets to your Discord channel.
- **Robust Error Handling**: Implements exponential backoff and retries on failure.
- **Tweet Logging**: Saves a log of posted tweets to avoid duplicate postings.

## Requirements

- Node.js v14 or higher
- A Discord bot token
- A Discord channel ID where the bot will post tweets
- A Masa Data API key (private beta access)

## Setup

1. **Clone the repository:**

    ```bash
    git clone https://github.com/vriveraPeersyst/xPosts-bot.git
    cd xPosts-bot
    ```

2. **Install dependencies:**

    ```bash
    npm install
    ```

3. **Create a `.env` file in the project root with the following content:**

    ```env
    DISCORD_TOKEN=your_discord_token_here
    CHANNEL_ID=your_discord_channel_id_here
    MASA_API_KEY=your_masa_api_key_here
    ```

4. **Start the bot:**

    ```bash
    node bot.js
    ```

## Bot Invitation

To invite the bot to your server with the necessary permissions (View Channels and Send Messages), use the following invitation link:

```
https://discord.com/api/oauth2/authorize?client_id=YOUR_BOT_CLIENT_ID&permissions=3072&scope=bot
```

Replace `YOUR_BOT_CLIENT_ID` with your bot's actual client ID.

## How It Works

1. **Job Submission:**  
   The bot submits a tweet search job to the Masa Data API using a dynamically generated query that includes a date range.

2. **Polling:**  
   It continuously polls the job status until the job is marked as `"done"`.

3. **Retrieving & Posting:**  
   Once complete, the bot retrieves the results and posts any new tweets (avoiding duplicates) to the designated Discord channel.

4. **Logging:**  
   Each tweet is logged in a JSON file (`tweets-log.json`) to prevent duplicate postings.

## License

This project is licensed under the MIT License.

## Contributing

Feel free to open issues or submit pull requests with any improvements or suggestions.

## Acknowledgments

- [Masa Data API](https://api1.dev.masalabs.ai) for their secure and scalable Twitter scraping service.
- [Discord.js](https://discord.js.org) for providing an amazing framework to build Discord bots.