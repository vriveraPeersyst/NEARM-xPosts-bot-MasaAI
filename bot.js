/**
 *  NEARM‑xPosts Discord bot — DEBUG build (18 Apr 2025)
 *  • watches @NEARMobile_app and @NEARProtocol
 *  • one job per account, separate logs
 *  • verbose Axios interceptors to surface every error
 *  • filters out Retweets and non-original tweets (mentions), posting only authored tweets
 *  • posts oldest new tweets first
 *  • caps polling attempts so it doesn’t hang indefinitely
 */

const { Client, GatewayIntentBits } = require('discord.js');
const axios  = require('axios');
const fs     = require('fs');
require('dotenv').config();

/* ──────────  Accounts  ────────── */
const ACCOUNTS = [
  { handle: 'NEARMobile_app', lower: 'nearmobile_app' },
  { handle: 'NEARProtocol',   lower: 'nearprotocol'   },
];

/* ──────────  ENV  ────────── */
const DISCORD_TOKEN = process.env.DISCORD_TOKEN?.trim();
const CHANNEL_ID    = process.env.CHANNEL_ID?.trim();
const MASA_API_KEY  = process.env.MASA_API_KEY?.trim();
if (!DISCORD_TOKEN || !CHANNEL_ID || !MASA_API_KEY) {
  console.error('⛔  Missing .env values'); process.exit(1);
}

/* ──────────  Masa API  ────────── */
const MASA_API_BASE = 'https://data.dev.masalabs.ai/api';
const SEARCH_EP     = `${MASA_API_BASE}/v1/search/live/twitter`;

/* ──────────  Timing  ────────── */
const REQUEST_TIMEOUT    = 60_000;
const MAX_POLL_ATTEMPTS  = 12;      // at 5s interval = 60s max polling
const CYCLE_DELAY        = 300_000; // per‑account cycle (5 min)
const RETRY_DELAY        = 5_000;   // shorter for debugging
const MAX_RETRIES        = 3;

/* ──────────  Logger  ────────── */
const log = (lv,msg)=>console.log(`[${new Date().toISOString()}] [${lv}] ${msg}`);

/* ──────────  Axios interceptors  ────────── */
axios.interceptors.request.use(
  r=>{log('DEBUG',`Req: ${JSON.stringify(r,null,2)}`);return r;},
  e=>{log('ERROR',`Req error: ${e.message}`);return Promise.reject(e);}
);
axios.interceptors.response.use(
  r=>{log('DEBUG',`Res: ${JSON.stringify(r.data,null,2)}`);return r;},
  e=>{
    if(e.response) log('ERROR',`Res err: ${JSON.stringify(e.response.data)}`);
    else            log('ERROR',`Err: ${e.message}`);
    return Promise.reject(e);
  }
);

/* ──────────  Helpers  ────────── */
const realID      = t => String(t.ExternalID ?? t.Metadata?.tweet_id ?? t.ID ?? '');
const IN_PROGRESS = ['processing','in progress','queued','error(retrying)'];

/* ──────────  Per‑account state ────────── */
function initState(a){
  a.logFile = `tweets-log-${a.lower}.json`;
  a.seen    = new Set();
  if(fs.existsSync(a.logFile)){
    try{JSON.parse(fs.readFileSync(a.logFile,'utf8')).forEach(t=>a.seen.add(String(t.id)));}catch{}
  }
}

function save(a,t,id){
  const entry = { id, content: t.Content, snippet: t.Content.slice(0,20) };
  try{
    const arr = fs.existsSync(a.logFile)
      ? JSON.parse(fs.readFileSync(a.logFile,'utf8'))
      : [];
    arr.push(entry);
    fs.writeFileSync(a.logFile, JSON.stringify(arr,null,2));
  }catch(e){ log('ERROR',`save fail (${a.handle}): ${e.message}`); }
}

/* ──────────  Poll status with cap ────────── */
async function poll(uuid){
  let attempts = 0;
  while(attempts < MAX_POLL_ATTEMPTS){
    const { data } = await axios.get(
      `${MASA_API_BASE}/v1/search/live/twitter/status/${uuid}`,
      { headers:{ Authorization:`Bearer ${MASA_API_KEY}` }, timeout:REQUEST_TIMEOUT }
    );
    log('DEBUG', `Job ${uuid} status: ${data.status}`);
    if(data.status === 'done') return;
    if(!IN_PROGRESS.includes(data.status))
      throw new Error(`status "${data.status}"`);
    attempts++;
    await new Promise(r=>setTimeout(r,5_000));
  }
  log('WARN', `Job ${uuid} still in progress after ${MAX_POLL_ATTEMPTS} attempts; moving on`);
}

/* ──────────  Account loop ────────── */
function startLoop(acct){
  initState(acct);
  const run = async (retry=0) => {
    log('INFO', `Cycle start for @${acct.handle}`);
    try{
      const { data:{ uuid, error } } = await axios.post(
        SEARCH_EP,
        { query:`from:${acct.handle}`, max_results:10 },
        { headers:{ 'Content-Type':'application/json', Authorization:`Bearer ${MASA_API_KEY}` }, timeout:REQUEST_TIMEOUT }
      );
      if(error) throw new Error(error);
      if(!uuid) throw new Error('no uuid');

      await poll(uuid);
      const { data:tweets } = await axios.get(
        `${MASA_API_BASE}/v1/search/live/twitter/result/${uuid}`,
        { headers:{ Authorization:`Bearer ${MASA_API_KEY}` }, timeout:REQUEST_TIMEOUT }
      );
      log('INFO', `@${acct.handle} fetched ${tweets.length}`);

      const chan = await client.channels.fetch(CHANNEL_ID);
      const newTweets = tweets
        .filter(t => {
          const txt = t.Content;
          const user= t.Metadata?.username?.toLowerCase()||'';
          return user===acct.lower && !txt.startsWith('RT ') && !txt.startsWith('@');
        })
        .reverse();

      for(const t of newTweets){
        const id = realID(t);
        if(!id||acct.seen.has(id)) continue;
        acct.seen.add(id);
        save(acct,t,id);
        await chan.send(`𝕏 : [New Post from ${t.Metadata.username}](https://twitter.com/i/status/${id})`);
        log('INFO', `@${acct.handle} posted ${id}`);
      }

      setTimeout(run, CYCLE_DELAY);
    }catch(e){
      if(retry<MAX_RETRIES){
        log('WARN', `@${acct.handle} err ${e.message}, retry ${RETRY_DELAY/1000}s`);
        setTimeout(()=>run(retry+1), RETRY_DELAY);
      }else{
        log('ERROR', `@${acct.handle} aborted after ${MAX_RETRIES}`);
      }
    }
  };
  run();
}

/* ──────────  Discord init ────────── */
const client = new Client({ intents:[GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages] });
client.once('ready',()=>{ log('INFO', `Logged in as ${client.user.tag}`); ACCOUNTS.forEach(startLoop); });
client.login(DISCORD_TOKEN);
