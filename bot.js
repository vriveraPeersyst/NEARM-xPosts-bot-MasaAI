/**
 *  NEARM-xPosts Discord bot — RELEASE build (May 2025)
 *  • watches @NEARMobile_app and @NEARProtocol
 *  • one job per account, separate logs
 *  • verbose Axios interceptors to surface every error
 *  • filters out Retweets and non-original tweets (mentions)
 *  • posts oldest new tweets first
 *  • submits one search per cycle, polls same job up to 5× every 2 min
 *  • schedules next cycle 20 min after completion or error
 */

const { Client, GatewayIntentBits } = require('discord.js');
const axios  = require('axios');
const fs     = require('fs');
require('dotenv').config();

/* ────────── Accounts ────────── */
const ACCOUNTS = [
  { handle: 'NEARMobile_app', lower: 'nearmobile_app' },
  { handle: 'NEARProtocol',   lower: 'nearprotocol'   },
];

/* ────────── ENV ────────── */
const DISCORD_TOKEN         = process.env.DISCORD_TOKEN?.trim();
const CHANNEL_ID            = process.env.CHANNEL_ID?.trim();
const MASA_API_KEY          = process.env.MASA_API_KEY?.trim();
const MASA_DATA_SOURCE_TYPE = process.env.MASA_DATA_SOURCE_TYPE?.trim() || 'twitter-scraper';
const MASA_SEARCH_METHOD    = process.env.MASA_SEARCH_METHOD?.trim()    || 'searchbyquery';
// decreased default max_results from 25 to 10
const MASA_MAX_RESULTS      = Number(process.env.MASA_MAX_RESULTS)      || 10;

if (!DISCORD_TOKEN || !CHANNEL_ID || !MASA_API_KEY) {
  console.error('⛔  Missing .env values');
  process.exit(1);
}

/* ────────── Masa API ────────── */
const MASA_API_BASE = 'https://data.dev.masalabs.ai/api';
const SEARCH_EP     = `${MASA_API_BASE}/v1/search/live/twitter`;

/* ────────── Timing ────────── */
const REQUEST_TIMEOUT    = 60_000;
const MAX_POLL_ATTEMPTS  = 5;        // increased from 3 to 5
const POLL_INTERVAL      = 120_000;  // increased from 30s to 2min
const CYCLE_DELAY        = 1_200_000; // 20 min between cycles

/* ────────── Logger ────────── */
const log = (lv, msg) => console.log(`[${new Date().toISOString()}] [${lv}] ${msg}`);

/* ────────── Axios interceptors ────────── */
axios.interceptors.request.use(
  req => { log('DEBUG', `Req: ${JSON.stringify(req, null, 2)}`); return req; },
  err => { log('ERROR', `Req error: ${err.message}`); return Promise.reject(err); }
);
axios.interceptors.response.use(
  res => { log('DEBUG', `Res: ${JSON.stringify(res.data, null, 2)}`); return res; },
  err => {
    if (err.response) log('ERROR', `Res err: ${JSON.stringify(err.response.data)}`);
    else              log('ERROR', `Err: ${err.message}`);
    return Promise.reject(err);
  }
);

/* ────────── Helpers ────────── */
const realID      = t => String(t.ExternalID ?? t.Metadata?.tweet_id ?? t.ID ?? '');
const IN_PROGRESS = ['processing','in progress','queued','error(retrying)'];

/* ────────── Per-account state ────────── */
function initState(acct) {
  acct.logFile = `tweets-log-${acct.lower}.json`;
  acct.seen    = new Set();
  if (fs.existsSync(acct.logFile)) {
    try {
      JSON.parse(fs.readFileSync(acct.logFile, 'utf8'))
        .forEach(e => acct.seen.add(String(e.id)));
    } catch {}
  }
}

function save(acct, tweet, id) {
  const entry = { id, content: tweet.Content, snippet: tweet.Content.slice(0,20) };
  try {
    const arr = fs.existsSync(acct.logFile)
      ? JSON.parse(fs.readFileSync(acct.logFile, 'utf8'))
      : [];
    arr.push(entry);
    fs.writeFileSync(acct.logFile, JSON.stringify(arr, null, 2));
  } catch (e) {
    log('ERROR', `save fail (${acct.handle}): ${e.message}`);
  }
}

/* ────────── Step 1: submit search ────────── */
async function submitSearch(handle) {
  const { data } = await axios.post(
    SEARCH_EP,
    {
      type: MASA_DATA_SOURCE_TYPE,
      arguments: {
        type: MASA_SEARCH_METHOD,
        query: `from:${handle}`,
        max_results: MASA_MAX_RESULTS
      }
    },
    {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${MASA_API_KEY}`
      },
      timeout: REQUEST_TIMEOUT
    }
  );
  if (data.error) throw new Error(data.error);
  if (!data.uuid) throw new Error('no uuid returned');
  return data.uuid;
}

/* ────────── Step 2: poll status ────────── */
async function pollUntilDone(uuid) {
  for (let attempt = 1; attempt <= MAX_POLL_ATTEMPTS; attempt++) {
    const { data } = await axios.get(
      `${MASA_API_BASE}/v1/search/live/twitter/status/${uuid}`,
      {
        headers: { Authorization: `Bearer ${MASA_API_KEY}` },
        timeout: REQUEST_TIMEOUT
      }
    );
    log('DEBUG', `Job ${uuid} status: ${data.status}`);
    if (data.status === 'done') return true;
    if (!IN_PROGRESS.includes(data.status)) {
      throw new Error(`job failed with status "${data.status}"`);
    }
    await new Promise(r => setTimeout(r, POLL_INTERVAL));
  }
  log('WARN', `Job ${uuid} still in progress after ${MAX_POLL_ATTEMPTS} polls`);
  return false;
}

/* ────────── Step 3: fetch results ────────── */
async function fetchResults(uuid) {
  const { data: tweets } = await axios.get(
    `${MASA_API_BASE}/v1/search/live/twitter/result/${uuid}`,
    {
      headers: { Authorization: `Bearer ${MASA_API_KEY}` },
      timeout: REQUEST_TIMEOUT
    }
  );
  return tweets;
}

/* ────────── Account loop ────────── */
function startLoop(acct) {
  initState(acct);

  async function run() {
    log('INFO', `Cycle start for @${acct.handle}`);
    try {
      // 1) submit
      const uuid = await submitSearch(acct.handle);

      // 2) poll
      const done = await pollUntilDone(uuid);
      if (!done) return;

      // 3) fetch
      const tweets = await fetchResults(uuid);
      log('INFO', `@${acct.handle} fetched ${Array.isArray(tweets) ? tweets.length : 0} tweets`);
      if (!Array.isArray(tweets)) return;

      // filter & post
      const chan = await client.channels.fetch(CHANNEL_ID);
      tweets
        .filter(t => {
          const txt = t.Content || '';
          return !txt.startsWith('RT ') && !txt.startsWith('@');
        })
        .reverse()
        .forEach(async t => {
          const id = realID(t);
          if (!id || acct.seen.has(id)) return;
          acct.seen.add(id);
          save(acct, t, id);
          await chan.send(`𝕏 : [New Post from @${acct.handle}](https://twitter.com/i/status/${id})`);
          log('INFO', `@${acct.handle} posted ${id}`);
        });

    } catch (err) {
      log('ERROR', `@${acct.handle} error: ${err.message}`);
    } finally {
      setTimeout(run, CYCLE_DELAY);
    }
  }

  run();
}

/* ────────── Discord init ────────── */
const client = new Client({
  intents: [ GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages ]
});
client.once('ready', () => {
  log('INFO', `Logged in as ${client.user.tag}`);
  ACCOUNTS.forEach(startLoop);
});
client.login(DISCORD_TOKEN);

// prevent crashes on unhandled errors
process.on('uncaughtException',  e => log('ERROR', `uncaughtException: ${e.stack}`));
process.on('unhandledRejection', e => log('ERROR', `unhandledRejection: ${e}`));
