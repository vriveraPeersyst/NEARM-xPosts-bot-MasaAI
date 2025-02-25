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

// Masa API Configuration (New Endpoints)
const MASA_API_BASE_URL = 'https://api1.dev.masalabs.ai';
const MASA_SEARCH_ENDPOINT = `${MASA_API_BASE_URL}/v1/search/twitter`;
const TWEET_COUNT = 5;
const TWITTER_QUERY = '(#XRPLEVM) (from:Peersyst)';

// Retry & Delay Configuration
const MAX_RETRIES = 9;
const REQUEST_TIMEOUT = 60 * 1000; // 1 minute
const RETRY_DELAY = 30000; // 30 seconds (base delay)
const REQUEST_DELAY = 27 * 60000; // 27 minutes

// Logging and Persistence
const LOG_FILE = 'tweets-log.json';
const fetchedTweets = new Set();

const log = (level, message) => {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] [${level}] ${message}`);
};

// Save tweet details to file (adapted for new tweet structure)
const saveTweet = (tweet) => {
    const tweetInfo = {
        id: tweet.ID,
        content: tweet.Content,
        snippet: tweet.Content.substring(0, 20)
    };

    try {
        let tweetsLog = [];
        if (fs.existsSync(LOG_FILE)) {
            const data = fs.readFileSync(LOG_FILE, 'utf8');
            tweetsLog = JSON.parse(data);
        }
        tweetsLog.push(tweetInfo);
        fs.writeFileSync(LOG_FILE, JSON.stringify(tweetsLog, null, 4));
        log('INFO', `Tweet saved: ${JSON.stringify(tweetInfo)}`);
    } catch (error) {
        log('ERROR', `Failed to save tweet: ${error.message}`);
    }
};

// Generate a dynamic Twitter query with a date range
const generateTwitterQuery = () => {
    const today = new Date();
    const threeDaysAgo = new Date(today);
    threeDaysAgo.setDate(today.getDate() - 3);
    const formatDate = (date) => date.toISOString().split('T')[0];
    const since = formatDate(threeDaysAgo);
    const until = formatDate(today);
    return `(${TWITTER_QUERY}) since:${since} until:${until}`;
};

// Exponential backoff helper
const exponentialBackoff = (attempt, base) => base * 2 ** attempt;

// Poll the job status until it's done
const pollJobStatus = async (jobUUID, retryCount = 0) => {
    try {
        const statusResponse = await axios.get(
            `${MASA_API_BASE_URL}/v1/search/twitter/status/${jobUUID}`,
            {
                headers: {
                    'Authorization': `Bearer ${process.env.MASA_API_KEY}`
                },
                timeout: REQUEST_TIMEOUT
            }
        );
        const status = statusResponse.data.status;
        if (status === 'done') {
            log('INFO', `Job ${jobUUID} completed.`);
            return;
        } else if (status === 'processing') {
            log('INFO', `Job ${jobUUID} is still processing...`);
            await new Promise(resolve => setTimeout(resolve, 5000)); // wait 5 seconds
            return pollJobStatus(jobUUID, retryCount);
        } else {
            throw new Error(`Job status error: ${status}`);
        }
    } catch (error) {
        if (retryCount < MAX_RETRIES) {
            const delay = exponentialBackoff(retryCount, RETRY_DELAY);
            log('ERROR', `Error checking job status. Retrying in ${delay / 1000} seconds. Error: ${error.message}`);
            await new Promise(resolve => setTimeout(resolve, delay));
            return pollJobStatus(jobUUID, retryCount + 1);
        } else {
            throw error;
        }
    }
};

// Query Masa: submit job, poll status, retrieve results, and post tweets to Discord
const queryMasaNode = async (retryCount = 0) => {
    log('INFO', `Starting query for tweets (attempt: ${retryCount + 1})`);
    try {
        const twitterQuery = generateTwitterQuery();
        log('INFO', `Using query: ${twitterQuery}`);

        // Submit X/Twitter search job
        const searchResponse = await axios.post(
            MASA_SEARCH_ENDPOINT,
            {
                query: twitterQuery,
                max_results: TWEET_COUNT
            },
            {
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${process.env.MASA_API_KEY}`
                },
                timeout: REQUEST_TIMEOUT
            }
        );

        if (!searchResponse.data.uuid) {
            log('WARN', 'No job UUID returned from search submission.');
            throw new Error('No job UUID returned');
        }
        const jobUUID = searchResponse.data.uuid;
        log('INFO', `Search job submitted. Job UUID: ${jobUUID}`);

        // Poll until the job is complete
        await pollJobStatus(jobUUID);

        // Retrieve the search results
        const resultResponse = await axios.get(
            `${MASA_API_BASE_URL}/v1/search/twitter/result/${jobUUID}`,
            {
                headers: {
                    'Authorization': `Bearer ${process.env.MASA_API_KEY}`
                },
                timeout: REQUEST_TIMEOUT
            }
        );
        const tweets = resultResponse.data;
        log('INFO', `Fetched ${tweets.length} tweets.`);

        for (const tweet of tweets) {
            if (!fetchedTweets.has(tweet.ID)) {
                fetchedTweets.add(tweet.ID);
                saveTweet(tweet);
                // Construct a tweet URL using the tweet ID
                const tweetURL = `https://twitter.com/i/status/${tweet.ID}`;
                const channel = await client.channels.fetch(CHANNEL_ID);
                await channel.send(`📣 ${tweetURL}`);
                log('INFO', `Tweet posted to Discord: ${tweetURL}`);
            } else {
                log('INFO', `Duplicate tweet skipped: ${tweet.ID}`);
            }
        }

        // Delay before next query cycle
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

// When the bot is ready, start tweet monitoring
client.once('ready', () => {
    log('INFO', `Logged in as ${client.user.tag}`);
    log('INFO', 'Starting tweet monitoring...');
    queryMasaNode();
});

// Log in to Discord
client.login(DISCORD_TOKEN);
