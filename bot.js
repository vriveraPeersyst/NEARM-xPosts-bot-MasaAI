const { Client, GatewayIntentBits } = require('discord.js');
const axios = require('axios');
const fs = require('fs');
require('dotenv').config();

// Discord Bot Setup
const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages],
});
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const CHANNEL_ID = process.env.CHANNEL_ID;

// Masa Node API Configuration
const MASA_API_URL = 'http://localhost:8080/api/v1/data/twitter/tweets/recent';
const TWEET_COUNT = 5;
const TWITTER_QUERY = '(#XRPLEVM) (from:Peersyst)';

// Retry Configuration
const MAX_RETRIES = 9; // Maximum retries
const REQUEST_TIMEOUT = 60 * 1000; // Timeout for requests in milliseconds
const RETRY_DELAY = 30000; // Retry delay in milliseconds (16 minutes)
const REQUEST_DELAY = 27 * 60000; // Request delay in milliseconds (15 seconds)

// Logging
const LOG_FILE = 'tweets-log.json';
const fetchedTweets = new Set(); // Store tweet IDs to prevent duplicates

// Utility function: Log messages with timestamp
const log = (level, message) => {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] [${level}] ${message}`);
};

// Utility function: Save tweet details to log file
const saveTweet = (tweet) => {
    const tweetInfo = {
        link: tweet.PermanentURL,
        time: tweet.TimeParsed,
        snippet: tweet.Text.substring(0, 20),
    };

    try {
        // Read the existing log file, or initialize an empty array if it doesn't exist
        let tweetsLog = [];
        if (fs.existsSync(LOG_FILE)) {
            const data = fs.readFileSync(LOG_FILE, 'utf8');
            tweetsLog = JSON.parse(data);
        }

        // Add the new tweet
        tweetsLog.push(tweetInfo);

        // Write the updated array back to the file
        fs.writeFileSync(LOG_FILE, JSON.stringify(tweetsLog, null, 4));
        log('INFO', `Tweet saved: ${JSON.stringify(tweetInfo)}`);
    } catch (error) {
        log('ERROR', `Failed to save tweet: ${error.message}`);
    }
};

// Utility function: Generate dynamic Twitter query with date range
const generateTwitterQuery = () => {
    const today = new Date();
    const threeDaysAgo = new Date(today);
    threeDaysAgo.setDate(today.getDate() - 3);

    const formatDate = (date) => date.toISOString().split('T')[0];

    const since = formatDate(threeDaysAgo);
    const until = formatDate(today);

    return `(${TWITTER_QUERY}) since:${since} until:${until}`;
};

// Exponential backoff
const exponentialBackoff = (attempt, base) => base * 2 ** attempt;

// Query Masa Node
const queryMasaNode = async (retryCount = 0) => {
    log('INFO', `Starting query for tweets (attempt: ${retryCount + 1})`);

    try {
        const twitterQuery = generateTwitterQuery();
        log('INFO', `Using query: ${twitterQuery}`);

        const response = await axios.post(
            MASA_API_URL,
            {
                query: twitterQuery,
                count: TWEET_COUNT,
            },
            { timeout: REQUEST_TIMEOUT }
        );

        if (response.data && response.data.data) {
            const tweets = response.data.data;
            log('INFO', `Fetched ${tweets.length} tweets.`);

            for (const tweetObj of tweets) {
                const tweet = tweetObj.Tweet;
                if (!fetchedTweets.has(tweet.ID)) {
                    fetchedTweets.add(tweet.ID);
                    saveTweet(tweet);

                    // Post to Discord channel
                    const channel = await client.channels.fetch(CHANNEL_ID);
                    await channel.send(`📣 ${tweet.PermanentURL}`);
                    log('INFO', `Tweet posted to Discord: ${tweet.PermanentURL}`);
                } else {
                    log('INFO', `Duplicate tweet skipped: ${tweet.ID}`);
                }
            }
        } else {
            log('WARN', 'No tweets found.');
        }

        // Apply delay between requests
        setTimeout(queryMasaNode, REQUEST_DELAY);

    } catch (error) {
        if (retryCount < MAX_RETRIES) {
            const delay = exponentialBackoff(retryCount, RETRY_DELAY);
            log('ERROR', `Error fetching tweets. Retrying in ${delay / 1000} seconds. Error: ${error.message}`);
            setTimeout(() => queryMasaNode(retryCount + 1), delay);
        } else {
            log('ERROR', `Max retries reached. Failed to fetch tweets. Error: ${error.message}`);
        }
    }
};

// When the bot is ready
client.once('ready', () => {
    log('INFO', `Logged in as ${client.user.tag}`);
    log('INFO', 'Starting tweet monitoring...');
    queryMasaNode(); // Start the query loop
});

// Log in to Discord
client.login(DISCORD_TOKEN);
