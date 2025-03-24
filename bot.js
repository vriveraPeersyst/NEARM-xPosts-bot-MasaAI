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
const MASA_API_KEY = process.env.MASA_API_KEY;

// Masa API Configuration (Updated Endpoints)
const MASA_API_BASE_URL = 'https://api1.dev.masalabs.ai';
const MASA_SEARCH_ENDPOINT = `${MASA_API_BASE_URL}/v1/search/live/twitter`;
const TWEET_COUNT = 10; // max_results as in the curl query
const TWITTER_QUERY = 'from:Peersyst'; // exactly as in the curl query

// Retry & Delay Configuration
const MAX_RETRIES = 9;
const REQUEST_TIMEOUT = 60 * 1000; // 1 minute
const RETRY_DELAY = 30000; // 30 seconds (base delay)
const REQUEST_DELAY = 1 * 60000; // 1 minute

// Logging and Persistence
const LOG_FILE = 'tweets-log.json';
const fetchedTweets = new Set();

const log = (level, message) => {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] [${level}] ${message}`);
};

// Axios interceptor to log full request configuration
axios.interceptors.request.use(
    request => {
        log('DEBUG', `Full Axios Request Config: ${JSON.stringify(request, null, 2)}`);
        return request;
    },
    error => {
        log('ERROR', `Axios Request Error: ${error.message}`);
        return Promise.reject(error);
    }
);

// Axios interceptor to log responses
axios.interceptors.response.use(
    response => {
        log('DEBUG', `Axios Response: ${JSON.stringify(response.data, null, 2)}`);
        return response;
    },
    error => {
        if (error.response) {
            log('ERROR', `Axios Response Error: ${JSON.stringify(error.response.data, null, 2)}`);
        } else {
            log('ERROR', `Axios Error: ${error.message}`);
        }
        return Promise.reject(error);
    }
);

// Save tweet details to file
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

// Build the search query exactly as in the curl query
const generateTwitterQuery = () => {
    return TWITTER_QUERY;
};

// Exponential backoff helper
const exponentialBackoff = (attempt, base) => base * 1.1 ** attempt;

// Poll the job status until it's done
const pollJobStatus = async (jobUUID, retryCount = 0) => {
    log('INFO', `Polling job status for jobUUID: ${jobUUID} (retry count: ${retryCount})`);
    try {
        const statusResponse = await axios.get(
            `${MASA_API_BASE_URL}/v1/search/live/twitter/status/${jobUUID}`,
            {
                headers: {
                    'Authorization': `Bearer ${process.env.MASA_API_KEY}`
                },
                timeout: REQUEST_TIMEOUT
            }
        );
        const status = statusResponse.data.status;
        log('INFO', `Job status for ${jobUUID}: ${status}`);
        if (status === 'done') {
            log('INFO', `Job ${jobUUID} completed.`);
            return;
        } else if (status === 'processing' || status === 'error(retrying)') {
            log('INFO', `Job ${jobUUID} is ${status}. Waiting 5 seconds...`);
            await new Promise(resolve => setTimeout(resolve, 5000));
            return pollJobStatus(jobUUID, retryCount);
        } else {
            throw new Error(`Job status error: ${status}`);
        }
    } catch (error) {
        if (retryCount < MAX_RETRIES) {
            const delay = exponentialBackoff(retryCount, RETRY_DELAY);
            log('ERROR', `Error checking job status for ${jobUUID}. Retrying in ${delay / 1000} seconds. Error: ${error.message}`);
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

        // Build the payload exactly as in the curl command
        const payload = {
            query: twitterQuery,
            max_results: TWEET_COUNT
        };

        log('DEBUG', `Posting payload: ${JSON.stringify(payload, null, 2)}`);
        log('INFO', `Sending POST request to: ${MASA_SEARCH_ENDPOINT}`);

        // Submit X/Twitter search job
        const searchResponse = await axios.post(
            MASA_SEARCH_ENDPOINT,
            payload,
            {
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${process.env.MASA_API_KEY}`
                },
                timeout: REQUEST_TIMEOUT
            }
        );

        // Destructure the uuid and error from the response
        const { uuid, error } = searchResponse.data;
        log('INFO', `Received response from POST: uuid=${uuid}, error=${error}`);
        if (!uuid) {
            log('WARN', 'No job UUID returned from search submission.');
            throw new Error('No job UUID returned');
        }
        if (error && error !== "") {
            log('WARN', `Error in job submission: ${error}`);
            throw new Error(`Job submission error: ${error}`);
        }
        const jobUUID = uuid;
        log('INFO', `Search job submitted. Job UUID: ${jobUUID}`);

        // Poll until the job is complete
        await pollJobStatus(jobUUID);

        log('INFO', `Retrieving search results for jobUUID: ${jobUUID}`);
        // Retrieve the search results
        const resultResponse = await axios.get(
            `${MASA_API_BASE_URL}/v1/search/live/twitter/result/${jobUUID}`,
            {
                headers: {
                    'Authorization': `Bearer ${process.env.MASA_API_KEY}`
                },
                timeout: REQUEST_TIMEOUT
            }
        );
        const tweets = resultResponse.data;
        log('INFO', `Fetched ${tweets.length} tweets.`);

        // Process and post each tweet
        for (const tweet of tweets) {
            if (!fetchedTweets.has(tweet.ID)) {
                fetchedTweets.add(tweet.ID);
                saveTweet(tweet);
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
