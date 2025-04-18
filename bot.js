/**
 *  NEARM‑xPosts Discord bot — DEBUG build (18 Apr 2025)
 *  • watches @NEARMobile_app and @NEARProtocol
 *  • one job per account, separate logs
 *  • verbose Axios interceptors to surface every error
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

/* ──────────  Masa  ────────── */
const MASA_API_BASE = 'https://data.dev.masalabs.ai/api';
const SEARCH_EP     = `${MASA_API_BASE}/v1/search/live/twitter`;

/* ──────────  Timing  ────────── */
const REQUEST_TIMEOUT = 60_000;
const CYCLE_DELAY     = 300_000;      // per‑account cycle
const RETRY_DELAY     = 5_000;       // shorter for debugging
const MAX_RETRIES     = 3;

/* ──────────  Logger  ────────── */
const log = (lv,msg)=>console.log(`[${new Date().toISOString()}] [${lv}] ${msg}`);

/* ──────────  Axios interceptors  ────────── */
axios.interceptors.request.use(
  r=>{log('DEBUG',`Full Axios Request Config: ${JSON.stringify(r,null,2)}`);return r;},
  e=>{log('ERROR',`Axios Req Error: ${e.message}`);return Promise.reject(e);}
);
axios.interceptors.response.use(
  r=>{log('DEBUG',`Axios Response: ${JSON.stringify(r.data,null,2)}`);return r;},
  e=>{
    if(e.response){log('ERROR',`Axios Resp Error: ${JSON.stringify(e.response.data,null,2)}`);}
    else{log('ERROR',`Axios Error: ${e.message}`);}
    return Promise.reject(e);
  }
);

/* ──────────  Helpers  ────────── */
const realID = t => String(t.ExternalID ?? t.Metadata?.tweet_id ?? t.ID ?? '');
const IN_PROGRESS=['processing','in progress','queued','error(retrying)'];

/* ──────────  Per‑account state ────────── */
function initState(a){
  a.logFile=`tweets-log-${a.lower}.json`;
  a.seen=new Set();
  if(fs.existsSync(a.logFile)){
    try{JSON.parse(fs.readFileSync(a.logFile,'utf8')).forEach(t=>a.seen.add(String(t.id)));}catch{/* ignore */}
  }
}

function save(a,t,id){
  const entry={id,content:t.Content,snippet:t.Content.slice(0,20)};
  try{
    const arr=fs.existsSync(a.logFile)?JSON.parse(fs.readFileSync(a.logFile,'utf8')):[];
    arr.push(entry);fs.writeFileSync(a.logFile,JSON.stringify(arr,null,2));
  }catch(e){log('ERROR',`Write fail (${a.handle}): ${e.message}`);}
}

/* ──────────  Poll status  ────────── */
async function poll(uuid){
  while(true){
    const {data}=await axios.get(`${MASA_API_BASE}/v1/search/live/twitter/status/${uuid}`,
      {headers:{Authorization:`Bearer ${MASA_API_KEY}`},timeout:REQUEST_TIMEOUT});
    if(data.status==='done') return;
    if(!IN_PROGRESS.includes(data.status)) throw new Error(`status “${data.status}”`);
    await new Promise(r=>setTimeout(r,5_000));
  }
}

/* ──────────  Account loop  ────────── */
function startLoop(acct){
  initState(acct);

  const run=async(retry=0)=>{
    log('INFO',`⏳  Cycle (${acct.handle}) start`);
    try{
      /* submit search */
      const {data:{uuid,error}} = await axios.post(
        SEARCH_EP,
        {query:`from:${acct.handle}`,max_results:10},
        {headers:{'Content-Type':'application/json',Authorization:`Bearer ${MASA_API_KEY}`},timeout:REQUEST_TIMEOUT}
      );
      if(error) throw new Error(`Job submit error: ${error}`);
      if(!uuid) throw new Error('No UUID');

      await poll(uuid);

      /* results */
      const {data:tweets}=await axios.get(
        `${MASA_API_BASE}/v1/search/live/twitter/result/${uuid}`,
        {headers:{Authorization:`Bearer ${MASA_API_KEY}`},timeout:REQUEST_TIMEOUT}
      );
      log('INFO',`(${acct.handle}) tweets len = ${tweets.length}`);

      const chan=await bot.channels.fetch(CHANNEL_ID);
      for(const t of tweets){
        const id=realID(t);
        if(!id||acct.seen.has(id)){continue;}
        acct.seen.add(id);save(acct,t,id);
        await chan.send(`𝕏 : [New Post from ${t.Metadata?.username||acct.handle}](https://twitter.com/i/status/${id})`);
        log('INFO',`(${acct.handle}) posted ${id}`);
      }

      setTimeout(run,CYCLE_DELAY);

    }catch(e){
      if(retry<MAX_RETRIES){
        log('WARN',`(${acct.handle}) error: ${e.message} – retrying in ${RETRY_DELAY/1000}s`);
        setTimeout(()=>run(retry+1),RETRY_DELAY);
      }else{
        log('ERROR',`(${acct.handle}) aborted after ${MAX_RETRIES} retries`);
      }
    }
  };
  run();
}

/* ──────────  Discord boot  ────────── */
const bot=new Client({intents:[GatewayIntentBits.Guilds,GatewayIntentBits.GuildMessages]});
bot.once('ready',()=>{log('INFO',`Logged in as ${bot.user.tag}`);ACCOUNTS.forEach(startLoop);});
bot.login(DISCORD_TOKEN);
