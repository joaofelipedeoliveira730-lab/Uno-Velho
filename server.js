require('dotenv').config();
const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const helmet = require('helmet');
const { Pool } = require('pg');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const PORT = Number(process.env.PORT || 10000);
const JWT_SECRET = process.env.JWT_SECRET;
const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || '';
const io = new Server(server, { cors: { origin: FRONTEND_ORIGIN || false, credentials: true } });
const isProduction = process.env.NODE_ENV === 'production';
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3.6-flash';

if (isProduction && (!JWT_SECRET || JWT_SECRET.length < 32)) {
  throw new Error('JWT_SECRET ausente ou fraco. Configure no Render uma chave aleatória com pelo menos 32 caracteres.');
}
const jwtSecret = JWT_SECRET || crypto.randomBytes(48).toString('base64url');

app.disable('x-powered-by');
app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false, referrerPolicy: { policy: 'strict-origin-when-cross-origin' }, hsts: isProduction ? { maxAge: 31536000, includeSubDomains: true, preload: true } : false }));
app.use(express.json({ limit: '300kb' }));
app.use(express.urlencoded({ extended: false, limit: '50kb' }));
app.use((req,res,next)=>{
  const sensitive=/(^|_)(user(name)?|pass(word)?|senha|token|jwt|auth|credential)($|_)/i;
  const keys=Object.keys(req.query||{});
  const isPage=req.method==='GET' && !req.path.startsWith('/api/') && !req.path.startsWith('/socket.io/');
  if(isPage && keys.some(k=>sensitive.test(k))){
    const clean=req.path||'/';
    return res.redirect(303,clean);
  }
  next();
});
app.get('/',(req,res)=>res.sendFile(path.join(__dirname,'index.html')));
app.get('/index.html',(req,res)=>res.sendFile(path.join(__dirname,'index.html')));
app.get('/style.css',(req,res)=>res.sendFile(path.join(__dirname,'style.css')));
app.get('/app.js',(req,res)=>res.sendFile(path.join(__dirname,'app.js')));
app.get('/service-worker.js',(req,res)=>res.sendFile(path.join(__dirname,'service-worker.js')));
const ROOT_STATIC_ALLOWLIST=new Set(fs.readdirSync(__dirname).filter(name=>/\.(svg|json)$/.test(name)));
app.get('/:filename',(req,res,next)=>{const name=req.params.filename;if(!ROOT_STATIC_ALLOWLIST.has(name))return next();res.sendFile(path.join(__dirname,name));});


let pool = null;
let usePostgres = false;
let databaseReady = false;
let databaseReadyError = null;
let databaseReadyPromise = null;
const rooms = new Map();
const socketUsers = new Map();
const loginAttempts = new Map();
const chatRate = new Map();
const reportRate = new Map();
const gameActionRate = new Map();
const matchmakingQueues = {duo:[],trio:[]};
const localDbPath = path.join(__dirname, 'database.json');

function localDb() {
  if (!fs.existsSync(localDbPath)) {
    const db = { users: [], profiles: {}, inventory: {}, market: [], actions: [], messages: [] };
    fs.writeFileSync(localDbPath, JSON.stringify(db, null, 2));
    return db;
  }
  try { return JSON.parse(fs.readFileSync(localDbPath, 'utf8')); }
  catch { return { users: [], profiles: {}, inventory: {}, market: [], actions: [], messages: [] }; }
}
function saveLocalDb(db) { fs.writeFileSync(localDbPath, JSON.stringify(db, null, 2)); }

const EGYPT_EVENT_REWARDS=[
  {id:'event_scarab_10',name:'Escaravelho Solar',level:10,description:'Amuleto do Passe Egito Antigo.',asset:{theme:'egypt-scarab',eventExclusive:true,previewAccessory:'event_scarab_10'}},
  {id:'event_sandals_20',name:'Sandálias do Deserto',level:20,description:'Acessório exclusivo do evento.',asset:{theme:'egypt-sandals',eventExclusive:true,previewAccessory:'event_sandals_20'}},
  {id:'event_necklace_30',name:'Colar de Ísis',level:30,description:'Relíquia exclusiva do evento.',asset:{theme:'egypt-necklace',eventExclusive:true,previewAccessory:'event_necklace_30'}},
  {id:'event_crown_40',name:'Coroa Solar Menor',level:40,description:'Coroa dourada do templo.',asset:{theme:'egypt-crown-small',eventExclusive:true,previewAccessory:'event_crown_40'}},
  {id:'event_pharaoh_crown',name:'Coroa do Faraó',level:50,description:'Relíquia lendária e exclusiva. Não pode ser vendida.',asset:{theme:'egypt-pharaoh-crown',eventExclusive:true,previewAccessory:'event_pharaoh_crown'},rarity:'legendary'},
  {id:'event_eye_ra',name:'Olho de Rá',level:60,description:'Efeito exclusivo do Passe 1.',asset:{theme:'egypt-eye',eventExclusive:true,previewAccessory:'event_eye_ra'}},
  {id:'event_anubis_mask',name:'Máscara de Anúbis',level:70,description:'Visual lendário do deserto.',asset:{theme:'egypt-anubis',eventExclusive:true,previewAccessory:'event_anubis_mask'},rarity:'legendary'},
  {id:'event_scepter',name:'Cetro Real',level:80,description:'Acessório de prestígio do evento.',asset:{theme:'egypt-scepter',eventExclusive:true,previewAccessory:'event_scepter'}},
  {id:'event_sun_aura',name:'Aura Sol de Rá',level:90,description:'Aura exclusiva do evento.',asset:{theme:'egypt-sun',eventExclusive:true,previewAccessory:'event_sun_aura'},rarity:'epic'},
  {id:'event_throne_title',name:'Título: Filho do Faraó',level:100,description:'Título final do Passe Egito Antigo.',asset:{theme:'egypt-title',eventExclusive:true,previewAccessory:'event_throne_title'},rarity:'legendary'}
];
async function ensureEgyptEventItems(){
  if(!usePostgres)return;
  for(const r of EGYPT_EVENT_REWARDS){
    await pool.query(`INSERT INTO items(id,name,category,description,price,xp_required,rarity,asset,is_active) VALUES($1,$2,'accessory',$3,0,0,$4,$5::jsonb,true) ON CONFLICT(id) DO UPDATE SET name=EXCLUDED.name,description=EXCLUDED.description,rarity=EXCLUDED.rarity,asset=EXCLUDED.asset,is_active=true`,[r.id,r.name,r.description,r.rarity||'epic',JSON.stringify(r.asset)]);
  }
}

async function initDatabase() {
  if (!process.env.DATABASE_URL) {
    if (isProduction) throw new Error('DATABASE_URL é obrigatório em produção.');
    console.warn('⚠️ DATABASE_URL ausente. Modo local somente para desenvolvimento.');
    usePostgres=false; localDb(); return;
  }

  pool = new Pool({ connectionString:process.env.DATABASE_URL, ssl:{rejectUnauthorized:false}, max:8, idleTimeoutMillis:30000, connectionTimeoutMillis:10000, keepAlive:true, keepAliveInitialDelayMillis:10000, statement_timeout:15000, query_timeout:20000 });
  pool.on('error',err=>console.error('❌ PostgreSQL pool:',err.message));

  // O banco precisa ficar pronto para LOGIN/CADASTRO mesmo que uma configuração
  // administrativa (como a senha inicial do CEO) esteja faltando.
  await pool.query('SELECT 1');
  const schema=fs.readFileSync(path.join(__dirname,'schema.sql'),'utf8');
  await pool.query(schema);
  usePostgres=true;
  await ensureEgyptEventItems();

  // O catálogo é importante para Loja/Inventário, mas uma falha nele não pode
  // derrubar Login/Cadastro. O seed é idempotente e pode ser corrigido sem apagar dados.
  try {
    const seedPath=path.join(__dirname,'seed.sql');
    if(fs.existsSync(seedPath)){const seed=fs.readFileSync(seedPath,'utf8');if(seed.trim())await pool.query(seed);}
  } catch(err) {
    console.error('⚠️ Catálogo seed não aplicado:',err.message);
  }
  // O seed histórico desativa o catálogo antes de reativar os itens oficiais;
  // os itens do Passe Egito precisam ser reativados depois do seed.
  await ensureEgyptEventItems();

  // O CEO é exclusivo. Se CEO_INITIAL_PASSWORD ainda não foi configurada,
  // não bloqueamos o jogo inteiro: jogadores normais continuam podendo entrar.
  try {
    await ensureCeo();
  } catch(err) {
    console.error('⚠️ CEO ainda não configurado:',err.message);
  }

  try {
    await ensureSeason();
  } catch(err) {
    console.error('⚠️ Temporada ainda não inicializada:',err.message);
  }

  console.log('✅ PostgreSQL conectado e banco estrutural pronto.');
}

async function ensureCeo(){
  if(!pool)return;
  const existing=await pool.query("SELECT id FROM users WHERE LOWER(username)=LOWER('CeoVelho') LIMIT 1");
  if(existing.rows.length){const id=existing.rows[0].id;await pool.query("UPDATE users SET role='CEO',admin_rank=NULL WHERE id=$1",[id]);await pool.query("INSERT INTO profiles(user_id,avatar,settings,bio) VALUES($1,$2,$3,'') ON CONFLICT(user_id) DO UPDATE SET avatar=profiles.avatar || $2",[id,JSON.stringify({title:'title_owner'}),JSON.stringify(defaultSettings())]);const all=await pool.query("SELECT id FROM items WHERE is_active=true");for(const row of all.rows)await grantItem(id,row.id);return;}
  const password=String(process.env.CEO_INITIAL_PASSWORD||'');
  if(password.length<12) throw new Error('CEO_INITIAL_PASSWORD deve ter pelo menos 12 caracteres para criar o CeoVelho.');
  const hash=await bcrypt.hash(password,12);
  const ins=await pool.query("INSERT INTO users(username,password_hash,role,coins,xp,level,admin_rank) VALUES('CeoVelho',$1,'CEO',999999999,9999999,100,NULL) RETURNING id",[hash]);await pool.query("INSERT INTO profiles(user_id,avatar,settings,bio) VALUES($1,$2,$3,'') ON CONFLICT(user_id) DO NOTHING",[ins.rows[0].id,JSON.stringify({...defaultAvatar(),title:'title_owner'}),JSON.stringify(defaultSettings())]);const all=await pool.query("SELECT id FROM items WHERE is_active=true");for(const row of all.rows)await grantItem(ins.rows[0].id,row.id);
  console.log('👑 Conta exclusiva CeoVelho criada.');
}

async function ensureSeason(){
  if(!pool)return;
  const r=await pool.query("SELECT id FROM seasons WHERE status='active' LIMIT 1");
  if(r.rows.length)return;
  const max=await pool.query('SELECT COALESCE(MAX(season_number),0)+1 AS n FROM seasons');
  const days=Math.min(365,Math.max(1,Number(process.env.DEFAULT_SEASON_DAYS)||30));
  await pool.query("INSERT INTO seasons(season_number,starts_at,ends_at,status) VALUES($1,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP+($2 || ' days')::interval,'active')",[Number(max.rows[0].n),days]);
}

async function getSeason(){
  if(!usePostgres)return {seasonNumber:1,status:'active',startsAt:new Date().toISOString(),endsAt:new Date(Date.now()+30*86400000).toISOString(),canNext:false};
  let r=await pool.query("SELECT * FROM seasons WHERE status='active' ORDER BY season_number DESC LIMIT 1");
  if(!r.rows[0]){await ensureSeason();r=await pool.query("SELECT * FROM seasons WHERE status='active' ORDER BY season_number DESC LIMIT 1");}
  const row=r.rows[0]; const ended=new Date(row.ends_at).getTime()<=Date.now();
  return {seasonNumber:Number(row.season_number),status:ended?'ended':'active',startsAt:row.starts_at,endsAt:row.ends_at,canNext:ended};
}

async function nextSeason(ceoId){
  if(!usePostgres)throw new Error('Temporadas exigem PostgreSQL.');
  const client=await pool.connect();
  try{await client.query('BEGIN');
    const active=(await client.query("SELECT * FROM seasons WHERE status='active' ORDER BY season_number DESC LIMIT 1 FOR UPDATE")).rows[0];
    if(!active)throw new Error('Nenhuma temporada ativa.');
    if(new Date(active.ends_at).getTime()>Date.now())throw new Error('A temporada ainda não terminou.');
    await client.query("UPDATE seasons SET status='closed',closed_at=CURRENT_TIMESTAMP WHERE id=$1",[active.id]);
    await client.query("UPDATE users SET wins=0,losses=0,games_played=0,admin_rank=NULL WHERE role<>'CEO'");
    const n=Number(active.season_number)+1;
    const durationDays=Math.max(1,Math.round((new Date(active.ends_at)-new Date(active.starts_at))/86400000));
    const r=await client.query("INSERT INTO seasons(season_number,starts_at,ends_at,status,created_by) VALUES($1,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP+($2 || ' days')::interval,'active',$3) RETURNING *",[n,durationDays,ceoId]);
    await client.query('COMMIT'); return {seasonNumber:n,startsAt:r.rows[0].starts_at,endsAt:r.rows[0].ends_at,status:'active'};
  }catch(e){await client.query('ROLLBACK');throw e}finally{client.release()}
}


function parseCookies(req) {
  const raw = req.headers.cookie || '';
  const out = {};
  raw.split(';').forEach(part => {
    const i = part.indexOf('=');
    if (i > -1) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  });
  return out;
}
function signToken(user) {
  return jwt.sign({ id: user.id, username: user.username, role: user.role }, jwtSecret, { expiresIn: '7d' });
}
const AUTH_COOKIE = isProduction ? '__Host-uv_session' : 'uv_session';
function setAuthCookie(res, token) {
  const secure = isProduction ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${AUTH_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800${secure}`);
}
function clearAuthCookie(res) {
  const secure = isProduction ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${AUTH_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`);
}
function verifyToken(token) { try { return jwt.verify(token, jwtSecret); } catch { return null; } }
function tokenFromRequest(req) {
  const cookies = parseCookies(req);
  return cookies[AUTH_COOKIE] || null;
}
async function getUserById(id) {
  if (usePostgres) {
    const r = await pool.query('SELECT id,username,role,coins,xp,level,wins,losses,games_played,country,created_at,last_login_at FROM users WHERE id=$1', [id]);
    return r.rows[0] || null;
  }
  const db = localDb();
  const u = db.users.find(x => x.id === Number(id));
  return u ? { ...u } : null;
}
async function auth(req, res, next) {
  const token = tokenFromRequest(req);
  const payload = token && verifyToken(token);
  if (!payload) return res.status(401).json({ success:false, message:'Sessão expirada. Faça login novamente.' });
  const user = await getUserById(payload.id);
  if (!user) return res.status(401).json({ success:false, message:'Conta não encontrada.' });
  const moderation = await activeModeration(user.id);
  if (moderation?.action === 'ban') return res.status(403).json({ success:false, message:'Sua conta está suspensa.', ban: moderation });
  req.user = user;
  next();
}
function requireRole(...roles) { return (req,res,next) => roles.includes(req.user?.role) ? next() : res.status(403).json({success:false,message:'Permissão insuficiente.'}); }
function isCeoOwner(user){return user?.role==='CEO' && String(user?.username||'').toLowerCase()==='ceovelho';}
function requireCeoOwner(req,res,next){return isCeoOwner(req.user)?next():res.status(403).json({success:false,message:'Central exclusiva do CeoVelho.'});}
function cleanText(value, max=500) { return String(value ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g,'').trim().slice(0,max); }
function validUsername(v) { return /^[A-Za-z0-9_]{3,24}$/.test(v); }
function validCountry(v) { return /^(BR|PT|US|AR|CL|CO|MX|ES|FR|DE|IT|GB|JP|KR|IN|CA|AU|OTHER)$/.test(String(v||'').toUpperCase()); }
function xpForLevel(level) { return Math.floor(100 * Math.pow(level - 1, 1.45)); }
const PRESTIGE_XP=xpForLevel(50);
function levelForXp(xp) { let level=1; while(level<100 && xp >= xpForLevel(level+1)) level++; return level; }
function prestigeForXp(xp){return Math.min(5,Math.floor(Math.max(0,Number(xp||0))/PRESTIGE_XP));}
function publicUser(u) { return { id:u.id, username:u.username, role:u.role, coins:Number(u.coins||0), xp:Number(u.xp||0), level:Number(u.level||1), prestige:prestigeForXp(u.xp), wins:Number(u.wins||0), losses:Number(u.losses||0), gamesPlayed:Number(u.games_played||0), country:String(u.country||'BR').toUpperCase() }; }
function defaultAvatar() { return { skinColor:'#d59b76', eyes:'#1d2433', hair:'hair_basic', hairColor:'#171717', top:'shirt_basic', bottom:'pants_basic', shoes:'shoes_basic', accessory:null, effect:null, emote:'emote_wave', title:'title_beginner' }; }
function defaultSettings() { return { music:true, musicVolume:0.45, sfx:true, sfxVolume:0.75, animations:true, chatWorld:true, chatRoom:true, chatPrivate:true, reducedMotion:false }; }
async function getProfile(userId) {
  if (usePostgres) {
    const r=await pool.query('SELECT avatar,settings,bio,updated_at FROM profiles WHERE user_id=$1',[userId]);
    if (!r.rows[0]) return { avatar:defaultAvatar(), settings:defaultSettings(), bio:'' };
    return { avatar:{...defaultAvatar(),...(r.rows[0].avatar||{})}, settings:{...defaultSettings(),...(r.rows[0].settings||{})}, bio:r.rows[0].bio||'', updatedAt:r.rows[0].updated_at };
  }
  const db=localDb(); const p=db.profiles[userId];
  return p ? { avatar:{...defaultAvatar(),...(p.avatar||{})}, settings:{...defaultSettings(),...(p.settings||{})}, bio:p.bio||'' } : {avatar:defaultAvatar(),settings:defaultSettings(),bio:''};
}
async function saveProfile(userId, profile) {
  const avatar={...defaultAvatar(),...(profile.avatar||{})}; const settings={...defaultSettings(),...(profile.settings||{})}; const bio=cleanText(profile.bio,180);
  if (usePostgres) { await pool.query(`INSERT INTO profiles(user_id,avatar,settings,bio) VALUES($1,$2,$3,$4) ON CONFLICT(user_id) DO UPDATE SET avatar=EXCLUDED.avatar,settings=EXCLUDED.settings,bio=EXCLUDED.bio,updated_at=CURRENT_TIMESTAMP`,[userId,JSON.stringify(avatar),JSON.stringify(settings),bio]); }
  else { const db=localDb(); db.profiles[userId]={avatar,settings,bio,updatedAt:new Date().toISOString()}; saveLocalDb(db); }
  return {avatar,settings,bio};
}
async function activeModeration(userId) {
  if (!usePostgres) return null;
  const r=await pool.query(`SELECT action,reason,expires_at FROM moderation_actions WHERE target_id=$1 AND action IN ('ban','mute') AND (expires_at IS NULL OR expires_at>CURRENT_TIMESTAMP) ORDER BY created_at DESC LIMIT 1`,[userId]);
  return r.rows[0]||null;
}
async function logAdmin(actorId,command,args,result='ok') { if(usePostgres) await pool.query('INSERT INTO admin_logs(actor_id,command,arguments,result) VALUES($1,$2,$3,$4)',[actorId,command,cleanText(args,500),result]); }
async function addEconomy(userId, coinsDelta, xpDelta, result='') {
  if (usePostgres) {
    const r=await pool.query(`UPDATE users SET coins=GREATEST(0,coins+$1),xp=GREATEST(0,xp+$2) WHERE id=$3 RETURNING id,username,role,coins,xp,wins,losses,games_played`,[coinsDelta,xpDelta,userId]);
    if (!r.rows[0]) return null;
    const level = levelForXp(Number(r.rows[0].xp || 0));
    const updated = await pool.query('UPDATE users SET level=$1 WHERE id=$2 RETURNING id,username,role,coins,xp,level,wins,losses,games_played',[level,userId]);
    return updated.rows[0]||r.rows[0];
  }
  const db=localDb(); const u=db.users.find(x=>x.id===Number(userId)); if(!u) return null; u.coins=Math.max(0,(u.coins||0)+coinsDelta); u.xp=Math.max(0,(u.xp||0)+xpDelta); u.level=levelForXp(u.xp); saveLocalDb(db); return u;
}
async function grantItem(userId,itemId) {
  if(usePostgres) { await pool.query(`INSERT INTO user_inventory(user_id,item_id) VALUES($1,$2) ON CONFLICT(user_id,item_id) DO UPDATE SET quantity=user_inventory.quantity+1`,[userId,itemId]); return true; }
  const db=localDb(); db.inventory[userId]=db.inventory[userId]||{}; db.inventory[userId][itemId]=(db.inventory[userId][itemId]||0)+1; saveLocalDb(db); return true;
}
async function hasItem(userId,itemId) {
  if(usePostgres){const r=await pool.query('SELECT 1 FROM user_inventory WHERE user_id=$1 AND item_id=$2',[userId,itemId]); return !!r.rows.length;}
  const db=localDb(); return !!db.inventory[userId]?.[itemId];
}
async function getItems() { if(usePostgres){try{const r=await pool.query('SELECT * FROM items WHERE is_active=true ORDER BY category,price,id'); return r.rows;}catch(e){console.error('items:',e.message);return [];} } return []; }
async function getInventory(userId) { if(usePostgres){try{const r=await pool.query(`SELECT i.*,ui.quantity,ui.acquired_at FROM user_inventory ui JOIN items i ON i.id=ui.item_id WHERE ui.user_id=$1 ORDER BY i.category,i.name`,[userId]); return r.rows;}catch(e){console.error('inventory:',e.message);return [];} } const db=localDb(); return Object.entries(db.inventory[userId]||{}).map(([item_id,quantity])=>({id:item_id,quantity})); }

async function geminiModerate(text){
  if(!GEMINI_API_KEY) return {allowed:true,reason:'disabled'};
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),2500);
  try{
    const response=await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(GEMINI_MODEL)}:generateContent`,{method:'POST',headers:{'Content-Type':'application/json','x-goog-api-key':GEMINI_API_KEY,'x-goog-api-client':'uno50/3.1'},body:JSON.stringify({systemInstruction:{parts:[{text:'Você é um moderador de chat de um jogo infantil/familiar. Classifique somente como ALLOW, BLOCK ou REVIEW. BLOCK apenas para ameaça, assédio grave, sexualização, discurso de ódio, incentivo a crime ou spam malicioso. REVIEW para conteúdo suspeito. Responda JSON simples: {"decision":"ALLOW|BLOCK|REVIEW","reason":"breve"}.'}]},contents:[{parts:[{text:cleanText(text,500)}]}],generationConfig:{temperature:0,maxOutputTokens:80}}),signal:controller.signal});
    if(!response.ok)return {allowed:true,reason:'api-error'};
    const data=await response.json();const raw=data?.candidates?.[0]?.content?.parts?.map(p=>p.text||'').join('')||'';
    const match=raw.match(/\{[\s\S]*\}/);if(!match)return {allowed:true,reason:'parse'};const parsed=JSON.parse(match[0]);
    return {allowed:parsed.decision!=='BLOCK',review:parsed.decision==='REVIEW',reason:parsed.reason||''};
  }catch{return {allowed:true,reason:'timeout'};}finally{clearTimeout(timer);}
}
function rateLimit(map,key,windowMs,max){const now=Date.now();const arr=(map.get(key)||[]).filter(t=>now-t<windowMs);if(arr.length>=max){map.set(key,arr);return false;}arr.push(now);map.set(key,arr);return true;}

async function dbQuery(text,params=[]){
  if(!pool) throw new Error('PostgreSQL não está disponível.');
  try{return await pool.query(text,params);}catch(err){
    if(!['ECONNRESET','ECONNREFUSED','ETIMEDOUT','57P01','57P02','57P03','08000','08001','08003','08004','08006','08007','08009'].includes(String(err?.code||''))) throw err;
    await new Promise(r=>setTimeout(r,250));
    return pool.query(text,params);
  }
}

app.get('/api/health',async(req,res)=>{
  const ready=databaseReady || (!process.env.DATABASE_URL && databaseReady);
  // Render deve conseguir alcançar o processo mesmo durante a inicialização do banco.
  // O campo `ready` informa o estado real sem transformar o health check em 502/503.
  res.status(200).json({ok:ready,postgres:usePostgres,ready,rooms:rooms.size,paused:globalState.paused,error:ready?undefined:'Banco de dados ainda inicializando.'});
});

async function requireDatabase(req,res,next){
  try{
    if(databaseReady)return next();
    if(databaseReadyPromise)await databaseReadyPromise;
    if(databaseReady)return next();
    return res.status(503).json({success:false,message:'Servidor ainda está inicializando. Tente novamente em alguns segundos.'});
  }catch(err){
    console.error('❌ Banco não pronto:',err.message);
    return res.status(503).json({success:false,message:'Banco de dados temporariamente indisponível.'});
  }
}
app.get('/api/me',auth,async(req,res)=>{try{res.setHeader('Cache-Control','no-store');const profile=await getProfile(req.user.id);res.json({success:true,user:publicUser(req.user),profile});}catch(e){console.error('me:',e.message);res.status(503).json({success:false,message:'Conta temporariamente indisponível.'});}});
app.post('/api/logout',(req,res)=>{clearAuthCookie(res);res.setHeader('Cache-Control','no-store');res.json({success:true});});

app.post('/api/register',requireDatabase,async(req,res)=>{
  const username=cleanText(req.body.username,24); const password=String(req.body.password||''); const country=String(req.body.country||'BR').toUpperCase();
  if(!validUsername(username)||password.length<6||password.length>100) return res.status(400).json({success:false,message:'Usuário deve ter 3-24 caracteres (letras, números ou _), e a senha deve ter 6-100 caracteres.'});
  if (/^(ceovelho|ceo|admin|administrador|staff|sistema|system)$/i.test(username)) return res.status(403).json({success:false,message:'Esse nome de usuário é reservado.'});
  if(!validCountry(country)) return res.status(400).json({success:false,message:'Selecione um país válido.'});
  if(!rateLimit(loginAttempts,req.ip,60000,8)) return res.status(429).json({success:false,message:'Muitas tentativas. Aguarde um minuto.'});
  try {
    const hash=await bcrypt.hash(password,12); let user;
    if(usePostgres){const exists=await dbQuery('SELECT id FROM users WHERE LOWER(username)=LOWER($1)',[username]);if(exists.rows.length)return res.status(409).json({success:false,message:'Usuário já existe.'});const r=await dbQuery(`INSERT INTO users(username,password_hash,role,coins,xp,level,games_played,country) VALUES($1,$2,'user',500,0,1,0,$3) RETURNING *`,[username,hash]);user=r.rows[0];}
    else {const db=localDb();if(db.users.some(u=>u.username.toLowerCase()===username.toLowerCase()))return res.status(409).json({success:false,message:'Usuário já existe.'});user={id:(db.users.reduce((m,u)=>Math.max(m,u.id||0),0)+1),username,password_hash:hash,role:'user',coins:500,xp:0,level:1,wins:0,losses:0,games_played:0,country,created_at:new Date().toISOString()};db.users.push(user);saveLocalDb(db);}
    const token=signToken(user);setAuthCookie(res,token);
    let profile={avatar:defaultAvatar(),settings:defaultSettings(),bio:''};
    try{
      profile=await saveProfile(user.id,profile);
    }catch(profileErr){
      console.error('profile register:',profileErr.message);
      try{
        await dbQuery(`INSERT INTO profiles(user_id,avatar,settings,bio) VALUES($1,$2,$3,$4) ON CONFLICT(user_id) DO NOTHING`,
          [user.id,JSON.stringify(defaultAvatar()),JSON.stringify(defaultSettings()),'']);
        profile=await getProfile(user.id);
      }catch(repairProfileErr){
        console.error('profile repair:',repairProfileErr.message);
      }
    }
    for(const id of ['hair_basic','shirt_basic','pants_basic','shoes_basic','emote_wave','title_beginner','deck_classic','map_classroom']) if(usePostgres){try{await grantItem(user.id,id);}catch(itemErr){console.error('starter item:',itemErr.message);}}
    res.setHeader('Cache-Control','no-store');res.json({success:true,message:'Conta criada! Monte seu personagem para continuar.',authenticated:true,user:publicUser(user),profile,needsCustomization:true});
  } catch(e){console.error(e);res.status(500).json({success:false,message:'Erro ao criar conta.'});}
});

app.post('/api/login',requireDatabase,async(req,res)=>{
  const username=cleanText(req.body.username,24);const password=String(req.body.password||'');
  if(!username||!password)return res.status(400).json({success:false,message:'Informe usuário e senha.'});
  if(!rateLimit(loginAttempts,req.ip,60000,10))return res.status(429).json({success:false,message:'Muitas tentativas de login. Aguarde um minuto.'});
  try {let user=null;if(usePostgres){const r=await dbQuery('SELECT * FROM users WHERE LOWER(username)=LOWER($1) LIMIT 1',[username]);user=r.rows[0]||null;}else{const db=localDb();user=db.users.find(u=>u.username.toLowerCase()===username.toLowerCase())||null;}if(!user||!(await bcrypt.compare(password,user.password_hash)))return res.status(401).json({success:false,message:'Usuário ou senha incorretos.'});
    const mod=await activeModeration(user.id);if(mod?.action==='ban')return res.status(403).json({success:false,message:'Conta suspensa.',ban:mod});
    if(usePostgres)await dbQuery('UPDATE users SET last_login_at=CURRENT_TIMESTAMP WHERE id=$1',[user.id]);
    const token=signToken(user);setAuthCookie(res,token);
    for(const id of ['hair_basic','shirt_basic','pants_basic','shoes_basic','emote_wave','title_beginner','deck_classic','map_classroom']) if(usePostgres){try{await grantItem(user.id,id);}catch(itemErr){console.error('starter item login:',itemErr.message);}}
    let profile;try{profile=await getProfile(user.id);}catch(profileErr){console.error('profile login:',profileErr.message);profile={avatar:defaultAvatar(),settings:defaultSettings(),bio:''};}
    res.setHeader('Cache-Control','no-store');res.json({success:true,message:user.role==='CEO'?'Bem-vindo de volta, CEO!':'Login realizado com sucesso!',authenticated:true,user:publicUser(user),profile,needsCustomization:!profile.avatar||Object.keys(profile.avatar).length===0});
  }catch(e){console.error(e);res.status(500).json({success:false,message:'Erro no login.'});}
});

app.put('/api/profile',auth,async(req,res)=>{try{const avatar=req.body.avatar||{};const allowed=['skinColor','eyes','hair','hairColor','top','bottom','shoes','accessory','effect','emote','title'];const cleanAvatar={...defaultAvatar()};for(const k of allowed)cleanAvatar[k]=cleanText(avatar[k],80)||cleanAvatar[k];const slots=['hair','top','bottom','shoes','accessory','effect','emote','title'];for(const k of slots){const id=cleanAvatar[k];if(!id)continue;if(usePostgres){const item=(await pool.query('SELECT id,asset,is_active FROM items WHERE id=$1',[id])).rows[0];if(!item||!item.is_active)throw new Error('Item de personalização inválido.');if(item.asset?.ceoOnly&&!isCeoOwner(req.user))throw new Error('Esse item é exclusivo do CEO.');if(req.user.role!=='CEO' && !(await hasItem(req.user.id,id)))throw new Error('Você precisa possuir o item antes de equipá-lo.');}}if(!isCeoOwner(req.user))cleanAvatar.title=(cleanAvatar.title==='title_owner'||cleanAvatar.title==='title_ceo')?'title_beginner':cleanAvatar.title;const profile=await saveProfile(req.user.id,{avatar:cleanAvatar,settings:req.body.settings||{},bio:req.body.bio||''});res.setHeader('Cache-Control','no-store');res.json({success:true,profile});}catch(e){res.status(400).json({success:false,message:e.message||'Não foi possível salvar o personagem.'});}});
app.post('/api/game/solo-finish',auth,async(req,res)=>{
  const win=Boolean(req.body.win);
  const difficulty=['easy','medium','hard'].includes(String(req.body.difficulty||''))?String(req.body.difficulty):'medium';
  const coins=win?100:15;
  const xp=win?180:50;
  const matchId=crypto.randomUUID();
  try {
    if(usePostgres){
      await pool.query('BEGIN');
      const before=await pool.query('SELECT id,username,xp FROM users WHERE id=$1 FOR UPDATE',[req.user.id]);
      if(!before.rows[0])throw new Error('Usuário não encontrado.');
      const r=await pool.query('UPDATE users SET coins=coins+$1,xp=xp+$2,wins=wins+$3,losses=losses+$4,games_played=games_played+1 WHERE id=$5 RETURNING *',[coins,xp,win?1:0,win?0:1,req.user.id]);
      const u=r.rows[0];
      const lvl=levelForXp(Number(u.xp||0));
      const rr=await pool.query('UPDATE users SET level=$1 WHERE id=$2 RETURNING id,username,role,coins,xp,level,wins,losses,games_played',[lvl,req.user.id]);
      await pool.query('INSERT INTO matches(id,mode,difficulty,map_id,winner_user_id,ended_at,metadata) VALUES($1,$2,$3,$4,$5,CURRENT_TIMESTAMP,$6)',[matchId,'solo',difficulty,'local',win?req.user.id:null,JSON.stringify({source:'server',version:'3.1.0'})]);
      await pool.query('INSERT INTO match_players(match_id,user_id,username_snapshot,position,result,coins_earned,xp_earned) VALUES($1,$2,$3,$4,$5,$6,$7)',[matchId,req.user.id,req.user.username,1,win?'win':'loss',coins,xp]);
      await pool.query(`INSERT INTO user_mode_stats(user_id,mode,games_played,wins,losses) VALUES($1,'solo',1,$2,$3) ON CONFLICT(user_id,mode) DO UPDATE SET games_played=user_mode_stats.games_played+1,wins=user_mode_stats.wins+$2,losses=user_mode_stats.losses+$3,updated_at=CURRENT_TIMESTAMP`,[req.user.id,win?1:0,win?0:1]);
      await pool.query('COMMIT');
      return res.json({success:true,user:publicUser(rr.rows[0]||u),matchId});
    }
    const db=localDb();db.matches=db.matches||[];
    const u=db.users.find(x=>x.id===req.user.id);if(!u)throw new Error('Usuário não encontrado.');
    u.coins=(u.coins||0)+coins;u.xp=(u.xp||0)+xp;u.wins=(u.wins||0)+(win?1:0);u.losses=(u.losses||0)+(win?0:1);u.games_played=(u.games_played||0)+1;u.level=levelForXp(u.xp);
    db.matches.push({id:matchId,mode:'solo',difficulty,winner_user_id:win?req.user.id:null,ended_at:new Date().toISOString(),players:[{user_id:req.user.id,username:req.user.username,result:win?'win':'loss',coins_earned:coins,xp_earned:xp}]});
    saveLocalDb(db);return res.json({success:true,user:publicUser(u),matchId});
  } catch(e){try{await pool?.query('ROLLBACK')}catch{}console.error(e);res.status(500).json({success:false,message:'Não foi possível salvar a partida.'});}
});
app.get('/api/event/egypt',auth,async(req,res)=>{
  const u=await getUserById(req.user.id); if(!u)return res.status(401).json({success:false,message:'Sessão inválida.'});
  const xp=Math.max(0,Number(u.xp||0));
  const level=Math.min(100,Math.max(1,Math.floor(xp/100)||1));
  const progressXp=level>=100?100:(xp%100);
  const progressPercent=level>=100?100:progressXp;
  const claimed=[];
  if(usePostgres){
    const client=await pool.connect();
    try{await client.query('BEGIN');
      for(const r of EGYPT_EVENT_REWARDS){
        if(level<r.level)continue;
        const own=await client.query('SELECT 1 FROM user_inventory WHERE user_id=$1 AND item_id=$2',[req.user.id,r.id]);
        if(!own.rows.length){await client.query('INSERT INTO user_inventory(user_id,item_id) VALUES($1,$2) ON CONFLICT(user_id,item_id) DO NOTHING',[req.user.id,r.id]);claimed.push(r.id);}
      }
      await client.query('COMMIT');
    }catch(e){await client.query('ROLLBACK');throw e}finally{client.release();}
  }
  const inv=await getInventory(req.user.id);const owned=new Set(inv.map(i=>i.id));
  res.json({success:true,event:{id:'egypt-ancient-1',name:'Egito Antigo',pass:1},level,progressXp,progressPercent,claimed,rewards:EGYPT_EVENT_REWARDS.map(r=>({id:r.id,name:r.name,level:r.level,description:r.description,unlocked:owned.has(r.id)}))});
});

app.get('/api/inventory',auth,async(req,res)=>{try{res.json({success:true,items:await getInventory(req.user.id)});}catch(e){console.error('inventory route:',e.message);res.status(503).json({success:false,message:'Inventário temporariamente indisponível.'});}});
app.get('/api/items',async(req,res)=>{try{res.json({success:true,items:await getItems()});}catch(e){console.error('items route:',e.message);res.status(503).json({success:false,message:'Loja temporariamente indisponível.'});}});

app.get('/api/shop/market',auth,async(req,res)=>{if(!usePostgres)return res.json({success:true,listings:[]});const r=await pool.query(`SELECT m.listing_id,m.price,m.created_at,i.*,u.username seller FROM player_market m JOIN items i ON i.id=m.item_id JOIN users u ON u.id=m.seller_id WHERE m.status='active' ORDER BY m.created_at DESC LIMIT 100`);res.json({success:true,listings:r.rows});});
app.post('/api/shop/buy',auth,async(req,res)=>{
  const itemId=cleanText(req.body.itemId,80);if(!usePostgres)return res.status(503).json({success:false,message:'Loja online exige PostgreSQL.'});
  const client=await pool.connect();try{await client.query('BEGIN');const item=(await client.query('SELECT * FROM items WHERE id=$1 AND is_active=true FOR UPDATE',[itemId])).rows[0];if(!item)throw new Error('Item não encontrado.');if(item.asset?.eventExclusive)throw new Error('Este item é exclusivo do Evento Egito Antigo.');if(item.asset?.ceoOnly&&!isCeoOwner(req.user))throw new Error('Item exclusivo do CEO.');const own=await client.query('SELECT 1 FROM user_inventory WHERE user_id=$1 AND item_id=$2',[req.user.id,itemId]);if(own.rows.length)throw new Error('Você já possui este item.');const buyer=(await client.query('SELECT coins,xp FROM users WHERE id=$1 FOR UPDATE',[req.user.id])).rows[0];if(Number(buyer.xp)<Number(item.xp_required))throw new Error(`Você precisa de ${item.xp_required} XP.`);if(req.user.role!=='CEO'){if(Number(buyer.coins)<Number(item.price))throw new Error('Moedas insuficientes.');await client.query('UPDATE users SET coins=coins-$1 WHERE id=$2',[item.price,req.user.id]);}await client.query('INSERT INTO user_inventory(user_id,item_id) VALUES($1,$2)',[req.user.id,itemId]);await client.query('COMMIT');res.json({success:true,message:'Item desbloqueado!',item});}catch(e){await client.query('ROLLBACK');res.status(400).json({success:false,message:e.message});}finally{client.release();}
});
app.post('/api/shop/market/list',auth,async(req,res)=>{if(!usePostgres)return res.status(503).json({success:false,message:'Loja de jogadores exige PostgreSQL.'});const itemId=cleanText(req.body.itemId,80);const price=Math.floor(Number(req.body.price));if(!itemId||!Number.isFinite(price)||price<10||price>100000000)return res.status(400).json({success:false,message:'Preço inválido.'});const client=await pool.connect();try{await client.query('BEGIN');const own=(await client.query('SELECT quantity FROM user_inventory WHERE user_id=$1 AND item_id=$2 FOR UPDATE',[req.user.id,itemId])).rows[0];if(!own)throw new Error('Você não possui o item.');const meta=(await client.query('SELECT asset FROM items WHERE id=$1',[itemId])).rows[0];if(meta?.asset?.eventExclusive)throw new Error('Itens exclusivos do evento não podem ser vendidos.');const active=await client.query("SELECT 1 FROM player_market WHERE seller_id=$1 AND item_id=$2 AND status='active'",[req.user.id,itemId]);if(active.rows.length)throw new Error('Esse item já está anunciado.');await client.query('DELETE FROM user_inventory WHERE user_id=$1 AND item_id=$2',[req.user.id,itemId]);const r=await client.query("INSERT INTO player_market(seller_id,item_id,price) VALUES($1,$2,$3) RETURNING *",[req.user.id,itemId,price]);await client.query('COMMIT');res.json({success:true,listing:r.rows[0]});}catch(e){await client.query('ROLLBACK');res.status(400).json({success:false,message:e.message});}finally{client.release();}});
app.post('/api/shop/market/cancel',auth,async(req,res)=>{if(!usePostgres)return res.status(503).json({success:false,message:'Loja de jogadores exige PostgreSQL.'});const listingId=Number(req.body.listingId);const client=await pool.connect();try{await client.query('BEGIN');const l=(await client.query("SELECT * FROM player_market WHERE listing_id=$1 AND seller_id=$2 AND status='active' FOR UPDATE",[listingId,req.user.id])).rows[0];if(!l)throw new Error('Anúncio não encontrado.');await client.query("UPDATE player_market SET status='cancelled' WHERE listing_id=$1",[listingId]);await client.query('INSERT INTO user_inventory(user_id,item_id) VALUES($1,$2) ON CONFLICT(user_id,item_id) DO UPDATE SET quantity=user_inventory.quantity+1',[req.user.id,l.item_id]);await client.query('COMMIT');res.json({success:true,message:'Anúncio cancelado e item devolvido.'});}catch(e){await client.query('ROLLBACK');res.status(400).json({success:false,message:e.message});}finally{client.release();}});
app.post('/api/shop/market/buy',auth,async(req,res)=>{if(!usePostgres)return res.status(503).json({success:false,message:'Loja de jogadores exige PostgreSQL.'});const listingId=Number(req.body.listingId);const client=await pool.connect();try{await client.query('BEGIN');const l=(await client.query("SELECT m.*,i.name,i.asset FROM player_market m JOIN items i ON i.id=m.item_id WHERE m.listing_id=$1 AND m.status='active' FOR UPDATE",[listingId])).rows[0];if(!l)throw new Error('Anúncio não encontrado.');if(l.seller_id===req.user.id)throw new Error('Você não pode comprar seu próprio anúncio.');const buyer=(await client.query('SELECT coins FROM users WHERE id=$1 FOR UPDATE',[req.user.id])).rows[0];if(Number(buyer.coins)<Number(l.price))throw new Error('Moedas insuficientes.');const seller=(await client.query('SELECT id FROM users WHERE id=$1 FOR UPDATE',[l.seller_id])).rows[0];if(!seller)throw new Error('Vendedor não encontrado.');await client.query('UPDATE users SET coins=coins-$1 WHERE id=$2',[l.price,req.user.id]);await client.query('UPDATE users SET coins=coins+$1 WHERE id=$2',[l.price,l.seller_id]);await client.query('DELETE FROM user_inventory WHERE user_id=$1 AND item_id=$2',[l.seller_id,l.item_id]);await client.query('INSERT INTO user_inventory(user_id,item_id) VALUES($1,$2) ON CONFLICT(user_id,item_id) DO UPDATE SET quantity=user_inventory.quantity+1',[req.user.id,l.item_id]);await client.query("UPDATE player_market SET status='sold',sold_at=CURRENT_TIMESTAMP WHERE listing_id=$1",[listingId]);await client.query('COMMIT');res.json({success:true,message:'Compra concluída!'});}catch(e){await client.query('ROLLBACK');res.status(400).json({success:false,message:e.message});}finally{client.release();}});

app.get('/api/season',auth,async(req,res)=>{res.setHeader('Cache-Control','no-store');res.json({success:true,season:await getSeason(),isCeo:isCeoOwner(req.user)});});
app.post('/api/season/schedule',auth,requireCeoOwner,async(req,res)=>{
  const days=Math.floor(Number(req.body.days));
  if(!Number.isFinite(days)||days<1||days>365)return res.status(400).json({success:false,message:'A duração deve ser de 1 a 365 dias.'});
  if(!usePostgres)return res.status(503).json({success:false,message:'Temporadas exigem PostgreSQL.'});
  const client=await pool.connect(); try{await client.query('BEGIN'); const active=(await client.query("SELECT * FROM seasons WHERE status='active' ORDER BY season_number DESC LIMIT 1 FOR UPDATE")).rows[0]; if(!active)throw new Error('Temporada ativa não encontrada.'); if(new Date(active.ends_at).getTime()<=Date.now())throw new Error('A temporada já terminou. Clique em Próxima Temporada.'); const r=await client.query("UPDATE seasons SET ends_at=CURRENT_TIMESTAMP+($1 || ' days')::interval WHERE id=$2 RETURNING *",[days,active.id]); await client.query('COMMIT'); res.json({success:true,season:{seasonNumber:Number(r.rows[0].season_number),startsAt:r.rows[0].starts_at,endsAt:r.rows[0].ends_at,status:'active',canNext:false}}); }catch(e){await client.query('ROLLBACK');res.status(400).json({success:false,message:e.message});}finally{client.release()}
});
app.post('/api/season/next',auth,requireCeoOwner,async(req,res)=>{try{const season=await nextSeason(req.user.id);io.emit('season:new',season);res.json({success:true,season});}catch(e){res.status(400).json({success:false,message:e.message});}});

app.get('/api/history',auth,async(req,res)=>{try{
  const limit=Math.min(50,Math.max(1,Number(req.query.limit)||20));
  if(!usePostgres)return res.json({success:true,matches:[]});
  const r=await pool.query(`
    SELECT m.id,m.mode,m.map_id,m.room_code,m.started_at,m.ended_at,mp.result,mp.position,
           (SELECT COUNT(*) FROM match_players x WHERE x.match_id=m.id) AS players
    FROM match_players mp JOIN matches m ON m.id=mp.match_id
    WHERE mp.user_id=$1
    ORDER BY COALESCE(m.ended_at,m.started_at) DESC LIMIT $2`,[req.user.id,limit]);
  const labels={solo:'SOLO',online:'ONLINE'};
  res.json({success:true,matches:r.rows.map(x=>({id:x.id,mode:x.mode,modeLabel:labels[x.mode]||String(x.mode).toUpperCase(),mapId:x.map_id,roomCode:x.room_code,startedAt:x.started_at,endedAt:x.ended_at,result:x.result,position:x.position?Number(x.position):null,players:Number(x.players||0)}))});
}catch(e){console.error('history:',e.message);res.status(503).json({success:false,message:'Histórico temporariamente indisponível. Tente novamente em alguns segundos.'});}});
app.get('/api/stats/me',auth,async(req,res)=>{try{
  if(!usePostgres)return res.json({success:true,stats:{gamesPlayed:0,wins:0,winRate:0,solo:{gamesPlayed:0,wins:0},duo:{gamesPlayed:0,wins:0},trio:{gamesPlayed:0,wins:0},online:{gamesPlayed:0,wins:0}}});
  const totals=(await pool.query(`SELECT games_played,wins,CASE WHEN games_played>0 THEN ROUND(wins::numeric/games_played::numeric*100,1) ELSE 0 END win_rate FROM users WHERE id=$1`,[req.user.id])).rows[0]||{};
  const rows=(await pool.query(`SELECT mode,games_played,wins FROM user_mode_stats WHERE user_id=$1`,[req.user.id])).rows;
  const out={gamesPlayed:Number(totals.games_played||0),wins:Number(totals.wins||0),winRate:Number(totals.win_rate||0),solo:{gamesPlayed:0,wins:0},duo:{gamesPlayed:0,wins:0},trio:{gamesPlayed:0,wins:0},online:{gamesPlayed:0,wins:0}};
  for(const r of rows){const k=['solo','duo','trio'].includes(r.mode)?r.mode:'online';out[k].gamesPlayed+=Number(r.games_played||0);out[k].wins+=Number(r.wins||0);}
  res.json({success:true,stats:out});
}catch(e){console.error('stats:',e.message);res.status(503).json({success:false,message:'Estatísticas temporariamente indisponíveis.'});}});
app.get('/api/rank',async(req,res)=>{try{
  if(!usePostgres)return res.json({success:true,season:await getSeason(),players:[]});
  const r=await pool.query(`SELECT u.username,u.level,u.xp,u.coins,u.wins,u.games_played,u.country,u.admin_rank,p.avatar,CASE WHEN u.games_played>0 THEN ROUND((u.wins::numeric/u.games_played::numeric)*100,1) ELSE 0 END AS win_rate FROM users u LEFT JOIN profiles p ON p.user_id=u.id WHERE u.role<>'CEO' AND u.role<>'banned' AND LOWER(u.username)<>'ceovelho' ORDER BY CASE WHEN u.admin_rank IS NULL THEN 999999 ELSE u.admin_rank END ASC,u.wins DESC,u.xp DESC,u.level DESC,u.games_played DESC,u.username ASC LIMIT 10`);
  const onlineIds=new Set([...socketUsers.values()].map(x=>Number(x.userId)));
  const idRows=await pool.query(`SELECT id,username FROM users WHERE LOWER(username)=ANY($1::text[])`,[r.rows.map(x=>String(x.username).toLowerCase())]);
  const idByName=new Map(idRows.rows.map(x=>[String(x.username).toLowerCase(),Number(x.id)]));
  const season=await getSeason();
  const players=r.rows.map(p=>{const id=idByName.get(String(p.username).toLowerCase());return {username:p.username,level:Number(p.level||1),xp:Number(p.xp||0),coins:Number(p.coins||0),wins:Number(p.wins||0),gamesPlayed:Number(p.games_played||0),winRate:Number(p.win_rate||0),country:String(p.country||'BR').toUpperCase(),avatar:p.avatar||{},online:id?onlineIds.has(id):false,prestige:prestigeForXp(p.xp)};});
  res.json({success:true,season,players});
}catch(e){console.error('rank:',e.message);res.status(503).json({success:false,message:'Rank mundial temporariamente indisponível.'});}});
app.get('/api/admin/overview',auth,requireCeoOwner,async(req,res)=>{
  const season=await getSeason();
  const reports=usePostgres?(await pool.query(`SELECT r.id,r.reason,r.status,r.created_at,COALESCE(u.username,r.target_username,'desconhecido') target,COALESCE(a.username,'desconhecido') reporter FROM reports r LEFT JOIN users u ON u.id=r.target_id LEFT JOIN users a ON a.id=r.reporter_id WHERE r.status='open' ORDER BY r.created_at DESC LIMIT 100`)).rows:[];
  const players=[...rooms.values()].filter(r=>r.started).map(r=>({code:r.code,name:r.name,mapId:r.options.mapId,players:r.players.filter(p=>!p.isBot).map(p=>p.username),startedAt:r.game?.startedAt||r.createdAt}));
  res.setHeader('Cache-Control','no-store');res.json({success:true,season,paused:globalState,rooms:players,reports});
});
app.get('/api/admin/player',auth,requireCeoOwner,async(req,res)=>{const username=cleanText(req.query.username,24);if(!username)return res.status(400).json({success:false,message:'Informe o nome do jogador.'});const r=usePostgres?await pool.query(`SELECT id,username,role,coins,xp,level,wins,losses,games_played,admin_rank,country,created_at,last_login_at FROM users WHERE LOWER(username)=LOWER($1) LIMIT 1`,[username]):{rows:[]};if(!r.rows[0])return res.status(404).json({success:false,message:'Jogador não encontrado.'});const u=r.rows[0];const inv=await getInventory(u.id);let history=[],reports=[];if(usePostgres){history=(await pool.query(`SELECT m.id,m.mode,m.map_id,m.started_at,m.ended_at,mp.result,mp.position,mp.xp_earned,mp.coins_earned FROM match_players mp JOIN matches m ON m.id=mp.match_id WHERE mp.user_id=$1 ORDER BY m.started_at DESC LIMIT 30`,[u.id])).rows;reports=(await pool.query(`SELECT r.id,r.reason,r.status,r.created_at,COALESCE(a.username,'desconhecido') reporter FROM reports r LEFT JOIN users a ON a.id=r.reporter_id WHERE r.target_id=$1 ORDER BY r.created_at DESC LIMIT 50`,[u.id])).rows;}res.json({success:true,player:{id:u.id,username:u.username,role:u.role,coins:Number(u.coins),xp:Number(u.xp),level:Number(u.level),wins:Number(u.wins),losses:Number(u.losses),gamesPlayed:Number(u.games_played),adminRank:u.admin_rank==null?null:Number(u.admin_rank),country:u.country||'BR',inventory:inv.map(i=>({id:i.id,name:i.name,category:i.category,quantity:i.quantity,asset:i.asset||{}})),history,reports}});});
app.post('/api/admin/player/action',auth,requireCeoOwner,async(req,res)=>{
  if(!usePostgres)return res.status(503).json({success:false,message:'Ações administrativas exigem PostgreSQL.'});
  const targetId=Number(req.body.userId), action=cleanText(req.body.action,40);
  if(!targetId || targetId===req.user.id)return res.status(400).json({success:false,message:'Ação inválida para este usuário.'});
  const target=(await pool.query('SELECT * FROM users WHERE id=$1',[targetId])).rows[0];
  if(!target)return res.status(404).json({success:false,message:'Jogador não encontrado.'});
  if(target.role==='CEO')return res.status(403).json({success:false,message:'O CEO não pode ser alterado por esta central.'});
  const reason=cleanText(req.body.reason||'Ação administrativa.',255);
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    if(action==='clear_inventory') await client.query('DELETE FROM user_inventory WHERE user_id=$1',[targetId]);
    else if(action==='clear_xp') await client.query('UPDATE users SET xp=0,level=1 WHERE id=$1',[targetId]);
    else if(action==='clear_coins') await client.query('UPDATE users SET coins=0 WHERE id=$1',[targetId]);

    else if(action==='ban'||action==='suspend'){
      const minutes=Math.min(43200,Math.max(1,Number(req.body.minutes)||60));
      await client.query(`INSERT INTO moderation_actions(actor_id,target_id,action,reason,expires_at,metadata) VALUES($1,$2,$3,$4,CURRENT_TIMESTAMP + ($5 || ' minutes')::interval,$6)`,[req.user.id,targetId,'ban',reason,minutes,JSON.stringify({panelAction:action})]);
      for(const [sid,u] of socketUsers) if(Number(u.userId)===targetId) io.to(sid).emit('admin:kick',{message:`Sua conta foi ${action==='ban'?'banida':'suspensa'} pelo administrador.`});
      const room=findPlayerRoom(targetId); if(room)removePlayer(room,targetId);
    } else if(action==='set_rank'){
      const rank=Math.floor(Number(req.body.rank));
      if(!Number.isInteger(rank)||rank<1||rank>1000)throw new Error('A posição deve estar entre 1 e 1000.');
      await client.query('UPDATE users SET admin_rank=admin_rank+1 WHERE admin_rank IS NOT NULL AND admin_rank>=$1 AND id<>$2',[rank,targetId]);await client.query('UPDATE users SET admin_rank=$1 WHERE id=$2',[rank,targetId]);
    } else if(action==='clear_rank'){
      await client.query('UPDATE users SET admin_rank=NULL WHERE id=$1',[targetId]);
    } else return res.status(400).json({success:false,message:'Ação desconhecida.'});
    await client.query('INSERT INTO admin_logs(actor_id,command,arguments,result) VALUES($1,$2,$3,$4)',[req.user.id,'panel:'+action,JSON.stringify({targetId,rank:req.body.rank,minutes:req.body.minutes}),'ok']);
    await client.query('COMMIT');
    res.json({success:true,message:'Ação aplicada.'});
  }catch(e){await client.query('ROLLBACK');res.status(400).json({success:false,message:e.message});}
  finally{client.release();}
});
app.post('/api/admin/self/clear',auth,requireCeoOwner,async(req,res)=>{if(!usePostgres)return res.status(503).json({success:false});const action=cleanText(req.body.action,30);if(action==='coins'){await pool.query('UPDATE users SET coins=999999999999 WHERE id=$1',[req.user.id]);}else if(action==='inventory')await pool.query('DELETE FROM user_inventory WHERE user_id=$1',[req.user.id]);else return res.status(400).json({success:false,message:'Ação inválida.'});await logAdmin(req.user.id,'self:'+action,'');res.json({success:true,message:action==='coins'?'Ouro do CEO restaurado ao infinito.':'Inventário do CEO limpo.'});});
app.post('/api/admin/global/pause',auth,requireCeoOwner,async(req,res)=>{const paused=Boolean(req.body.paused);globalState={paused,message:paused?cleanText(req.body.message||'Jogo temporariamente paralisado pelo administrador.',500):''};if(usePostgres)await pool.query('UPDATE global_game_state SET paused=$1,message=$2,updated_by=$3,updated_at=CURRENT_TIMESTAMP WHERE id=1',[paused,globalState.message,req.user.id]);io.emit(paused?'global:pause':'global:resume',globalState);await logAdmin(req.user.id,paused?'/paralisaruno':'/desparalisaruno',globalState.message);res.json({success:true,paused:globalState});});
app.post('/api/admin/room/stop',auth,requireCeoOwner,async(req,res)=>{const code=String(req.body.code||'').toUpperCase();const room=rooms.get(code);if(!room)return res.status(404).json({success:false,message:'Partida não encontrada.'});io.to(`room:${code}`).emit('room:closed',{message:'Partida encerrada pelo administrador.'});if(usePostgres&&room.game?.matchId){await pool.query("UPDATE matches SET ended_at=COALESCE(ended_at,CURRENT_TIMESTAMP),metadata=metadata || '{\"stoppedByAdmin\":true}'::jsonb WHERE id=$1",[room.game.matchId]);await pool.query("UPDATE match_players SET result='stopped' WHERE match_id=$1 AND result='playing'",[room.game.matchId]);}rooms.delete(code);await logAdmin(req.user.id,'panel:stop-room',code);res.json({success:true,message:'Partida encerrada.'});});
app.post('/api/admin/reports/:id/resolve',auth,requireCeoOwner,async(req,res)=>{if(!usePostgres)return res.json({success:true});const id=Number(req.params.id);await pool.query("UPDATE reports SET status='resolved',resolved_at=CURRENT_TIMESTAMP WHERE id=$1",[id]);await logAdmin(req.user.id,'report:resolve',String(id));res.json({success:true,message:'Denúncia resolvida.'});});

app.post('/api/report',auth,async(req,res)=>{if(!usePostgres)return res.json({success:true});if(!rateLimit(reportRate,req.user.id,60000,5))return res.status(429).json({success:false,message:'Limite de denúncias atingido. Tente novamente mais tarde.'});const rawTarget=String(req.body.targetId||'');const targetName=cleanText(req.body.targetName,50);const reason=cleanText(req.body.reason,255);if(!rawTarget||!reason)return res.status(400).json({success:false,message:'Denúncia incompleta.'});const target=Number(rawTarget);if(Number.isInteger(target)&&target>0){if(target===req.user.id)return res.status(400).json({success:false,message:'Você não pode denunciar a si mesmo.'});const targetExists=await pool.query("SELECT id,username FROM users WHERE id=$1 AND role<>'CEO'",[target]);if(!targetExists.rows.length)return res.status(400).json({success:false,message:'Jogador não encontrado ou protegido.'});await pool.query('INSERT INTO reports(reporter_id,target_id,target_username,reason) VALUES($1,$2,$3,$4)',[req.user.id,target,targetExists.rows[0].username,reason]);}else{if(!targetName)return res.status(400).json({success:false,message:'Alvo da denúncia não identificado.'});await pool.query('INSERT INTO reports(reporter_id,target_id,target_username,reason) VALUES($1,NULL,$2,$3)',[req.user.id,targetName,reason]);}res.json({success:true,message:'Denúncia enviada.'});});

app.get('/api/rooms',auth,(req,res)=>{res.json({success:true,rooms:[...rooms.values()].filter(r=>!r.started&&!r.locked).map(roomSummary)});});
app.post('/api/rooms',auth,async(req,res)=>{if(globalState.paused)return res.status(423).json({success:false,message:globalState.message||'O jogo está paralisado.'});const options=normalizeRoomOptions(req.body);const code=makeRoomCode();const room={code,name:cleanText(req.body.name||`Sala de ${req.user.username}`,40),ownerId:req.user.id,ownerName:req.user.username,password:cleanText(req.body.password,40),options,players:[],started:false,locked:false,game:null,createdAt:Date.now()};room.players.push(makeRoomPlayer(req.user, (await getProfile(req.user.id)).avatar));rooms.set(code,room);res.json({success:true,room:roomSummary(room),roomCode:code});});
app.post('/api/rooms/:code/join',auth,async(req,res)=>{const room=rooms.get(req.params.code.toUpperCase());if(!room)return res.status(404).json({success:false,message:'Sala não encontrada.'});if(room.started)return res.status(409).json({success:false,message:'A partida já começou.'});if(room.players.length>=room.options.maxPlayers)return res.status(409).json({success:false,message:'Sala cheia.'});if(room.password&&room.password!==String(req.body.password||''))return res.status(403).json({success:false,message:'Senha incorreta.'});if(room.players.some(p=>p.userId===req.user.id))return res.json({success:true,room:roomSummary(room)});room.players.push(makeRoomPlayer(req.user,(await getProfile(req.user.id)).avatar));emitRoom(room);res.json({success:true,room:roomSummary(room)});});
app.post('/api/rooms/:code/leave',auth,(req,res)=>{const room=rooms.get(req.params.code.toUpperCase());if(!room)return res.json({success:true});removePlayer(room,req.user.id);res.json({success:true});});
app.post('/api/rooms/:code/start',auth,(req,res)=>{const room=rooms.get(req.params.code.toUpperCase());if(!room)return res.status(404).json({success:false,message:'Sala não encontrada.'});if(room.ownerId!==req.user.id)return res.status(403).json({success:false,message:'Somente o criador inicia a sala.'});if(room.players.length<2&&!room.options.allowBots)return res.status(400).json({success:false,message:'Adicione pelo menos 2 jogadores ou ative bots.'});if(globalState.paused)return res.status(423).json({success:false,message:globalState.message||'Jogo paralisado.'});while(room.players.length<room.options.maxPlayers&&room.options.allowBots&&room.players.length<room.options.botFill)room.players.push(makeBotPlayer(room.players.length,room.players.map(p=>p.username)));startRoomGame(room).then(()=>res.json({success:true,room:roomSummary(room)})).catch(e=>res.status(500).json({success:false,message:'Não foi possível iniciar a partida.'}));});

function normalizeRoomOptions(body){return {maxPlayers:Math.min(8,Math.max(2,Number(body.maxPlayers)||4)),turnSeconds:Math.min(120,Math.max(15,Number(body.turnSeconds)||45)),allowBots:body.allowBots!==false,botFill:Math.min(8,Math.max(2,Number(body.botFill)||4)),difficulty:['easy','medium','hard'].includes(body.difficulty)?body.difficulty:'medium',mapId:['map_pirate','map_saloon','map_classroom','map_geometry','map_neon_city','map_forest','map_desert','map_ice','map_space','map_ceo'].includes(String(body.mapId))?String(body.mapId):'map_saloon',deckId:cleanText(body.deckId||'deck_classic',80),specials:body.specials!==false,math:false,chat:body.chat!==false,worldChat:body.worldChat!==false,privateChat:body.privateChat!==false,stackDraw:body.stackDraw===true,startingCards:Math.min(12,Math.max(5,Number(body.startingCards)||7))};}
function makeRoomCode(){let c;do{c='U50-'+Math.random().toString(36).slice(2,6).toUpperCase();}while(rooms.has(c));return c;}
function makeRoomPlayer(user,avatar=null){return {userId:user.id,username:user.username,role:user.role,avatar,xp:Number(user.xp||0),level:Number(user.level||1),prestige:prestigeForXp(user.xp),connected:true,hand:[],isBot:false};}

// Bots online usam identidades fictícias completas e indistinguíveis de jogadores reais.
// A flag isBot é estritamente interna ao servidor e NUNCA é enviada ao cliente.
const BOT_PERSONAS=[
  {name:'Lucas Martins',level:18,prestige:0,style:'easy',avatar:{skinColor:'#d59b76',eyes:'#1d2433',hair:'hair_basic',hairColor:'#23170f',top:'shirt_basic',bottom:'pants_basic',shoes:'shoes_basic',accessory:null,effect:null,title:'title_beginner'}},
  {name:'Mariana Alves',level:42,prestige:0,style:'medium',avatar:{skinColor:'#b87852',eyes:'#241b32',hair:'hair_long',hairColor:'#2a1710',top:'shirt_neon',bottom:'pants_black',shoes:'shoes_basic',accessory:'glasses_cyan',effect:null,title:'title_beginner'}},
  {name:'Rafael Souza',level:67,prestige:1,style:'hard',avatar:{skinColor:'#e0aa82',eyes:'#16283b',hair:'hair_basic',hairColor:'#141414',top:'shirt_basic',bottom:'pants_neon',shoes:'shoes_basic',accessory:'hat_cap',effect:'aura_gold',title:'title_beginner'}},
  {name:'Beatriz Lima',level:91,prestige:1,style:'hard',avatar:{skinColor:'#8d5a43',eyes:'#2a1830',hair:'hair_long',hairColor:'#3b1d14',top:'shirt_gold',bottom:'pants_black',shoes:'shoes_basic',accessory:'glasses_cyan',effect:'aura_rainbow',title:'title_beginner'}},
  {name:'Gabriel Costa',level:12,prestige:0,style:'easy',avatar:{skinColor:'#c88d68',eyes:'#172235',hair:'hair_basic',hairColor:'#5b371e',top:'shirt_basic',bottom:'pants_basic',shoes:'shoes_basic',accessory:null,effect:null,title:'title_beginner'}},
  {name:'Ana Clara Rocha',level:54,prestige:1,style:'medium',avatar:{skinColor:'#d9a37c',eyes:'#33213c',hair:'hair_long',hairColor:'#171717',top:'shirt_neon',bottom:'pants_black',shoes:'shoes_basic',accessory:'hat_crown',effect:'aura_gold',title:'title_beginner'}},
  {name:'Pedro Henrique',level:103,prestige:2,style:'hard',avatar:{skinColor:'#9b654b',eyes:'#15202c',hair:'hair_basic',hairColor:'#090909',top:'shirt_red',bottom:'pants_black',shoes:'shoes_basic',accessory:'glasses_gold',effect:'aura_gold',title:'title_beginner'}},
  {name:'Julia Mendes',level:76,prestige:1,style:'medium',avatar:{skinColor:'#f0b38c',eyes:'#34253c',hair:'hair_long',hairColor:'#6b321d',top:'shirt_neon',bottom:'pants_neon',shoes:'shoes_basic',accessory:'glasses_cyan',effect:'aura_gold',title:'title_beginner'}},
  {name:'Thiago Ribeiro',level:29,prestige:0,style:'easy',avatar:{skinColor:'#c17d5c',eyes:'#18263b',hair:'hair_basic',hairColor:'#252525',top:'shirt_basic',bottom:'pants_basic',shoes:'shoes_basic',accessory:'hat_cap',effect:null,title:'title_beginner'}},
  {name:'Larissa Gomes',level:118,prestige:2,style:'hard',avatar:{skinColor:'#ad704f',eyes:'#261a31',hair:'hair_long',hairColor:'#1a0f0a',top:'shirt_neon',bottom:'pants_black',shoes:'shoes_basic',accessory:'glasses_cyan',effect:'aura_rainbow',title:'title_beginner'}},
  {name:'Bruno Oliveira',level:36,prestige:0,style:'medium',avatar:{skinColor:'#d89a72',eyes:'#172333',hair:'hair_basic',hairColor:'#3a2417',top:'shirt_basic',bottom:'pants_black',shoes:'shoes_basic',accessory:null,effect:null,title:'title_beginner'}},
  {name:'Camila Ferreira',level:144,prestige:2,style:'hard',avatar:{skinColor:'#c48762',eyes:'#241a35',hair:'hair_long',hairColor:'#30170e',top:'shirt_gold',bottom:'pants_neon',shoes:'shoes_basic',accessory:'glasses_gold',effect:'aura_gold',title:'title_beginner'}},
  {name:'Diego Santos',level:7,prestige:0,style:'easy',avatar:{skinColor:'#e2ad86',eyes:'#172131',hair:'hair_basic',hairColor:'#101010',top:'shirt_red',bottom:'pants_basic',shoes:'shoes_basic',accessory:null,effect:null,title:'title_beginner'}},
  {name:'Sofia Carvalho',level:62,prestige:1,style:'medium',avatar:{skinColor:'#d39a74',eyes:'#30203a',hair:'hair_long',hairColor:'#442114',top:'shirt_basic',bottom:'pants_black',shoes:'shoes_basic',accessory:'hat_crown',effect:'aura_gold',title:'title_beginner'}},
  {name:'Mateus Almeida',level:131,prestige:2,style:'hard',avatar:{skinColor:'#7f503d',eyes:'#142235',hair:'hair_basic',hairColor:'#111111',top:'shirt_basic',bottom:'pants_black',shoes:'shoes_basic',accessory:'hat_cap',effect:'aura_gold',title:'title_beginner'}},
  {name:'Isabela Nunes',level:48,prestige:0,style:'medium',avatar:{skinColor:'#e8b08a',eyes:'#2c2038',hair:'hair_long',hairColor:'#24110c',top:'shirt_neon',bottom:'pants_basic',shoes:'shoes_basic',accessory:'glasses_cyan',effect:null,title:'title_beginner'}},
  {name:'Felipe Barbosa',level:84,prestige:1,style:'hard',avatar:{skinColor:'#b87855',eyes:'#152334',hair:'hair_basic',hairColor:'#1b1b1b',top:'shirt_neon',bottom:'pants_neon',shoes:'shoes_basic',accessory:'glasses_gold',effect:'aura_gold',title:'title_beginner'}},
  {name:'Manuela Castro',level:23,prestige:0,style:'easy',avatar:{skinColor:'#dba17b',eyes:'#35233c',hair:'hair_long',hairColor:'#512316',top:'shirt_gold',bottom:'pants_basic',shoes:'shoes_basic',accessory:null,effect:null,title:'title_beginner'}},
  {name:'André Rodrigues',level:157,prestige:3,style:'hard',avatar:{skinColor:'#925d45',eyes:'#142032',hair:'hair_basic',hairColor:'#080808',top:'shirt_basic',bottom:'pants_black',shoes:'shoes_basic',accessory:'glasses_gold',effect:'aura_gold',title:'title_beginner'}},
  {name:'Clara Monteiro',level:70,prestige:1,style:'medium',avatar:{skinColor:'#efb58d',eyes:'#33213d',hair:'hair_long',hairColor:'#6a321c',top:'shirt_neon',bottom:'pants_neon',shoes:'shoes_basic',accessory:'glasses_cyan',effect:'aura_rainbow',title:'title_beginner'}}
];

function makeBotPlayer(n,existingNames=[]){
  const available=BOT_PERSONAS.filter(x=>!existingNames.includes(x.name));
  const pool=available.length?available:BOT_PERSONAS;
  const base=pool[(Math.floor(Math.random()*pool.length)+n)%pool.length];
  const suffix=Math.floor(Math.random()*900)+100;
  return {userId:`bot-${crypto.randomUUID()}`,username:`${base.name}`,role:'bot',avatar:{...base.avatar},level:base.level,prestige:base.prestige,botStyle:base.style,botPersonaId:`persona-${base.name.toLowerCase().replace(/[^a-z0-9]+/g,'-')}-${suffix}`,connected:true,hand:[],isBot:true};
}

function publicPlayerId(p,i){return p.isBot?`seat-${i+1}`:p.userId;}
function publicPlayer(p,i){return {userId:publicPlayerId(p,i),username:p.username,role:'user',connected:p.connected,cardCount:p.hand?.length||0,avatar:p.avatar||null,level:Number(p.level||1),prestige:Math.min(5,Number(p.prestige??prestigeForXp(p.xp))) };}
function roomSummary(room){return {code:room.code,name:room.name,ownerId:room.ownerId,ownerName:room.ownerName,locked:!!room.password,started:room.started,players:room.players.map(publicPlayer),options:room.options,createdAt:room.createdAt};}
function emitRoom(room){io.to(`room:${room.code}`).emit('room:update',roomSummary(room));io.emit('rooms:update');}
function removePlayer(room,userId){const i=room.players.findIndex(p=>String(p.userId)===String(userId));if(i<0)return;if(room.started){room.players[i].connected=false;room.players[i].hand=[];io.to(`room:${room.code}`).emit('room:system',{message:`${room.players[i].username} saiu da partida.`});}else{room.players.splice(i,1);if(room.ownerId===userId&&room.players.length){room.ownerId=room.players[0].userId;room.ownerName=room.players[0].username;}if(!room.players.length)rooms.delete(room.code);else emitRoom(room);}}

const COLORS=['red','yellow','green','blue'];
function buildDeck(){const deck=[];for(const color of COLORS){deck.push({id:crypto.randomUUID(),color,value:'0',type:'number'});for(let n=1;n<=9;n++)for(let copy=0;copy<2;copy++)deck.push({id:crypto.randomUUID(),color,value:String(n),type:'number'});for(let copy=0;copy<2;copy++){deck.push({id:crypto.randomUUID(),color,value:'🚫',type:'skip'});deck.push({id:crypto.randomUUID(),color,value:'🔄',type:'reverse'});deck.push({id:crypto.randomUUID(),color,value:'+2',type:'draw2'});}}for(let i=0;i<4;i++){deck.push({id:crypto.randomUUID(),color:'black',value:'🌈',type:'wild'});deck.push({id:crypto.randomUUID(),color:'black',value:'+4',type:'draw4'});}for(let i=deck.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[deck[i],deck[j]]=[deck[j],deck[i]];}return deck;}
function playable(card,top,currentColor){return !!card&&!!top&&(card.color==='black'||card.color===currentColor||card.value===top.value);}
function canStackDraw(card,room){
  const pending=Number(room?.game?.pendingDraw||0);
  if(!pending)return true;
  if(!room.options.stackDraw)return false;
  return card?.type==='draw2'||card?.type==='draw4';
}
async function persistMatchStart(room){
  if(!room?.game?.matchId)return;
  if(usePostgres){
    await pool.query('INSERT INTO matches(id,mode,difficulty,map_id,room_code,metadata) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(id) DO NOTHING',[room.game.matchId,'online',room.options.difficulty||'medium',room.options.mapId||null,room.code,JSON.stringify({maxPlayers:room.options.maxPlayers,startingCards:room.options.startingCards,stackDraw:!!room.options.stackDraw})]);
    for(let i=0;i<room.players.length;i++){const p=room.players[i];await pool.query('INSERT INTO match_players(match_id,user_id,username_snapshot,position,result) VALUES($1,$2,$3,$4,$5) ON CONFLICT(match_id,username_snapshot) DO NOTHING',[room.game.matchId,p.isBot?null:p.userId,p.username,i+1,'playing']);}
  }else{
    const db=localDb();db.matches=db.matches||[];
    if(!db.matches.some(m=>m.id===room.game.matchId))db.matches.push({id:room.game.matchId,mode:'online',difficulty:room.options.difficulty||'medium',map_id:room.options.mapId||null,room_code:room.code,started_at:new Date().toISOString(),players:room.players.map((p,i)=>({user_id:p.isBot?null:p.userId,username:p.username,position:i+1,result:'playing'}))});
    saveLocalDb(db);
  }
}

async function startRoomGame(room,silent=false){room.started=true;room.locked=true;const deck=buildDeck();room.game={deck,discard:[],currentColor:null,currentIndex:0,direction:1,pendingDraw:0,startedAt:Date.now(),lastAction:Date.now(),winner:null,matchId:crypto.randomUUID(),challenges:new Map()};room.players.forEach(p=>p.hand=[]);for(let n=0;n<room.options.startingCards;n++)for(const p of room.players){if(deck.length)p.hand.push(deck.pop());}let top;do{top=deck.pop();}while(top&&top.color==='black');room.game.discard=[top];room.game.currentColor=top.color;await persistMatchStart(room);if(!silent)emitGame(room);if(room.players[room.game.currentIndex]?.isBot)setTimeout(()=>botTurn(room),900);}
function safeGameFor(player,room){const g=room.game;const publicPlayers=room.players.map(publicPlayer);return {matchId:g.matchId,code:room.code,quickMatch:!!room.quickMatch,players:publicPlayers,top:g.discard[g.discard.length-1],currentColor:g.currentColor,currentPlayerId:publicPlayer(room.players[g.currentIndex],g.currentIndex)?.userId,direction:g.direction,pendingDraw:g.pendingDraw,deckCount:g.deck.length,hand:player?.hand||[],mapId:room.options.mapId,deckId:room.options.deckId,startedAt:g.startedAt,turnSeconds:room.options.turnSeconds,winner:g.winner};}
function emitGame(room){for(const p of room.players){if(p.isBot)continue;for(const [sid,u] of socketUsers){if(u.userId===p.userId)io.to(sid).emit('game:state',safeGameFor(p,room));}}}
function nextIndex(room,steps=1){const g=room.game;let i=g.currentIndex;for(let n=0;n<steps;n++){do{i=(i+g.direction+room.players.length)%room.players.length;}while(room.players[i]&&!room.players[i].connected&&n<room.players.length); }return i;}
function drawCards(room,player,count){for(let i=0;i<count;i++){if(!room.game.deck.length){const top=room.game.discard.pop();room.game.deck=room.game.discard.splice(0);room.game.discard=[top];for(let j=room.game.deck.length-1;j>0;j--){const k=Math.floor(Math.random()*(j+1));[room.game.deck[j],room.game.deck[k]]=[room.game.deck[k],room.game.deck[j]];}}if(room.game.deck.length)player.hand.push(room.game.deck.pop());}}
function applyCard(room,player,card,chosenColor){const g=room.game;g.lastAction=Date.now();g.discard.push(card);g.currentColor=card.color==='black'?(COLORS.includes(chosenColor)?chosenColor:COLORS[Math.floor(Math.random()*4)]):card.color;g.pendingDraw=0;if(card.type==='draw2')g.pendingDraw=2;if(card.type==='draw4')g.pendingDraw=4;if(card.type==='reverse'&&room.players.length>2)g.direction*=-1;let skip=card.type==='skip'||(card.type==='reverse'&&room.players.length===2);g.currentIndex=nextIndex(room,skip?2:1);}
function turnAllowed(room,userId){return !globalState.paused&&room.started&&room.players[room.game.currentIndex]?.userId===userId;}
function botTurn(room){if(!room.started||room.game.winner||globalState.paused)return;const p=room.players[room.game.currentIndex];if(!p?.isBot)return;let candidates=p.hand.filter(c=>playable(c,room.game.discard.at(-1),room.game.currentColor)&&canStackDraw(c,room));let card=null;if(candidates.length){if(p.botStyle==='easy'){card=candidates[Math.floor(Math.random()*candidates.length)];}else if(p.botStyle==='medium'){card=[...candidates].sort((a,b)=>scoreCard(b)-scoreCard(a))[0];}else{card=[...candidates].sort((a,b)=>botAdvancedScore(b,p,room)-botAdvancedScore(a,p,room))[0];}}if(!card){drawCards(room,p,room.game.pendingDraw||1);room.game.pendingDraw=0;room.game.lastAction=Date.now();room.game.currentIndex=nextIndex(room,1);emitGame(room);setTimeout(()=>botTurn(room),700+Math.floor(Math.random()*700));return;}p.hand.splice(p.hand.indexOf(card),1);const color=card.color==='black'?chooseBotColor(p.hand):null;applyCard(room,p,card,color);checkRoomWinner(room,p);emitGame(room);if(!room.game.winner&&room.players[room.game.currentIndex]?.isBot)setTimeout(()=>botTurn(room),700+Math.floor(Math.random()*700));}
function botAdvancedScore(card,bot,room){let score=scoreCard(card);const same=bot.hand.filter(c=>c.color===card.color&&c.color!=='black').length;if(card.color===room.game.currentColor)score+=18;if(card.type==='wild'||card.type==='draw4')score+=8;if(bot.hand.length<=3)score+=35;if(same>=2)score+=12;return score;}
function scoreCard(c){return c.type==='draw4'?100:c.type==='draw2'?80:c.type==='wild'?70:c.type==='skip'?40:c.type==='reverse'?35:10;}
function chooseBotColor(hand){const counts={red:0,yellow:0,green:0,blue:0};hand.forEach(c=>{if(counts[c.color]!=null)counts[c.color]++;});return Object.entries(counts).sort((a,b)=>b[1]-a[1])[0][0];}
async function checkRoomWinner(room,player){if(player.hand.length!==0)return;room.game.winner=player.userId;room.started=false;room.locked=false;const realPlayers=room.players.filter(p=>!p.isBot);for(const p of realPlayers){const win=String(p.userId)===String(player.userId);await finishMatchPlayer(p,room,win);}emitGame(room);emitRoom(room);io.to(`room:${room.code}`).emit('game:winner',{username:player.username,userId:player.isBot?null:player.userId});}
async function finishMatchPlayer(p,room,win){if(p.isBot)return;const coins=win?150:25;const xp=win?250:60;const modeStat=Number(room?.options?.maxPlayers||0)===2?'duo':Number(room?.options?.maxPlayers||0)===3?'trio':'online';try{
  if(usePostgres){
    await pool.query('BEGIN');
    const before=await pool.query('SELECT xp FROM users WHERE id=$1 FOR UPDATE',[p.userId]);
    const newXp=Number(before.rows[0]?.xp||0)+xp;
    await pool.query(`UPDATE users SET coins=coins+$1,xp=xp+$2,level=LEAST(100,$3),wins=wins+$4,losses=losses+$5,games_played=games_played+1 WHERE id=$6`,[coins,xp,levelForXp(newXp),win?1:0,win?0:1,p.userId]);
    await pool.query('UPDATE match_players SET result=$1,coins_earned=$2,xp_earned=$3 WHERE match_id=$4 AND user_id=$5',[win?'win':'loss',coins,xp,room.game.matchId,p.userId]);
    await pool.query(`INSERT INTO user_mode_stats(user_id,mode,games_played,wins,losses) VALUES($1,$2,1,$3,$4) ON CONFLICT(user_id,mode) DO UPDATE SET games_played=user_mode_stats.games_played+1,wins=user_mode_stats.wins+$3,losses=user_mode_stats.losses+$4,updated_at=CURRENT_TIMESTAMP`,[p.userId,modeStat,win?1:0,win?0:1]);
    if(win)await pool.query('UPDATE matches SET winner_user_id=$1,ended_at=CURRENT_TIMESTAMP WHERE id=$2',[p.userId,room.game.matchId]);
    else await pool.query('UPDATE matches SET ended_at=COALESCE(ended_at,CURRENT_TIMESTAMP) WHERE id=$1',[room.game.matchId]);
    await pool.query('COMMIT');
  }else{
    const db=localDb();const m=(db.matches||[]).find(x=>x.id===room.game.matchId);if(m){const row=m.players?.find(x=>x.user_id===p.userId);if(row){row.result=win?'win':'loss';row.coins_earned=coins;row.xp_earned=xp;}if(win)m.winner_user_id=p.userId;m.ended_at=new Date().toISOString();}const u=db.users.find(x=>x.id===p.userId);if(u){u.coins=(u.coins||0)+coins;u.xp=(u.xp||0)+xp;u.level=levelForXp(u.xp);u.wins=(u.wins||0)+(win?1:0);u.losses=(u.losses||0)+(win?0:1);u.games_played=(u.games_played||0)+1;}saveLocalDb(db);
  }
}catch(e){try{await pool?.query('ROLLBACK')}catch{}console.error('finishMatchPlayer:',e.message);}}


async function getGlobalState(){if(!usePostgres)return {paused:false,message:''};const r=await pool.query('SELECT paused,message FROM global_game_state WHERE id=1');return r.rows[0]||{paused:false,message:''};}
let globalState={paused:false,message:''};
function enforceTurnTimeouts(){
  const now=Date.now();
  for(const room of rooms.values()){
    if(!room.started||!room.game||room.game.winner)continue;
    const current=room.players[room.game.currentIndex];
    if(!current)continue;
    const limit=Math.max(15,Number(room.options.turnSeconds)||45)*1000;
    if(now-(room.game.lastAction||room.game.startedAt||now)<limit)continue;
    if(current.isBot){botTurn(room);continue;}
    drawCards(room,current,room.game.pendingDraw||1);
    room.game.pendingDraw=0;
    room.game.lastAction=now;
    room.game.currentIndex=nextIndex(room,1);
    emitGame(room);
    io.to(`room:${room.code}`).emit('room:system',{message:`${current.username} perdeu o tempo e comprou carta(s).`});
    if(room.players[room.game.currentIndex]?.isBot)setTimeout(()=>botTurn(room),300);
  }
}
setInterval(enforceTurnTimeouts,1000).unref();

function queueTarget(mode){return mode==='trio'?3:2;}
function publicGameForQueue(room,userId){const p=room.players.find(x=>String(x.userId)===String(userId));return p?safeGameFor(p,room):null;}
function removeFromMatchmaking(userId){for(const mode of ['duo','trio']){matchmakingQueues[mode]=matchmakingQueues[mode].filter(x=>String(x.userId)!==String(userId));}}
async function startQuickMatch(mode,tickets){
  const target=queueTarget(mode); if(!tickets.length)return;
  const primary=tickets[0];
  const mapPool=['map_pirate','map_saloon','map_classroom','map_neon_city','map_forest','map_desert','map_ice'];
  const mapId=mapPool[Math.floor(Math.random()*mapPool.length)];
  const room={quickMatch:true,code:makeRoomCode(),name:mode==='duo'?'Partida Duo':'Partida Trio',ownerId:primary.userId,ownerName:primary.username,password:'',options:{maxPlayers:target,turnSeconds:45,allowBots:true,botFill:target,difficulty:['easy','medium','hard'][Math.floor(Math.random()*3)],mapId,deckId:'deck_classic',specials:true,math:false,chat:true,worldChat:true,privateChat:true,stackDraw:false,startingCards:7},players:[],started:false,locked:false,game:null,createdAt:Date.now()};
  for(const t of tickets){const user=await getUserById(t.userId);if(user)room.players.push(makeRoomPlayer(user,(await getProfile(user.id)).avatar));}
  const used=room.players.map(p=>p.username);while(room.players.length<target)room.players.push(makeBotPlayer(room.players.length,used));
  rooms.set(room.code,room);
  await startRoomGame(room,true);
  for(const t of tickets){const game=publicGameForQueue(room,t.userId);const sid=t.socketId;if(game&&sid){const sock=io.sockets.sockets.get(sid);sock?.join(`room:${room.code}`);io.to(sid).emit('matchmaking:found',game);}}
}
function scheduleQueueFill(mode){
  const q=matchmakingQueues[mode]; if(!q.length)return;
  const now=Date.now();const target=queueTarget(mode);
  if(q.length>=target){const batch=q.splice(0,target);startQuickMatch(mode,batch).catch(e=>console.error('quick match:',e.message));return;}
  for(const t of q){const elapsed=Math.floor((now-t.joinedAt)/1000);const sid=t.socketId;if(sid)io.to(sid).emit('matchmaking:status',{mode,message:elapsed<20?`Procurando ${target} jogadores... ${elapsed}s`:'Ajustando a mesa e procurando o melhor encaixe...' });}
  const ready=q.filter(t=>now-t.joinedAt>=20000);
  if(ready.length){const batch=ready.slice(0,target);for(const t of batch){const idx=q.indexOf(t);if(idx>=0)q.splice(idx,1);}startQuickMatch(mode,batch).catch(e=>console.error('quick match fallback:',e.message));}
}
setInterval(()=>{scheduleQueueFill('duo');scheduleQueueFill('trio');},1000).unref();

io.use(async(socket,next)=>{const token=parseCookies({headers:socket.handshake.headers})[AUTH_COOKIE];const payload=token&&verifyToken(token);if(!payload)return next(new Error('unauthorized'));const user=await getUserById(payload.id);if(!user)return next(new Error('unauthorized'));const mod=await activeModeration(user.id);if(mod?.action==='ban')return next(new Error('banned'));socketUsers.set(socket.id,{userId:user.id,username:user.username,role:user.role});socket.user=user;next();});

io.on('connection',socket=>{
  const me=socket.user;
  socket.on('matchmaking:join',({mode}={})=>{mode=mode==='trio'?'trio':'duo';removeFromMatchmaking(me.id);matchmakingQueues[mode].push({userId:me.id,socketId:socket.id,username:me.username,joinedAt:Date.now()});socket.emit('matchmaking:status',{mode,message:`Procurando ${queueTarget(mode)} jogadores... 0s`});scheduleQueueFill(mode);});
  socket.on('matchmaking:cancel',()=>{removeFromMatchmaking(me.id);socket.emit('matchmaking:cancelled');});

  socket.on('room:join',async({code,password}={})=>{const room=rooms.get(String(code||'').toUpperCase());if(!room)return socket.emit('toast',{type:'error',message:'Sala não encontrada.'});if(room.started)return socket.emit('toast',{type:'error',message:'Partida já iniciada.'});if(room.password&&room.password!==String(password||''))return socket.emit('toast',{type:'error',message:'Senha incorreta.'});if(room.players.length>=room.options.maxPlayers)return socket.emit('toast',{type:'error',message:'Sala cheia.'});if(!room.players.some(p=>p.userId===me.id))room.players.push(makeRoomPlayer(me,(await getProfile(me.id)).avatar));socket.join(`room:${room.code}`);emitRoom(room);socket.emit('room:joined',roomSummary(room));});
  socket.on('room:leave',()=>{for(const room of rooms.values())if(room.players.some(p=>p.userId===me.id)){socket.leave(`room:${room.code}`);removePlayer(room,me.id);}});
  socket.on('room:rejoin',({roomCode}={})=>{const room=rooms.get(String(roomCode||'').toUpperCase());if(!room)return socket.emit('toast',{type:'error',message:'A sala não está mais disponível.'});const p=room.players.find(x=>String(x.userId)===String(me.id));if(!p)return socket.emit('toast',{type:'error',message:'Você não faz mais parte desta sala.'});p.connected=true;socket.join(`room:${room.code}`);socket.emit('room:joined',roomSummary(room));if(room.started)emitGame(room);else emitRoom(room);});
  socket.on('room:start',async()=>{for(const room of rooms.values())if(room.ownerId===me.id&&room.players.some(p=>p.userId===me.id)){if(room.players.length<2&&!room.options.allowBots)return socket.emit('toast',{type:'error',message:'Adicione outro jogador ou permita bots.'});if(globalState.paused)return socket.emit('toast',{type:'error',message:globalState.message});if(room.options.allowBots){while(room.players.length<room.options.maxPlayers&&room.players.length<room.options.botFill)room.players.push(makeBotPlayer(room.players.length,room.players.map(p=>p.username)));}if(room.players.length<2)return socket.emit('toast',{type:'error',message:'Não foi possível preencher a sala.'});await startRoomGame(room);emitRoom(room);return;}});
  socket.on('game:play',async({cardId,chosenColor}={})=>{if(!rateLimit(gameActionRate,me.id,1000,8))return socket.emit('toast',{type:'error',message:'Muitas ações em pouco tempo.'});const room=findPlayerRoom(me.id);if(!room)return socket.emit('toast',{type:'error',message:'Você não está em uma sala.'});if(!turnAllowed(room,me.id))return socket.emit('toast',{type:'error',message:'Não é sua vez.'});const p=room.players.find(x=>x.userId===me.id);const index=p.hand.findIndex(c=>c.id===cardId||c._clientId===cardId);if(index<0)return socket.emit('toast',{type:'error',message:'Carta inválida.'});const card=p.hand[index];if(!playable(card,room.game.discard.at(-1),room.game.currentColor))return socket.emit('toast',{type:'error',message:'Carta não pode ser jogada.'});if(!canStackDraw(card,room))return socket.emit('toast',{type:'error',message:room.options.stackDraw?'Você só pode empilhar +2/+4 agora.':'Você precisa comprar antes de jogar.'});p.hand.splice(index,1);applyCard(room,p,card,chosenColor);await checkRoomWinner(room,p);emitGame(room);if(room.started&&room.players[room.game.currentIndex]?.isBot)setTimeout(()=>botTurn(room),800);});
  socket.on('game:draw',()=>{if(!rateLimit(gameActionRate,me.id,1000,8))return socket.emit('toast',{type:'error',message:'Muitas ações em pouco tempo.'});const room=findPlayerRoom(me.id);if(!room||!turnAllowed(room,me.id))return;const p=room.players.find(x=>x.userId===me.id);const pending=Number(room.game.pendingDraw||0);if(!pending&&p.hand.some(c=>playable(c,room.game.discard.at(-1),room.game.currentColor)&&canStackDraw(c,room))){return socket.emit('toast',{type:'error',message:'Você ainda possui uma carta jogável.'});}drawCards(room,p,pending||1);room.game.pendingDraw=0;room.game.lastAction=Date.now();room.game.currentIndex=nextIndex(room,1);emitGame(room);if(room.started&&room.players[room.game.currentIndex]?.isBot)setTimeout(()=>botTurn(room),800);});
  socket.on('chat:send',async({channel,body,roomCode,receiverId}={})=>{if(!rateLimit(chatRate,me.id,10000,12))return socket.emit('toast',{type:'error',message:'Você está enviando mensagens rápido demais.'});const text=cleanText(body,500);if(!text)return;const aiModeration=await geminiModerate(text);if(!aiModeration.allowed){if(usePostgres)await pool.query('INSERT INTO reports(reporter_id,target_id,reason,status) VALUES($1,$2,$3,$4)',[me.id,me.id,'Gemini bloqueou mensagem: '+cleanText(aiModeration.reason,220),'ai-block']);return socket.emit('toast',{type:'error',message:'Mensagem bloqueada pela moderação.'});}const mod=await activeModeration(me.id);if(mod?.action==='mute')return socket.emit('toast',{type:'error',message:'Você está silenciado.'});if(text.startsWith('/')&&isCeoOwner(me)){const result=await executeAdminCommand(me,text);socket.emit('admin:result',result);return;}const ch=['world','room','private'].includes(channel)?channel:'world';let room=findPlayerRoom(me.id);if(ch==='room'&&(!room||room.code!==String(roomCode||room?.code).toUpperCase()))return;let targetSocket=null;if(ch==='private'){targetSocket=[...socketUsers.entries()].find(([,u])=>Number(u.userId)===Number(receiverId))?.[0];if(!targetSocket)return socket.emit('toast',{type:'error',message:'Jogador offline.'});}if(ch==='room' && room?.options?.chat===false)return socket.emit('toast',{type:'error',message:'O chat desta sala está desativado.'});const msg={channel:ch,roomCode:room?.code||null,senderId:me.id,senderName:me.username,receiverId:receiverId||null,body:text,createdAt:new Date().toISOString()};if(usePostgres)await pool.query('INSERT INTO chat_messages(channel,room_code,sender_id,receiver_id,sender_name,body) VALUES($1,$2,$3,$4,$5,$6)',[ch,msg.roomCode,me.id,receiverId||null,me.username,text]);if(ch==='world')io.emit('chat:message',msg);else if(ch==='room')io.to(`room:${room.code}`).emit('chat:message',msg);else{socket.emit('chat:message',msg);if(targetSocket)io.to(targetSocket).emit('chat:message',msg);}});
  socket.on('disconnect',()=>{removeFromMatchmaking(me.id);for(const room of rooms.values()){const p=room.players.find(x=>String(x.userId)===String(me.id));if(p){p.connected=false;emitRoom(room);}}socketUsers.delete(socket.id);});
});
function findPlayerRoom(userId){for(const room of rooms.values())if(room.players.some(p=>String(p.userId)===String(userId)))return room;return null;}

async function executeAdminCommand(me,text){const parts=text.trim().split(/\s+/);const cmd=parts.shift().toLowerCase();const args=parts.join(' ');if(!isCeoOwner(me))return {ok:false,message:'Comando restrito.'};try{
  if(cmd==='/help')return {ok:true,message:['/help','/paralisaruno [mensagem]','/desparalisaruno','/anuncio [mensagem]','/kick [usuario]','/ban [usuario] [minutos] [motivo]','/unban [usuario]','/mute [usuario] [minutos]','/unmute [usuario]','/darcoins [usuario] [quantidade]','/darxp [usuario] [quantidade]','/removecoins [usuario] [quantidade]','/criar staff [usuario]','/bloqueiochat','/desbloqueiochat','/status','/salas','/fecharsala [codigo]','/evento [mensagem]','/temporada [dias]'].join('\n')};
  if(cmd==='/paralisaruno'){globalState={paused:true,message:cleanText(args||'UNO50 paralisado pelo CEO.',500)};if(usePostgres)await pool.query('UPDATE global_game_state SET paused=true,message=$1,updated_by=$2,updated_at=CURRENT_TIMESTAMP WHERE id=1',[globalState.message,me.id]);io.emit('global:pause',globalState);await logAdmin(me.id,cmd,args);return {ok:true,message:'Jogo paralisado.'};}
  if(cmd==='/desparalisaruno'){globalState={paused:false,message:''};if(usePostgres)await pool.query('UPDATE global_game_state SET paused=false,message=\'\',updated_by=$1,updated_at=CURRENT_TIMESTAMP WHERE id=1',[me.id]);io.emit('global:resume');await logAdmin(me.id,cmd,args);return {ok:true,message:'Jogo liberado.'};}
  if(cmd==='/anuncio'||cmd==='/evento'){const m=cleanText(args,500);if(!m)return {ok:false,message:'Informe uma mensagem.'};io.emit('admin:announcement',{message:m,by:me.username});await logAdmin(me.id,cmd,args);return {ok:true,message:'Mensagem enviada.'};}
  if(cmd==='/status')return {ok:true,message:`Salas: ${rooms.size} | Conectados: ${socketUsers.size} | Paralisado: ${globalState.paused}`};
  if(cmd==='/salas')return {ok:true,message:[...rooms.values()].map(r=>`${r.code} ${r.name} ${r.players.length}/${r.options.maxPlayers}`).join('\n')||'Nenhuma sala.'};
  if(cmd==='/fecharsala'){const code=args.toUpperCase();const room=rooms.get(code);if(!room)return {ok:false,message:'Sala não encontrada.'};io.to(`room:${code}`).emit('room:closed',{message:'Sala fechada pelo CEO.'});rooms.delete(code);io.emit('rooms:update');await logAdmin(me.id,cmd,args);return {ok:true,message:'Sala fechada.'};}
  const targetName=parts[0];let target=null;if(targetName){if(usePostgres){const r=await pool.query('SELECT * FROM users WHERE LOWER(username)=LOWER($1) LIMIT 1',[targetName]);target=r.rows[0]||null;}else{target=localDb().users.find(u=>u.username.toLowerCase()===targetName.toLowerCase())||null;}}
  if(['/kick','/ban','/mute','/unban','/unmute','/darcoins','/darxp','/removecoins'].includes(cmd)&&!target)return {ok:false,message:'Usuário não encontrado.'};
  if(cmd==='/kick'){for(const [sid,u] of socketUsers)if(u.userId===target.id)io.to(sid).emit('admin:kick',{message:'Você foi removido pelo CEO.'});const room=findPlayerRoom(target.id);if(room)removePlayer(room,target.id);await logAdmin(me.id,cmd,args);return {ok:true,message:`${target.username} removido.`};}
  if(cmd==='/ban'||cmd==='/mute'){const mins=Math.min(43200,Math.max(1,Number(parts[1])||60));const reason=cleanText(parts.slice(2).join(' ')||'Moderação CEO.',255);if(usePostgres)await pool.query('INSERT INTO moderation_actions(actor_id,target_id,action,reason,expires_at) VALUES($1,$2,$3,$4,CURRENT_TIMESTAMP + ($5 || \' minutes\')::interval)',[me.id,target.id,cmd==='/ban'?'ban':'mute',reason,mins]);if(cmd==='/ban'){for(const [sid,u] of socketUsers)if(u.userId===target.id)io.to(sid).emit('admin:kick',{message:'Sua conta foi suspensa.'});}await logAdmin(me.id,cmd,args);return {ok:true,message:`${target.username} ${cmd==='/ban'?'banido':'silenciado'} por ${mins} minutos.`};}
  if(cmd==='/unban'||cmd==='/unmute'){if(usePostgres)await pool.query("UPDATE moderation_actions SET expires_at=CURRENT_TIMESTAMP WHERE target_id=$1 AND action=$2 AND (expires_at IS NULL OR expires_at>CURRENT_TIMESTAMP)",[target.id,cmd==='/unban'?'ban':'mute']);await logAdmin(me.id,cmd,args);return {ok:true,message:'Punição encerrada.'};}
  if(cmd==='/darcoins'||cmd==='/darxp'||cmd==='/removecoins'){const qty=Math.floor(Number(parts[1]));if(!Number.isFinite(qty)||qty<=0)return {ok:false,message:'Quantidade inválida.'};const delta=cmd==='/darxp'?qty:-qty;const coinDelta=cmd==='/darcoins'?qty:cmd==='/removecoins'?-qty:0;await addEconomy(target.id,coinDelta,delta);await logAdmin(me.id,cmd,args);return {ok:true,message:'Economia atualizada.'};}
  if(cmd==='/criar'&&parts[0]?.toLowerCase()==='staff'){const name=cleanText(parts[1],24);if(!validUsername(name))return {ok:false,message:'Usuário inválido.'};const pass=crypto.randomBytes(9).toString('base64url');const hash=await bcrypt.hash(pass,12);if(usePostgres){const r=await pool.query("INSERT INTO users(username,password_hash,role,coins,xp,level) VALUES($1,$2,'staff',5000,5000,10) RETURNING username",[name,hash]);return {ok:true,message:`Staff ${r.rows[0].username} criado. Senha temporária: ${pass}`};}return {ok:false,message:'Criação de staff requer PostgreSQL.'};}
  return {ok:false,message:'Comando desconhecido. Use /help.'};
}catch(e){console.error('admin',e);return {ok:false,message:'Falha no comando administrativo.'};}}

app.use((req,res,next)=>{if(req.path.startsWith('/api/')&&!res.headersSent&&req.method==='GET'&&req.path==='/api/unknown')return res.status(404).json({success:false});next();});

process.on('unhandledRejection',err=>{console.error('❌ Unhandled rejection:',err?.stack||err);});
process.on('uncaughtException',err=>{console.error('❌ Uncaught exception:',err?.stack||err);});

server.listen(PORT,'0.0.0.0',()=>{
  console.log(`🚀 UNO50 ativo na porta ${PORT}`);
  databaseReadyPromise=(async()=>{
    const maxAttempts=8;
    for(let attempt=1;attempt<=maxAttempts;attempt++){
      try{
        await initDatabase();
        globalState=await getGlobalState();
        databaseReady=true;
        databaseReadyError=null;
        console.log('✅ Banco de dados pronto para as requisições.');
        return;
      }catch(err){
        databaseReadyError=err;
        console.error(`❌ Falha ao inicializar banco (tentativa ${attempt}/${maxAttempts}):`,err.message);
        if(attempt<maxAttempts) await new Promise(r=>setTimeout(r,Math.min(10000,1500*attempt)));
      }
    }
  })();
});
process.on('SIGTERM',async()=>{try{await pool?.end()}finally{process.exit(0)}});
