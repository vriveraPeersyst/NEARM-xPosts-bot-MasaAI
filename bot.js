const { Client, GatewayIntentBits } = require('discord.js');
const axios = require('axios');
require('dotenv').config();

// Discord Bot Setup
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent, // Required to read message content
    ],
});
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const CHANNEL_ID = process.env.CHANNEL_ID;

// Masa Node API
const MASA_API_URL = 'http://localhost:8080/api/v1/data/twitter/tweets/recent';
const TWITTER_QUERY = '(#XRPLEVM) (from:Peersyst)';
const TWEET_COUNT = 33;

// When the bot is ready
client.once('ready', () => {
    console.log(`✅ Logged in as ${client.user.tag}!`);
    console.log(`💬 Bot is now monitoring the channel: ${CHANNEL_ID}`);
});

// Listen for commands
client.on('messageCreate', async (message) => {
    if (message.content === '!fetchTweets') {
        console.log(`🔍 Received command from ${message.author.tag}: ${message.content}`);

        try {
            // Query the Masa node
            console.log('📡 Querying Masa Node API...');
            const response = await axios.post(MASA_API_URL, {
                query: TWITTER_QUERY,
                count: TWEET_COUNT,
            });

            console.log('✅ Received response from Masa Node API:', response.data);

            const tweets = response.data.data; // Access the `data` array from the response
            if (tweets && tweets.length > 0) {
                console.log(`📋 Found ${tweets.length} tweets. Preparing messages...`);
                const tweetMessages = tweets.map((tweetObj) => formatTweet(tweetObj.Tweet)).join('\n\n');

                // Send the tweets to the Discord channel
                if (tweetMessages.length > 2000) {
                    const splitMessages = splitLongMessage(tweetMessages);
                    for (const msg of splitMessages) {
                        await message.channel.send(msg);
                    }
                } else {
                    await message.channel.send(tweetMessages);
                }

                console.log('✅ Tweets sent to Discord.');
            } else {
                console.log('⚠️ No tweets found for the query.');
                await message.channel.send('No tweets found for the query.');
            }
        } catch (error) {
            console.error('❌ Error fetching tweets:', error);
            await message.channel.send('Failed to fetch tweets. Please check the logs.');
        }
    }
});

// Format a single tweet object into a readable Discord message
function formatTweet(tweet) {
    const baseMessage = `**${tweet.Name} (@${tweet.Username})**\n${tweet.Text}\n🔗 [View Tweet](${tweet.PermanentURL})`;

    const hashtags = tweet.Hashtags?.length ? `\n🏷️ Hashtags: ${tweet.Hashtags.join(', ')}` : '';
    const mentions = tweet.Mentions?.length
        ? `\n👥 Mentions: ${tweet.Mentions.map((m) => `@${m.Username}`).join(', ')}`
        : '';
    const photos = tweet.Photos?.length ? `\n📸 Photos: ${tweet.Photos.map((p) => p.URL).join(', ')}` : '';
    const videos = tweet.Videos?.length ? `\n🎥 Videos: ${tweet.Videos.map((v) => v.URL).join(', ')}` : '';
    const stats = `\n👍 Likes: ${tweet.Likes} | 🔁 Retweets: ${tweet.Retweets} | 💬 Replies: ${tweet.Replies} | 👀 Views: ${tweet.Views}`;

    return `${baseMessage}${hashtags}${mentions}${photos}${videos}${stats}`;
}

// Split long messages into chunks of 2000 characters for Discord
function splitLongMessage(message, maxLength = 2000) {
    const chunks = [];
    let currentChunk = '';

    message.split('\n').forEach((line) => {
        if ((currentChunk + line).length > maxLength) {
            chunks.push(currentChunk);
            currentChunk = '';
        }
        currentChunk += line + '\n';
    });

    if (currentChunk) {
        chunks.push(currentChunk);
    }

    return chunks;
}

// Log in to Discord
client.login(DISCORD_TOKEN);
