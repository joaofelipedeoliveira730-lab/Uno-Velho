const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const API = '/api';
const RESOURCE_VERSION = 'uno50-v3.14-full';
const LOCAL_RESOURCE_STATE = 'uno50.resources.v3.14';

const refs = {
  maps: [
    {id:'map_pirate',name:'Navio Pirata',thumb:'pirate.svg',theme:'pirate',resource:'pirate.svg'},
    {id:'map_saloon',name:'Saloon Clássico',thumb:'saloon.svg',theme:'saloon',resource:'saloon.svg'},
    {id:'map_classroom',name:'Sala de Aula',thumb:'classroom.svg',theme:'classroom',resource:'classroom.svg'},
    {id:'map_geometry',name:'Laboratório Geométrico',thumb:'geometry.svg',theme:'geometry',resource:'geometry.svg'},
    {id:'map_neon_city',name:'Cidade Neon',thumb:'neon.svg',theme:'neon',resource:'neon.svg'},
    {id:'map_forest',name:'Floresta UNO',thumb:'forest.svg',theme:'forest',resource:'forest.svg'},
    {id:'map_desert',name:'Deserto Dourado',thumb:'desert.svg',theme:'desert',resource:'desert.svg'},
    {id:'map_ice',name:'Montanha Congelada',thumb:'ice.svg',theme:'ice',resource:'ice.svg'},
    {id:'map_space',name:'Estação Espacial',thumb:'space.svg',theme:'space',resource:'space.svg'},
    {id:'map_ceo',name:'Dimensão CEO',thumb:'ceo.svg',theme:'ceo',resource:'ceo.svg'}
  ],
  hair: ['hair_basic','hair_curl','hair_long','hair_mohawk','hair_afro','hair_braids','hair_ice','hair_ceo'],
  top: ['shirt_basic','shirt_red','shirt_neon','shirt_gold','shirt_space'],
  bottom: ['pants_basic','pants_black','pants_neon'],
  shoes: ['shoes_basic','shoes_red','shoes_gold'],
  accessory: ['glasses_basic','glasses_cyan','glasses_gold','hat_cap','hat_cowboy','hat_crown','backpack_blue','backpack_space','parrot_shoulder','pirate_compass'],
  effect: ['aura_blue','aura_gold','aura_rainbow'],
  emote: ['emote_wave','emote_fire','emote_dance','emote_cheer'],
  title: ['title_beginner','title_calculator','title_master','title_owner']
};

const state = {
  user:null,
  profile:null,
  token:null,
  items:[],
  inventory:[],
  socket:null,
  currentView:'lobby',
  previousView:'lobby',
  currentRoom:null,
  currentChat:'world',
  pendingCard:null,
  pendingChallenge:null,
  pendingSoloCard:null,
  solo:null,
  settings:null,
  terms:false,
  audio:null,
  musicNode:null,
  muted:false,
  roomToJoin:null,
  shopMode:'official',
  shopCategory:'all',
  inventoryMode:'items',
  selectedPrivateUser:null,
  platform:localStorage.getItem('uno50_platform')||null,
  orientation:localStorage.getItem('uno50_orientation')||null,
  matchmaking:null,
  reportTarget:null,
  exitArmed:false
};

const SOLO_COLORS=['red','yellow','green','blue'];
const SOLO_NAMES={red:'VERMELHO',yellow:'AMARELO',green:'VERDE',blue:'AZUL'};

const SoundFX = {
  ctx:null,
  enabled:true,
  volume:.75,
  init(){try{if(!this.ctx)this.ctx=new(window.AudioContext||window.webkitAudioContext)();if(this.ctx.state==='suspended')this.ctx.resume();}catch{}},
  tone(freq,d=.12,type='sine',gain=.07){if(!this.enabled)return;try{this.init();const o=this.ctx.createOscillator(),g=this.ctx.createGain();o.type=type;o.frequency.value=freq;g.gain.setValueAtTime(Math.max(.001,gain*this.volume),this.ctx.currentTime);g.gain.exponentialRampToValueAtTime(.0001,this.ctx.currentTime+d);o.connect(g);g.connect(this.ctx.destination);o.start();o.stop(this.ctx.currentTime+d);}catch{}},
  card(){this.tone(430,.08,'triangle',.08)},
  click(){this.tone(720,.06,'sine',.05)},
  ok(){this.tone(620,.12);setTimeout(()=>this.tone(880,.18),80)},
  bad(){this.tone(130,.25,'sawtooth',.08)},
  win(){[523,659,783,1046].forEach((f,i)=>setTimeout(()=>this.tone(f,.2),i*110))},
  lose(){[260,200,140].forEach((f,i)=>setTimeout(()=>this.tone(f,.22,'triangle'),i*120))}
};

const BackgroundMusic={audio:null,ctx:null,master:null,timer:null,step:0,enabled:true,volume:.45,started:false,init(){try{if(!this.ctx)this.ctx=new(window.AudioContext||window.webkitAudioContext)();if(this.ctx.state==='suspended')this.ctx.resume();if(!this.master){this.master=this.ctx.createGain();this.master.gain.value=this.volume*.08;this.master.connect(this.ctx.destination);}}catch{}},start(){if(this.started)return; try{if(this.audio){try{this.audio.currentTime=0; const p=this.audio.play(); if(p?.catch)p.catch(()=>{});}catch{}}}catch{} if(this.started)return;this.init();if(!this.ctx||!this.master)return;this.started=true;this.schedule();},schedule(){if(!this.started||!this.ctx)return;const notes=[261.63,329.63,392,523.25,392,329.63,293.66,349.23,440,587.33,440,349.23];const n=notes[this.step%notes.length];const o=this.ctx.createOscillator(),g=this.ctx.createGain();o.type='triangle';o.frequency.value=n;g.gain.setValueAtTime(.0001,this.ctx.currentTime);g.gain.exponentialRampToValueAtTime(.055,this.ctx.currentTime+.025);g.gain.exponentialRampToValueAtTime(.0001,this.ctx.currentTime+.30);o.connect(g);g.connect(this.master);o.start();o.stop(this.ctx.currentTime+.32);this.step++;this.timer=setTimeout(()=>this.schedule(),330);},stop(){this.started=false;if(this.audio){try{this.audio.pause();}catch{}}if(this.timer)clearTimeout(this.timer);this.timer=null;},setEnabled(v){this.enabled=v;if(v)this.start();else this.stop();},setVolume(v){this.volume=Number(v)||0;if(this.master)this.master.gain.value=this.volume*.08;if(this.audio)this.audio.volume=Math.max(0,Math.min(1,this.volume));}};
function startBackgroundMusic(){if(state.profile?.settings?.music!==false){BackgroundMusic.setVolume(state.profile?.settings?.musicVolume??.45);BackgroundMusic.start();}}

function toast(message,type='info',duration=2800){const el=document.createElement('div');el.className=`toast ${type}`;el.innerHTML=`<span>${type==='error'?'⚠️':type==='success'?'✓':'ℹ️'}</span><div>${escapeHtml(message).replace(/\n/g,'<br>')}</div>`;$('#toastContainer').appendChild(el);setTimeout(()=>el.classList.add('out'),duration-350);setTimeout(()=>el.remove(),duration);}
function escapeHtml(v){return String(v??'').replace(/[&<>'"]/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#039;','"':'&quot;'}[m]));}
function show(id){$(id)?.classList.remove('hidden')}
function hide(id){$(id)?.classList.add('hidden')}
function setMessage(id,msg,type='info'){const el=$(id);if(!el)return;el.textContent=msg;el.className=`form-message ${type}`;}
function switchAuthMode(mode){
  const loginForm=$('#formLogin'), registerForm=$('#formRegister');
  const registerBtn=$('#btnShowRegister');
  const isRegister=mode==='register';
  if(!loginForm||!registerForm)return;
  registerForm.style.display=isRegister?'':'none';
  registerForm.setAttribute('aria-hidden',isRegister?'false':'true');
  registerBtn?.setAttribute('aria-expanded',String(isRegister));
  registerBtn?.classList.toggle('active',isRegister);
  if(isRegister){
    $('#regUsername')?.focus();
  }else{
    $('#loginUsername')?.focus();
  }
}
function authHeaders(extra={}){return {...(extra||{})};}
function postJSON(url,body,opts={}){return fetch(API+url,{method:opts.method||'POST',headers:authHeaders({'Content-Type':'application/json',...(opts.headers||{})}),body:body===undefined?undefined:JSON.stringify(body),credentials:'include'}).then(async r=>{let d={};try{d=await r.json()}catch{};if(!r.ok)throw Object.assign(new Error(d.message||`Erro ${r.status} de comunicação com o servidor.`),{data:d,status:r.status});return d;});}
async function getJSON(url){const r=await fetch(API+url,{credentials:'include',headers:authHeaders()});let d={};try{d=await r.json()}catch{};if(!r.ok)throw Object.assign(new Error(d.message||`Erro ${r.status} ao carregar o jogo.`),{data:d,status:r.status});return d;}
async function resourceList(){
  try { const d=await fetch('/manifest.json',{cache:'no-store'}); if(d.ok){const j=await d.json(); if(Array.isArray(j.resources)) return j.resources;} } catch {}
  return ['/','/index.html','/style.css','/app.js','/service-worker.js','/manifest.json','/reference-arena.svg',...refs.maps.map(m=>'/'+m.resource)];
}
async function registerOfflineWorker(){try{if('serviceWorker' in navigator) await navigator.serviceWorker.register('/service-worker.js?v=20260818-3.14',{scope:'/'});}catch(e){console.warn('Service Worker:',e);}}
async function isResourceCached(url){
  try{if(!('caches' in window))return false; const c=await caches.open(RESOURCE_VERSION); return !!(await c.match(url));}catch{return false;}
}
async function ensureResource(url){
  if(await isResourceCached(url)) return true;
  try{const c=await caches.open(RESOURCE_VERSION); await c.add(url); return true;}catch{return false;}
}
async function cacheGameResources(){
  const progress=$('#downloadProgress');
  const urls=await resourceList();
  if(!('caches' in window)){if(progress)progress.textContent='NAVEGADOR SEM CACHE';return false;}
  try{
    const cache=await caches.open(RESOURCE_VERSION); let done=0; let failed=[];
    for(const url of urls){try{const req=new Request(url,{cache:'reload'}); const res=await fetch(req); if(!res.ok)throw new Error(String(res.status)); await cache.put(req,res.clone());}catch(e){failed.push(url);} done++; if(progress)progress.textContent=`${Math.round(done/urls.length*100)}%`;}
    const ok=failed.length===0; if(progress)progress.textContent=ok?'TODOS OS RECURSOS BAIXADOS':'FALTARAM '+failed.length; localStorage.setItem(LOCAL_RESOURCE_STATE,JSON.stringify({version:RESOURCE_VERSION,downloadedAt:Date.now(),total:urls.length,failed})); return ok;
  }catch{if(progress)progress.textContent='ERRO NO DOWNLOAD';return false;}
}
async function verifyAllResources(){const urls=await resourceList(); if(!('caches' in window))return false; for(const u of urls){if(!(await isResourceCached(u)))return false;} return true;}
async function requireMapResource(mapId){const m=refs.maps.find(x=>x.id===mapId);if(!m)return false;const url='/'+m.resource;const ok=await isResourceCached(url)||await ensureResource(url);if(!ok){toast('Não foi possível carregar este mapa. Verifique sua conexão e tente novamente.','error',6000);return false;}return true;}
function showResourceMessage(){toast('Mapa ainda não está disponível neste dispositivo. Baixe os recursos novamente.','error',6000);}


function sanitizeAddressBar(){
  try{
    const u=new URL(window.location.href);
    const sensitive=/(user(name)?|pass(word)?|senha|token|jwt|auth|credential|login)/i;
    let changed=false;
    for(const key of [...u.searchParams.keys()]){if(sensitive.test(key)){u.searchParams.delete(key);changed=true;}}
    if(changed || u.hash){u.hash='';window.history.replaceState({},document.title,u.pathname+(u.searchParams.toString()?`?${u.searchParams}`:''));}
  }catch{}
}

function init(){
  sanitizeAddressBar();
  registerOfflineWorker();
  document.documentElement.style.setProperty('--motion',localStorage.getItem('uv_reduced_motion')==='1'?'0':'1');
  bindStaticEvents();
  setTimeout(async()=>{
    hide('#bootScreen');
    const accepted=localStorage.getItem('uno_terms_accepted')==='1';
    const saved=(()=>{try{return JSON.parse(localStorage.getItem(LOCAL_RESOURCE_STATE)||'{}')}catch{return {}}})();
    if(!accepted){show('#termsModal');return;}
    if(saved.version!==RESOURCE_VERSION) void cacheGameResources();
    await bootAuth();
  },350);
}

const wait=(ms)=>new Promise(r=>setTimeout(r,ms));
async function bootAuth(){
  let lastError=null;
  for(let attempt=0;attempt<3;attempt++){
    try{const d=await getJSON('/me');state.user=d.user;state.profile=d.profile;state.settings=d.profile.settings;await enterApp();return true;}
    catch(err){lastError=err;if(err?.status===503){await wait(800*(attempt+1));continue;}break;}
  }
  show('#authScreen');
  if(lastError?.status===503) setMessage('#loginMessage','Servidor ainda iniciando. Tente novamente em alguns segundos.','error');
  return false;
}

function bindStaticEvents(){
  $('#termsCheck').addEventListener('change',e=>$('#btnAcceptTerms').disabled=!e.target.checked);
  $('#btnAcceptTerms').onclick=async()=>{
    if(!$('#termsCheck').checked)return;
    const btn=$('#btnAcceptTerms');btn.disabled=true;btn.textContent='⏳ BAIXANDO RECURSOS...';
    localStorage.setItem('uno_terms_accepted','1');state.terms=true;
    hide('#termsModal');
    await registerOfflineWorker();
    void cacheGameResources();
    startBackgroundMusic();
    await bootAuth();
  };
  $('#formLogin').onsubmit=login;
  $('#formRegister').onsubmit=register;
  $('#brandHome').onclick=()=>navigate('lobby');
  // Fallback robusto: a seleção da plataforma continua funcionando mesmo se algum bind anterior falhar.
  document.addEventListener('click',e=>{const b=e.target.closest?.('.platform-option');if(b?.dataset?.platform)applyPlatform(b.dataset.platform,b.dataset.orientation,true);});
  $('#btnPlay').onclick=()=>navigate('play');
  $('#btnShop').onclick=()=>openShop('official');
  $('#btnInventory').onclick=()=>openInventory('items');
  $('#btnCustomize').onclick=()=>openCustomize();$('#btnCustomizeHero')?.addEventListener('click',openCustomize);
  $('#btnOpenProfile').onclick=()=>openInventory('items');
  $('#btnOpenSettings').onclick=()=>{navigate('settings');refreshResourceStatus();loadSeasonPanel();}; $('#btnCEO')?.addEventListener('click',openCEO); $('#btnScheduleSeason')?.addEventListener('click',async()=>{const days=Math.min(365,Math.max(1,Number($('#seasonDays')?.value)||30));try{await postJSON('/season/schedule',{days});toast('Cronômetro da temporada atualizado.','success');loadCEOOverview();}catch(e){toast(e.message,'error')}}); $('#btnNextSeason')?.addEventListener('click',async()=>{try{await postJSON('/season/next',{});showSeasonNewAnimation();loadCEOOverview();loadMiniRank();}catch(e){toast(e.message,'error')}}); $('#btnOrientation')?.addEventListener('click',async()=>{try{if(screen.orientation?.lock)await screen.orientation.lock('landscape');toast('Modo paisagem ativado.','success');}catch{toast('O navegador bloqueou a rotação automática. Gire o celular para paisagem.','info',5000)}}); $('#btnCEOFind')?.addEventListener('click',ceoFindPlayer); $('#ceoPauseBtn')?.addEventListener('click',async()=>{try{const paused=!$('#ceoPauseBtn').textContent.includes('RETOMAR');await postJSON('/admin/global/pause',{paused,message:'Partida temporariamente paralisada pelo administrador.'});loadCEOOverview();}catch(e){toast(e.message,'error')}}); $('#ceoSelfCoins')?.addEventListener('click',async()=>{try{await postJSON('/admin/self/clear',{action:'coins'});toast('Ouro do CEO zerado.','success');}catch(e){toast(e.message,'error')}}); $('#ceoSelfInventory')?.addEventListener('click',async()=>{try{await postJSON('/admin/self/clear',{action:'inventory'});state.inventory=(await getJSON('/inventory')).items||[];toast('Inventário do CEO limpo.','success');}catch(e){toast(e.message,'error')}});
  $('#btnRankSmall').onclick=()=>openRank(); $('#btnRankMain')?.addEventListener('click',openRank); $('#btnEvent')?.addEventListener('click',openEvent);
  $('#btnMapsPreview').onclick=openMaps;
  $('#btnSolo').onclick=()=>navigate('solo');
  $('#btnOnline').onclick=()=>openRooms();
  $('#btnQuickDuo')?.addEventListener('click',()=>joinMatchmaking('duo'));
  $('#btnQuickTrio')?.addEventListener('click',()=>joinMatchmaking('trio'));
  $('#btnRank').onclick=()=>openRank();
  $$('.back-btn[data-back]').forEach(b=>b.onclick=()=>navigate(b.dataset.back));
  $$('.close-modal').forEach(b=>b.onclick=()=>hide(`#${b.dataset.close}`));
  $$('.difficulty').forEach(b=>b.onclick=()=>startSolo(b.dataset.difficulty));
  $('#btnRefreshRooms').onclick=loadRooms;
  $('#btnCreateRoom').onclick=()=>{populateRoomMaps();show('#createRoomModal');};
  $('#btnConfirmCreateRoom').onclick=createRoom;
  $('#btnConfirmJoinRoom').onclick=joinSelectedRoom;
  $('#btnStartRoom').onclick=()=>state.socket?.emit('room:start');
  $('#btnLeaveRoom').onclick=leaveRoom;
  $('#roomChatForm').onsubmit=e=>{e.preventDefault();sendChat($('#roomChatInput').value,'room');$('#roomChatInput').value='';};
  $('#gameChatForm').onsubmit=e=>{e.preventDefault();sendChat($('#gameChatInput').value,state.currentChat);$('#gameChatInput').value='';};
  $$('.chat-tab').forEach(b=>b.onclick=()=>switchChat(b.dataset.chat));
  $('#drawStack').onclick=()=>soloOrOnlineDraw();
  $('#btnUno').onclick=callUno;
  $('#btnBackGame').onclick=exitGame;
  $('#btnCancelMatchmaking')?.addEventListener('click',cancelMatchmaking);
  $('#btnSendReport')?.addEventListener('click',sendReport);
  $('#btnSound').onclick=toggleMute;
  $('#btnGameSettings').onclick=()=>navigate('settings');
  $('#btnLogout').onclick=logout; $('#btnShowRegister').onclick=()=>switchAuthMode($('#formRegister')?.style.display==='none'?'register':'login'); $('#btnDownloadResources')?.addEventListener('click',downloadAllResources);
  $$('.shop-tab').forEach(b=>b.onclick=()=>openShop(b.dataset.shop));$$('.shop-category').forEach(b=>b.onclick=()=>{state.shopCategory=b.dataset.shopCat||'all';$$('.shop-category').forEach(x=>x.classList.toggle('active',x===b));renderOfficialShop();});
  $$('.inventory-tab').forEach(b=>b.onclick=()=>openInventory(b.dataset.inv));
  $$('.color-picker button').forEach(b=>b.onclick=()=>chooseColor(b.dataset.color));
  $$('.swatch').forEach(b=>b.onclick=()=>{state.profile.avatar.skinColor=b.dataset.value;renderCharacter('#customCharacter',state.profile.avatar);});
  $('#btnSaveCharacter').onclick=saveCharacter;
  ['setMusic','setMusicVol','setSfx','setSfxVol','setAnimations','setReducedMotion','setWorldChat','setRoomChat','setPrivateChat'].forEach(id=>$( '#'+id)?.addEventListener('change',saveSettingsFromUI));
  $('#setMusicVol')?.addEventListener('input',saveSettingsFromUI);
  $('#setSfxVol')?.addEventListener('input',saveSettingsFromUI);
  window.addEventListener('beforeunload',()=>{try{state.socket?.disconnect()}catch{}});
}

async function login(e){e.preventDefault();const fd=new FormData(e.target);try{setMessage('#loginMessage','Entrando...');const d=await postJSON('/login',{username:fd.get('username'),password:fd.get('password')});state.token=null;state.user=d.user;state.profile=d.profile||{avatar:{},settings:{}};state.settings=state.profile.settings;setMessage('#loginMessage',d.message,'success');await enterApp();}catch(err){setMessage('#loginMessage',err.message,'error');SoundFX.bad();}}
async function register(e){e.preventDefault();const fd=new FormData(e.target);try{setMessage('#registerMessage','Criando conta...');const d=await postJSON('/register',{username:fd.get('regUsername'),password:fd.get('regPassword'),country:fd.get('regCountry')||'BR'});state.token=null;state.user=d.user;state.profile=d.profile||{avatar:{},settings:{}};state.settings=state.profile.settings;setMessage('#registerMessage',d.message,'success');await enterApp(true);}catch(err){setMessage('#registerMessage',err.message,'error');SoundFX.bad();}}

async function enterApp(forceCustomize=false){
  hide('#authScreen');show('#appScreen');
  if(!state.profile)state.profile={avatar:{},settings:{}};
  if(!state.profile.avatar)state.profile.avatar={};
  if(!state.profile.settings)state.profile.settings=defaultClientSettings();
  try{state.items=(await getJSON('/items')).items||[];}catch(e){state.items=[];toast('Catálogo temporariamente indisponível. O jogo continuará funcionando.','error',3500);}
  try{state.inventory=(await getJSON('/inventory')).items||[];}catch(e){state.inventory=[];toast('Inventário ainda não pôde ser carregado.','error',3500);}
  updateUserUI();
  try{if(!window.history.state?.uno50)window.history.pushState({uno50:true,view:'lobby'},'',window.location.pathname);}catch{}
  connectSocket();
  const needsPlatform=!['mobile','desktop'].includes(state.platform)||!['portrait','landscape'].includes(state.orientation);
  navigate('lobby',{replace:true});
  setTimeout(()=>{if(needsPlatform)openPlatformModal(true);},180);
  setTimeout(restoreSession,220);
  renderCharacter('#heroCharacter',state.profile.avatar);renderCharacter('#profileCharacterLarge',state.profile.avatar);renderCharacter('#customCharacter',state.profile.avatar);
  loadMiniRank();renderMapPreview();populateCustomizer();applySettings();
  if(!needsPlatform && (forceCustomize||!state.profile.avatar?.hair))setTimeout(openCustomize,250);
  startBackgroundMusic();
}
function defaultClientSettings(){return {music:true,musicVolume:.45,sfx:true,sfxVolume:.75,animations:true,chatWorld:true,chatRoom:true,chatPrivate:true,reducedMotion:false};}

function updateUserUI(){const u=state.user;if(!u)return;const ceo=isCeoOwnerClient();$('#coinValue').textContent=ceo?'∞':formatNum(u.coins);$('#levelValue').textContent=u.level;$('#heroName').textContent=u.username;$('#winsValue').textContent=u.wins||0;$('#xpValue').textContent=formatNum(u.xp);$('#profileName').textContent=u.username;$('#profileLevel').textContent=u.level;$('#profileWins').textContent=u.wins||0;$('#profileGames').textContent=u.gamesPlayed||0;const prestige=Number(u.prestige||0);$('#accountInfo').innerHTML=`<b>${escapeHtml(u.username)}</b><br>${flagForCountry(u.country)} ${escapeHtml(countryName(u.country))}<br>Cargo: ${escapeHtml(u.role)}<br>🪙 ${ceo?'∞':formatNum(u.coins)} • ⭐ ${formatNum(u.xp)} XP • P${prestige}`;const pct=Math.min(100,Math.max(0,((u.xp-(u.level>1?xpForLevelClient(u.level):0))/Math.max(1,xpForLevelClient(u.level+1)-(u.level>1?xpForLevelClient(u.level):0)))*100));$('#xpBar').style.width=pct+'%';const title=itemName(state.profile?.avatar?.title)||'INICIANTE';$('#btnCEO')?.classList.toggle('hidden',!ceo);$('#profileTitle').textContent=title.toUpperCase();$('#profileTitle').classList.toggle('title-owner',state.profile?.avatar?.title==='title_owner');$('#customNamePreview').textContent=u.username;$('#customTitlePreview').textContent=title.toUpperCase();$('#customTitlePreview').classList.toggle('title-owner',state.profile?.avatar?.title==='title_owner');$('#avatarMiniFace').textContent='🙂';if($('#heroCharacterLabel'))$('#heroCharacterLabel').textContent=u.username;if($('#shopCoinValue'))$('#shopCoinValue').textContent=ceo?'∞':formatNum(u.coins);renderCharacter('#heroCharacterLarge',state.profile?.avatar||{});}
function formatNum(n){return new Intl.NumberFormat('pt-BR').format(Number(n||0));}
function xpForLevelClient(level){return Math.floor(100*Math.pow(Math.max(0,level-1),1.45));}
function itemName(id){return state.items.find(x=>x.id===id)?.name||({title_beginner:'Iniciante',title_calculator:'Mestre das Cartas',title_master:'Lendário',title_owner:'Dono do Jogo'}[id]||id||'');}
function isCeoOwnerClient(){return state.user?.role==='CEO'&&state.user?.username==='CeoVelho';}

function navigate(view,opts={}){
  if(view==='lobby'&&!state.user)return;
  $$('.view').forEach(v=>v.classList.add('hidden'));
  const target=$(`#${view}View`);if(target)target.classList.remove('hidden');
  state.previousView=state.currentView;state.currentView=view;window.scrollTo({top:0,behavior:'smooth'});
  if(!opts.fromPop&&!opts.replace){try{window.history.pushState({uno50:true,view},'',window.location.pathname);}catch{}}
  state.exitArmed=false;
  try{sessionStorage.setItem('uno50_view',view)}catch{}
}

function openPlatformModal(force=false){const modal=$('#platformModal');if(!modal)return;if(!force&&state.platform&&state.orientation)return;show('#platformModal');}
function applyPlatform(platform,orientation,close=true){
  const p=platform==='desktop'?'desktop':'mobile';
  const o=orientation==='landscape'?'landscape':'portrait';
  state.platform=p;state.orientation=o;
  localStorage.setItem('uno50_platform',p);localStorage.setItem('uno50_orientation',o);
  document.body.dataset.platform=p;document.body.dataset.orientation=o;
  document.documentElement.dataset.platform=p;document.documentElement.dataset.orientation=o;
  if(close)hide('#platformModal');
  document.body.classList.remove('platform-selecting');
  if(p==='mobile'&&o==='landscape'&&screen.orientation?.lock)screen.orientation.lock('landscape').catch(()=>{});
  if(p==='mobile'&&o==='portrait'&&screen.orientation?.unlock)try{screen.orientation.unlock();}catch{}
  toast(`Interface: ${p==='mobile'?'Celular':'Computador'} • ${o==='portrait'?'Retrato':'Paisagem'}`,'success',2400);
  if(!state.profile?.avatar?.hair)setTimeout(openCustomize,260);
}

window.addEventListener('popstate',()=>{
  if(!state.user)return;
  if(state.currentView!=='lobby'){navigate('lobby',{fromPop:true});return;}
  if(state.exitArmed){state.exitArmed=false;try{const ref=document.referrer;if(ref&&new URL(ref).origin!==location.origin){location.replace(ref);return;}location.replace('about:blank');}catch{location.replace('about:blank');}return;}
  state.exitArmed=true;toast('Pressione voltar novamente para sair do UNO50.','info',1800);try{window.history.pushState({uno50:true,view:'lobby'},'',window.location.pathname);}catch{}
});
window.addEventListener('beforeunload',()=>{try{state.socket?.disconnect()}catch{}});

function restoreSession(){
  try{
    const savedView=sessionStorage.getItem('uno50_view');
    const savedRoom=JSON.parse(sessionStorage.getItem('uno50_room')||'null');
    if(savedRoom?.code&&state.socket?.connected){
      state.currentRoom={code:String(savedRoom.code).toUpperCase()};
      state.socket.emit('room:rejoin',{roomCode:state.currentRoom.code});
    }else if(savedView&&savedView!=='game'&&savedView!=='room'&&savedView!=='lobby'&&$(`#${savedView}View`)){
      navigate(savedView);
    }
  }catch{}
}

function preserveSessionOnViewportChange(){
  try{
    sessionStorage.setItem('uno50_view',state.currentView||'lobby');
    if(state.currentRoom) sessionStorage.setItem('uno50_room',JSON.stringify({code:state.currentRoom.code}));
  }catch{}
}
window.addEventListener('resize',()=>{preserveSessionOnViewportChange();});
window.addEventListener('orientationchange',()=>{preserveSessionOnViewportChange();setTimeout(()=>{window.dispatchEvent(new Event('resize'));},250);});
document.addEventListener('visibilitychange',()=>{
  if(!document.hidden && state.token){
    if(!state.socket||!state.socket.connected) connectSocket();
    if(state.currentRoom) try{state.socket?.emit('room:rejoin',{roomCode:state.currentRoom.code});}catch{}
  }
});

function connectSocket(){
  if(state.socket?.connected)return;
  state.socket=io({withCredentials:true,auth:state.token?{token:state.token}:{},reconnection:true,reconnectionAttempts:12,reconnectionDelay:800,reconnectionDelayMax:5000,timeout:10000});
  state.socket.on('connect',()=>{toast('Conectado ao servidor online.','success',1800);restoreSession();});
  state.socket.on('connect_error',e=>{const msg=String(e?.message||'erro');if(['server_not_ready','server_unavailable','xhr poll error','timeout'].includes(msg)||/websocket|transport|poll/i.test(msg)){toast('Reconectando ao servidor...','info',2200);}else if(msg==='unauthorized'){toast('Sessão expirada. Entre novamente.','error',3500);}else toast('Conexão online indisponível. Tentando novamente...','error',3000);});
  state.socket.on('rooms:update',()=>{if(state.currentView==='rooms')loadRooms();});
  state.socket.on('matchmaking:status',m=>{if(state.matchmaking&&m.mode===state.matchmaking.mode)$('#matchmakingStatus').textContent=m.message||'Procurando jogadores...';});
  state.socket.on('matchmaking:found',game=>handleMatchmakingFound(game));
  state.socket.on('matchmaking:cancelled',()=>{if(state.matchmaking)cancelMatchmaking();});
  state.socket.on('room:joined',room=>{state.currentRoom=room;renderRoom(room);navigate('room');});
  state.socket.on('room:update',room=>{if(state.currentRoom?.code===room.code){state.currentRoom=room;renderRoom(room);}});
  state.socket.on('room:system',m=>toast(m.message));
  state.socket.on('room:closed',m=>{toast(m.message,'error');state.currentRoom=null;navigate('rooms');});
  state.socket.on('toast',m=>toast(m.message,m.type||'info'));
  state.socket.on('chat:message',renderChatMessage);
  state.socket.on('game:state',renderOnlineGame);
  state.socket.on('game:winner',m=>{SoundFX.win();toast(`🏆 ${m.username} venceu a partida!`,'success',5000);});
  state.socket.on('global:pause',m=>{show('#globalPauseBanner');$('#globalPauseBanner').textContent='⏸ '+m.message;});
  state.socket.on('global:resume',()=>hide('#globalPauseBanner'));
  state.socket.on('admin:announcement',m=>toast(`📢 ${m.by}: ${m.message}`,'success',6500));
  state.socket.on('admin:result',m=>toast(m.message,m.ok?'success':'error',5000)); state.socket.on('season:new',()=>{showSeasonNewAnimation();loadSeasonPanel();loadMiniRank();});
  state.socket.on('admin:kick',m=>{toast(m.message,'error');state.currentRoom=null;exitGame();navigate('lobby');});
}

function renderMapPreview(){const el=$('#mapPreview');if(!el)return;el.innerHTML=refs.maps.slice(0,4).map(m=>`<button class="map-tile map-${m.theme}" style="${m.thumb?`background-image:linear-gradient(180deg,transparent,rgba(2,10,35,.8)),url('${m.thumb}')`:''}" data-map="${m.id}"><b>${escapeHtml(m.name)}</b></button>`).join('');el.querySelectorAll('[data-map]').forEach(b=>b.onclick=async()=>{if(await requireMapResource(b.dataset.map)){openMaps();}});}
function openMaps(){navigate('maps');const el=$('#mapsGrid');if(!el)return;el.innerHTML=refs.maps.map(m=>`<button class="map-card-big map-${m.theme}" data-map="${m.id}"><span>🗺️</span><b>${escapeHtml(m.name)}</b><small>${escapeHtml(m.description||'Mapa do UNO50')}</small></button>`).join('');el.querySelectorAll('[data-map]').forEach(b=>b.onclick=async()=>{if(await requireMapResource(b.dataset.map))toast('Mapa selecionado para as próximas salas.','success');});}
async function loadMiniRank(){try{const d=await getJSON('/rank');$('#miniRank').innerHTML=(d.players||[]).slice(0,5).map((p,i)=>`<div class="rank-mini-row"><span>${i+1}</span><b>${escapeHtml(p.username)}</b><small>${flagForCountry(p.country)} Nível ${p.level} • P${p.prestige} • ${p.online?'ONLINE':'OFFLINE'}</small></div>`).join('')||'<p class="muted">Ranking ainda vazio.</p>';}catch{}}

function populateRoomMaps(){const s=$('#roomMap');s.innerHTML=refs.maps.filter(m=>m.id!=='map_ceo'||isCeoOwnerClient()).map(m=>`<option value="${m.id}">${m.name}</option>`).join('');}
async function openRooms(){navigate('rooms');await loadRooms();}
async function loadRooms(){try{const d=await getJSON('/rooms');const rooms=d.rooms||[];$('#roomsList').innerHTML=rooms.length?rooms.map(r=>`<article class="room-card glass"><div class="room-cover map-${roomTheme(r.options.mapId)}"><span>${r.locked?'🔒':'🌎'}</span></div><div class="room-card-body"><div><b>${escapeHtml(r.name)}</b><small>${escapeHtml(r.ownerName)} • ${r.players.length}/${r.options.maxPlayers} jogadores</small></div><div class="room-tags"><span>${r.locked?'COM SENHA':'ABERTA'}</span><span>${r.options.turnSeconds}s</span><span>${r.options.difficulty}</span></div><button class="btn btn-primary btn-wide join-room" data-code="${r.code}">${r.locked?'🔒 ENTRAR':'ENTRAR'}</button></div></article>`).join(''):'<div class="empty-state glass"><span>🌌</span><b>Nenhuma sala aberta agora.</b><small>Crie a primeira mesa!</small></div>';$$('.join-room').forEach(b=>b.onclick=()=>selectRoom(b.dataset.code));}catch(e){toast(e.message,'error');}}
function roomTheme(id){return refs.maps.find(m=>m.id===id)?.theme||'classroom';}
async function createRoom(){try{if(!(await requireMapResource($('#roomMap').value)))return;const body={name:$('#roomName').value||`Mesa de ${state.user.username}`,password:$('#roomPassword').value,maxPlayers:Number($('#roomMax').value),turnSeconds:Number($('#roomTime').value),difficulty:$('#roomDifficulty').value,botFill:Number($('#roomBots').value),mapId:$('#roomMap').value,startingCards:Number($('#roomCards').value),allowBots:$('#roomAllowBots').checked,specials:$('#roomSpecials').checked,stackDraw:$('#roomStack').checked,chat:$('#roomChat').checked};const d=await postJSON('/rooms',body);hide('#createRoomModal');state.currentRoom=d.room;state.socket.emit('room:join',{code:d.roomCode,password:body.password});}catch(e){toast(e.message,'error');}}
async function selectRoom(code){try{const d=await getJSON('/rooms');const room=(d.rooms||[]).find(r=>r.code===code);if(!room)return;state.roomToJoin=room;$('#joinRoomInfo').innerHTML=`<b>${escapeHtml(room.name)}</b><br>${escapeHtml(room.ownerName)} • ${room.players.length}/${room.options.maxPlayers} • ${room.locked?'🔒 Sala com senha':'🌎 Sala aberta'}`;$('#joinRoomPassword').value='';show('#joinRoomModal');}catch(e){toast(e.message,'error');}}
function joinSelectedRoom(){if(!state.roomToJoin)return;const r=state.roomToJoin;state.socket.emit('room:join',{code:r.code,password:$('#joinRoomPassword').value});hide('#joinRoomModal');}
function renderRoom(room){$('#roomTitle').textContent=room.name;$('#roomCodeBadge').textContent=room.code;$('#roomOptionsText').textContent=`${room.players.length}/${room.options.maxPlayers} jogadores • ${room.options.turnSeconds}s • ${room.options.difficulty} • ${room.options.math?'UNO':''}`;$('#btnStartRoom').style.display=String(room.ownerId)===String(state.user.id)&&!room.started?'inline-flex':'none';$('#roomPlayers').innerHTML=room.players.map((p,i)=>`<div class="room-player ${String(p.userId)===String(room.ownerId)?'host':''}"><div class="player-avatar">🙂</div><div><b>${escapeHtml(p.username)}</b><small>${String(p.userId)===String(room.ownerId)?'👑 Criador':'Jogador'}</small></div><span>${p.connected?'●':'○'}</span></div>`).join('');$('#roomMapBanner').className=`room-map-banner map-${roomTheme(room.options.mapId)}`;$('#roomMapBanner').innerHTML=`<div><span>🗺️ MAPA</span><b>${escapeHtml(refs.maps.find(m=>m.id===room.options.mapId)?.name||room.options.mapId)}</b></div>`;}
function leaveRoom(){if(state.socket)state.socket.emit('room:leave');state.currentRoom=null;navigate('rooms');loadRooms();}

async function startSolo(difficulty){SoundFX.click();state.solo=createSolo(difficulty);const soloMap=refs.maps.find(m=>m.theme===state.solo.mapTheme)||refs.maps[0];if(!(await requireMapResource(soloMap.id))){state.solo=null;return;}navigate('game');$('#arenaShell').className=`arena-shell solo-arena map-${state.solo.mapTheme}`;$('.arena-reference').style.display='block';renderSoloGame();toast(`Modo ${difficulty==='easy'?'Fácil':difficulty==='medium'?'Médio':'Difícil'} iniciado.`,'success');}
function createSolo(difficulty){const deck=createDeck();const player=deck.splice(0,7);const bot=deck.splice(0,7);let top=deck.pop();while(top.color==='black'){deck.unshift(top);top=deck.pop();}return{difficulty,deck,player,bot,discard:top,_discardPile:[],color:top.color,turn:'player',pending:null,botName:difficulty==='hard'?'Professor Caio':difficulty==='medium'?'Dona Lúcia':'Joãozinho',botLabel:'🤖 BOT DE TREINAMENTO',trainingOnly:true,mapTheme:['saloon','neon','geometry'][Math.floor(Math.random()*3)],uno:false,round:1};}
function createDeck(){const d=[];for(const color of SOLO_COLORS){d.push({id:crypto.randomUUID(),color,value:'0',type:'number'});for(let n=1;n<=9;n++)for(let copy=0;copy<2;copy++)d.push({id:crypto.randomUUID(),color,value:String(n),type:'number'});for(let copy=0;copy<2;copy++){d.push({id:crypto.randomUUID(),color,value:'🚫',type:'skip'});d.push({id:crypto.randomUUID(),color,value:'🔄',type:'reverse'});d.push({id:crypto.randomUUID(),color,value:'+2',type:'draw2'});}}for(let i=0;i<4;i++){d.push({id:crypto.randomUUID(),color:'black',value:'🌈',type:'wild'});d.push({id:crypto.randomUUID(),color:'black',value:'+4',type:'draw4'});}return shuffle(d);}
function shuffle(a){for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]];}return a;}
function isPlayable(c,game){if(!c||!game?.discard)return false;if((game.pendingDraw||0)>0){if(!game.stackDraw)return false;if(c.type!=='draw2'&&c.type!=='draw4')return false;}return c.color==='black'||c.color===game.color||c.value===game.discard.value;}
function showTurnNotice(text,isMine){const el=$('#turnStatus');if(!el)return;el.textContent=text;el.classList.toggle('bot',!isMine);el.classList.remove('show');void el.offsetWidth;el.classList.add('show');clearTimeout(window.__unoTurnTimer);window.__unoTurnTimer=setTimeout(()=>el.classList.remove('show'),2050);}
function renderSoloGame(){const g=state.solo;if(!g)return;$('#roundText').textContent='TREINAMENTO';showTurnNotice(g.turn==='player'?'SUA VEZ!':'AGUARDE...',g.turn==='player');$('#discardPile').className=`uno-card card-${g.color} big-card`;$('#discardPile').textContent=g.discard.value;$('#colorIndicator').textContent=SOLO_NAMES[g.color];$('#deckCount').textContent=g.deck.length;$('#opponents').innerHTML=`<div class="opponent-card training-opponent"><div class="opponent-avatar">🤖</div><div><b>${escapeHtml(g.botName)}</b><small>${g.botLabel} • ${g.bot.length} cartas</small></div><div class="mini-hand">${Array.from({length:Math.min(g.bot.length,7)}).map(()=>'<span class="back-mini">UNO</span>').join('')}</div></div>`;$('#playerHand').innerHTML=g.player.map((c,i)=>`<button class="uno-card card-${c.color} hand-card" data-index="${i}"><i>${c.value}</i><span>${c.value}</span><em>${c.type==='number'?'NÚMERO':c.type.toUpperCase()}</em></button>`).join('');$$('#playerHand .hand-card').forEach(b=>b.onclick=()=>attemptSoloCard(Number(b.dataset.index)));}
function attemptSoloCard(i){
  const g=state.solo;
  if(!g||g.turn!=='player')return;
  const card=g.player[i];
  if(!isPlayable(card,g)){SoundFX.bad();toast('Essa carta não combina com a mesa.','error');return;}
  state.pendingSoloCard={index:i,card};
  if(card.color==='black'){
    show('#colorModal');
    return;
  }
  state.pendingSoloCard=null;
  playSoloCard(card);
}
function playSoloCard(card){const g=state.solo;const i=g.player.findIndex(x=>x.id===card.id);if(i<0)return;g.player.splice(i,1);g._discardPile.push(g.discard);g.discard=card;if(card.color==='black'){g.color=card._chosenColor||SOLO_COLORS[Math.floor(Math.random()*4)];toast(`Coringa! Cor escolhida: ${SOLO_NAMES[g.color]}`,'success');delete card._chosenColor;}else g.color=card.color;SoundFX.card();if(card.type==='draw2'){drawFromDeck(g,g.bot,2);toast('Bot comprou +2!');}if(card.type==='draw4'){drawFromDeck(g,g.bot,4);toast('Bot comprou +4!');}if(g.player.length===0){finishSolo(true);return;}if(card.type==='skip'||card.type==='reverse'){renderSoloGame();return;}g.turn='bot';renderSoloGame();setTimeout(botSoloTurn,900);}
function drawFromDeck(g,hand,count){for(let n=0;n<count;n++){if(!g.deck.length)recycleSolo(g);if(g.deck.length)hand.push(g.deck.pop());}}
function recycleSolo(g){const top=g.discard;const pile=[...g._discardPile||[]];if(!pile.length)return;g.deck=shuffle(pile);g._discardPile=[];g.discard=top;}
function soloDraw(){const g=state.solo;if(!g||g.turn!=='player')return;drawFromDeck(g,g.player,1);g.turn='bot';renderSoloGame();setTimeout(botSoloTurn,800);}
function botSoloTurn(){const g=state.solo;if(!g||g.turn!=='bot')return;let candidates=g.bot.filter(c=>isPlayable(c,g));let card;if(g.difficulty==='easy')card=candidates[0];else if(g.difficulty==='medium')card=candidates.sort((a,b)=>cardValue(b)-cardValue(a))[0];else card=candidates.sort((a,b)=>botScore(g,b)-botScore(g,a))[0];if(!card){drawFromDeck(g,g.bot,1);g.turn='player';renderSoloGame();return;}g.bot.splice(g.bot.indexOf(card),1);g._discardPile.push(g.discard);g.discard=card;g.color=card.color==='black'?chooseBotColor(g.bot):card.color;SoundFX.card();if(card.type==='draw2')drawFromDeck(g,g.player,2);if(card.type==='draw4')drawFromDeck(g,g.player,4);if(g.bot.length===0){finishSolo(false);return;}if(card.type==='skip'||card.type==='reverse'){renderSoloGame();setTimeout(botSoloTurn,900);return;}g.turn='player';renderSoloGame();}
function cardValue(c){return c.type==='draw4'?100:c.type==='draw2'?80:c.type==='wild'?70:c.type==='skip'?50:c.type==='reverse'?45:Number(c.value)||0;}
function botScore(g,c){let score=cardValue(c);if(c.color===g.color)score+=20;if(g.player.length<=3&&c.type!=='number')score+=25;return score;}
function chooseBotColor(hand){const counts={red:0,yellow:0,green:0,blue:0};hand.forEach(c=>{if(counts[c.color]!=null)counts[c.color]++;});return Object.entries(counts).sort((a,b)=>b[1]-a[1])[0][0];}
async function finishSolo(win){const g=state.solo;if(!g)return;win?SoundFX.win():SoundFX.lose();const coins=win?100:15;const xp=win?180:50;toast(win?`🏆 Vitória! +${coins} moedas e +${xp} XP.`:`Partida encerrada. +${coins} moedas e +${xp} XP.` ,win?'success':'info',5000);try{const d=await postJSON('/game/solo-finish',{win,coins,xp,difficulty:g.difficulty});if(d.user){state.user=d.user;updateUserUI();}}catch{}setTimeout(()=>{state.solo=null;navigate('lobby');},1200);}
function soloOrOnlineDraw(){if(state.solo){soloDraw();return;}if(state.currentRoom?.started)state.socket?.emit('game:draw');}
function callUno(){if(state.solo){if(state.solo.player.length===1){state.solo.uno=true;SoundFX.ok();toast('📣 UNO!','success');}else toast('Você só pode chamar UNO com uma carta.','error');}else{state.socket?.emit('chat:send',{channel:'room',roomCode:state.currentRoom?.code,body:'📣 UNO!'});SoundFX.ok();}}
function exitGame(){clearInterval(loadingTimer);clearTimeout(startMatchLoading.finishTimer);hide('#matchLoadingOverlay');loadingQueuedGame=null;loadingMatchKey=null;state.solo=null;state.pendingCard=null;state.pendingSoloCard=null;hide('#colorModal');if(state.matchmaking)cancelMatchmaking();const quick=!!state.currentRoom?.quick;if(quick){state.socket?.emit('room:leave');state.currentRoom=null;navigate('lobby');}else navigate(state.currentRoom?'room':'lobby');}
function toggleMute(){state.muted=!state.muted;SoundFX.enabled=!state.muted&&state.settings?.sfx!==false;$('#btnSound').textContent=state.muted?'🔇':'🔊';}

let matchmakingTimer=null;
function joinMatchmaking(mode){
  if(!state.socket?.connected){toast('Conectando ao servidor... tente novamente em alguns segundos.','error');return;}
  if(state.matchmaking)return;
  state.matchmaking={mode,startedAt:Date.now()};show('#matchmakingOverlay');$('#matchmakingModeLabel').textContent=mode==='duo'?'DUO • BUSCANDO':'TRIO • BUSCANDO';$('#matchmakingStatus').textContent='Encontrando jogadores reais primeiro. Se demorar, a mesa será preenchida sem revelar identidades artificiais.';renderCharacter('#matchmakingCharacter',state.profile?.avatar||{});let fake=0;
  clearInterval(matchmakingTimer);matchmakingTimer=setInterval(()=>{const elapsed=Math.floor((Date.now()-state.matchmaking.startedAt)/1000);if(elapsed<=20){$('#matchmakingSeconds').textContent=`${elapsed}s`;}else{fake=Math.floor(Math.random()*99)+1;$('#matchmakingSeconds').textContent=`${fake}s`;}$(`#matchmakingTitle`).textContent=elapsed<20?'Procurando jogadores...':'Ajustando a mesa...';},250);
  state.socket.emit('matchmaking:join',{mode});
}
function cancelMatchmaking(){if(!state.matchmaking)return;try{state.socket?.emit('matchmaking:cancel');}catch{}clearInterval(matchmakingTimer);matchmakingTimer=null;state.matchmaking=null;hide('#matchmakingOverlay');toast('Busca cancelada. Voltando ao menu.','info',1800);navigate('play');}
function handleMatchmakingFound(game){clearInterval(matchmakingTimer);matchmakingTimer=null;state.matchmaking=null;hide('#matchmakingOverlay');startMatchLoading(game);}

let loadingMatchKey=null;
let loadingTimer=null;
let loadingQueuedGame=null;
function renderLoadingPlayers(game){
  const el=$('#loadingPlayers'); if(!el)return;
  const players=game.players||[];
  // Regra sagrada: em partidas reais nunca revelamos se um participante é bot.
  // O cliente recebe somente uma identidade pública igual à de qualquer jogador.
  el.innerHTML=players.map((p,i)=>`<div class="loading-player"><div class="loading-avatar" data-load-avatar="${i}"></div><div><b>${escapeHtml(p.username)}</b><small>🌐 JOGADOR • NÍVEL ${Number(p.level||1)}</small></div><span class="loading-prestige">P${Math.min(5,Number(p.prestige||0))}</span></div>`).join('');
  players.forEach((p,i)=>{const a=p.avatar||{};renderCharacter($(`[data-load-avatar="${i}"]`),a);});
}
function startMatchLoading(game){
  const overlay=$('#matchLoadingOverlay'); if(!overlay)return false;
  loadingQueuedGame=game;
  clearInterval(loadingTimer); clearTimeout(startMatchLoading.finishTimer);
  show('#matchLoadingOverlay');
  $('#loadingTitle').textContent=game.players?.length>2?'SEU TIME ESTÁ PRONTO':'SEU OPONENTE ESTÁ PRONTO';
  renderLoadingPlayers(game);
  renderCharacter('#loadingCharacter',state.profile?.avatar||{});
  let pct=0;
  $('#loadingPercent').textContent='0%'; $('#loadingBar').style.width='0%';
  loadingTimer=setInterval(()=>{pct=Math.min(100,pct+10);$('#loadingPercent').textContent=`${pct}%`;$('#loadingBar').style.width=`${pct}%`;if(pct>=100){clearInterval(loadingTimer);loadingTimer=null;}},1000);
  startMatchLoading.finishTimer=setTimeout(()=>{hide('#matchLoadingOverlay');const next=loadingQueuedGame;loadingQueuedGame=null;loadingMatchKey=next?.matchId||`${next?.code}:${next?.startedAt}`;renderOnlineGame(next,true);startShuffleDealAnimation();},10000);
  return true;
}
function startShuffleDealAnimation(){
  const arena=$('#arenaShell'); if(!arena)return;
  arena.classList.remove('shuffle-deal'); void arena.offsetWidth; arena.classList.add('shuffle-deal');
  setTimeout(()=>arena.classList.remove('shuffle-deal'),2200);
}
function cardLabel(c){if(!c)return '—';const map={number:c.value,skip:'🚫',reverse:'🔄',draw2:'+2',wild:'🌈',draw4:'+4'};return map[c.type]??String(c.value??'—');}
function cardKind(c){return c?.type==='number'?'NÚMERO':(c?.type||'CARTA').toUpperCase();}
function renderOnlineGame(game,fromLoading=false){
  if(!game)return;
  state.currentRoom={code:game.code,options:{stackDraw:false},started:true,quick:!!game.quickMatch};
  const key=game.matchId||`${game.code}:${game.startedAt}`;
  if(!fromLoading && loadingMatchKey!==key){loadingMatchKey=key;startMatchLoading(game);return;}
  navigate('game');
  $('#arenaShell').className=`arena-shell online-arena map-${roomTheme(game.mapId)}`;
  $('#roundText').textContent='ONLINE';
  const mine=String(game.currentPlayerId)===String(state.user.id);
  showTurnNotice(mine?'SUA VEZ!':'VEZ DO OPONENTE',mine);
  $('#discardPile').className=`uno-card card-${game.currentColor||'red'} big-card`;
  $('#discardPile').textContent=cardLabel(game.top);
  $('#colorIndicator').textContent=SOLO_NAMES[game.currentColor]||'COR ATIVA';
  $('#deckCount').textContent=Number(game.deckCount||0);
  $('#playerHand').innerHTML=(game.hand||[]).map((c,i)=>`<button class="uno-card card-${c.color||'black'} hand-card" data-index="${i}"><i>${escapeHtml(cardLabel(c))}</i><span>${escapeHtml(cardLabel(c))}</span><em>${cardKind(c)}</em></button>`).join('');
  $$('#playerHand .hand-card').forEach((b,i)=>b.onclick=()=>{const c=game.hand[i];if(!mine)return toast('Aguarde sua vez.');if(!c)return;if(!isPlayable(c,{color:game.currentColor,discard:game.top,pendingDraw:game.pendingDraw,stackDraw:state.currentRoom?.options?.stackDraw===true}))return toast('Essa carta não pode ser jogada agora.','error');state.pendingCard={...c,cardId:c.id};if(c.color==='black'||c.type==='wild'||c.type==='draw4'){show('#colorModal');}else{state.socket.emit('game:play',{cardId:c.id});state.pendingCard=null;}});
  $('#opponents').innerHTML=game.players.filter(p=>String(p.userId)!==String(state.user.id)).map(p=>`<div class="opponent-card ${String(p.userId)===String(game.currentPlayerId)?'active':''}" data-player-id="${escapeHtml(p.userId)}"><div class="opponent-avatar character-stage opponent-character" data-opponent-avatar="${escapeHtml(p.userId)}"></div><div><b>${escapeHtml(p.username)}</b><small>${p.cardCount} cartas • NÍVEL ${Number(p.level||1)} • P${Math.min(5,Number(p.prestige||0))}</small></div><button class="report-player-btn" type="button" data-report-player="${escapeHtml(p.userId)}" data-report-name="${escapeHtml(p.username)}">🚨</button><div class="mini-hand">${Array.from({length:Math.min(p.cardCount,7)}).map(()=>'<span class="back-mini">UNO</span>').join('')}</div></div>`).join('');
  game.players.filter(p=>String(p.userId)!==String(state.user.id)).forEach(p=>{const node=$$('.opponent-character').find(x=>x.dataset.opponentAvatar===String(p.userId));renderCharacter(node,p.avatar||{});});
  renderCharacter('#gameAvatar',state.profile.avatar);$('#gamePlayerName').textContent=state.user.username;$('#gamePlayerTitle').textContent=itemName(state.profile.avatar.title).toUpperCase();
}

function chooseColor(color){
  hide('#colorModal');
  if(state.pendingSoloCard){
    const card=state.pendingSoloCard.card;
    state.pendingSoloCard=null;
    if(state.solo&&state.solo.turn==='player'){card._chosenColor=color;playSoloCard(card);}
    return;
  }
  if(state.pendingCard&&state.socket){
    state.socket.emit('game:play',{cardId:state.pendingCard.cardId||state.pendingCard.id,chosenColor:color});
    state.pendingCard=null;
  }
}

function sendChat(body,channel='world'){const text=String(body||'').trim();if(!text)return;state.socket?.emit('chat:send',{channel,body:text,roomCode:state.currentRoom?.code,receiverId:state.selectedPrivateUser});}
function switchChat(ch){state.currentChat=ch;$$('.chat-tab').forEach(b=>b.classList.toggle('active',b.dataset.chat===ch));$('#gameChatMessages').innerHTML='';$('#gameChatInput').placeholder=ch==='private'?'Mensagem privada...':'Mensagem...';}
function renderChatMessage(m){if(m.channel==='room'&&state.currentRoom?.code!==m.roomCode)return;if(m.channel==='private'&&Number(m.senderId)!==Number(state.selectedPrivateUser)&&Number(m.receiverId)!==Number(state.user.id))return;const targets=[$('#roomChatMessages'),$('#gameChatMessages')];targets.forEach(box=>{if(!box)return;const item=document.createElement('div');item.className=`chat-line ${Number(m.senderId)===Number(state.user.id)?'mine':''}`;item.innerHTML=`<b>${escapeHtml(m.senderName)}</b><span>${escapeHtml(m.body)}</span>`;box.appendChild(item);box.scrollTop=box.scrollHeight;});}

async function openShop(mode='official'){state.shopMode=mode;navigate('shop');$$('.shop-tab').forEach(b=>b.classList.toggle('active',b.dataset.shop===mode));const catBar=$('#shopCategoryBar');if(catBar)catBar.classList.toggle('hidden',mode!=='official');try{if(mode==='market'){const d=await getJSON('/shop/market');renderMarket(d.listings||[]);}else{renderOfficialShop();}}catch(e){toast(e.message,'error');}}
function shopCategoryOf(i){const id=String(i.id||'').toLowerCase(),cat=String(i.category||'').toLowerCase();if(cat==='clothing'||cat==='hair'||cat==='effect'||cat==='emote'||cat==='title')return cat;if(cat==='accessory'&&id.startsWith('hat_'))return 'hat';if(cat==='accessory')return 'accessory';return 'all';}
function itemCard(item,owned){
  const id=String(item.id||'');
  const crown=id==='event_pharaoh_crown';
  const price=Number(item.price||0);
  const exclusive=Boolean(item.asset?.eventExclusive||item.asset?.ceoOnly);
  const priceLabel=isCeoOwnerClient()?'∞':(price>0?formatNum(price):'EVENTO');
  const visual=crown?'<img class="shop-crown-art" src="/pharaoh-crown.svg" alt="Coroa do Faraó">':`<div class="shop-glyph">${escapeHtml(String(item.name||'ITEM').slice(0,2).toUpperCase())}</div>`;
  return `<article class="item-card glass ${owned?'owned':''}">
    <div class="item-visual shop-preview-wrap">${visual}<div class="shop-item-badge">${exclusive?'EXCLUSIVO':String(item.rarity||'COMUM').toUpperCase()}</div><div class="shop-character-preview" data-shop-preview="${escapeHtml(id)}"></div></div>
    <div class="item-info"><div><b>${escapeHtml(item.name||id)}</b><small>${escapeHtml(item.description||'Item do UNO50')}</small></div><strong>${owned?'ADQUIRIDO':priceLabel}</strong></div>
    ${owned?'<button class="btn btn-secondary btn-wide" disabled>NO INVENTÁRIO</button>':(exclusive&&id.startsWith('event_')?'<button class="btn btn-secondary btn-wide" disabled>RECOMPENSA DO EVENTO</button>':`<button class="btn btn-primary btn-wide buy-item" data-id="${escapeHtml(id)}">COMPRAR</button>`)}
  </article>`;
}
async function buyItem(itemId){
  const item=state.items.find(x=>String(x.id)===String(itemId));
  if(!item)return toast('Item não encontrado.','error');
  if(item.asset?.eventExclusive)return toast('Esse item é exclusivo do Evento Egito Antigo.','info');
  try{const d=await postJSON('/shop/buy',{itemId});state.inventory=(await getJSON('/inventory')).items||[];state.user=(await getJSON('/me')).user;updateUserUI();populateCustomizer();renderOfficialShop();toast(d.message||'Item comprado!','success');}
  catch(e){toast(e.message||'Não foi possível comprar o item.','error',4500);}
}
function renderOfficialShop(){const owned=new Set(state.inventory.map(x=>x.id));let list=state.items.filter(i=>i.is_active!==false&&(!i.asset?.ceoOnly||isCeoOwnerClient())&&(isCeoOwnerClient()||Number(i.price||0)>=200));if(state.shopCategory!=='all')list=list.filter(i=>shopCategoryOf(i)===state.shopCategory);$('#shopGrid').innerHTML=list.length?list.map(item=>itemCard(item,owned.has(item.id))).join(''):'<div class="empty-state glass"><span>✨</span><b>Nenhum item nessa seção.</b><small>Volte para Tudo ou escolha outra categoria.</small></div>';$$('.shop-character-preview').forEach(el=>{const a={...state.profile.avatar};const id=el.dataset.shopPreview;const item=state.items.find(x=>x.id===id);if(item){if(item.category==='accessory')a.accessory=id;else if(item.category==='hair')a.hair=id;else if(item.category==='clothing'){if(id.startsWith('shirt_'))a.top=id;else if(id.startsWith('pants_'))a.bottom=id;else if(id.startsWith('shoes_'))a.shoes=id;}else if(item.category==='effect')a.effect=id;else if(item.category==='emote')a.emote=id;else if(item.category==='title')a.title=id;}renderCharacter(el,a);});$$('.buy-item').forEach(b=>b.onclick=()=>buyItem(b.dataset.id));}
function populateCustomizer(){const categories={hair:'#customHair',top:'#customTop',bottom:'#customBottom',shoes:'#customShoes',accessory:'#customAccessory',effect:'#customEffect',emote:'#customEmote',title:'#customTitle'};for(const [cat,sel] of Object.entries(categories)){const el=$(sel);if(!el)continue;const allowed=new Set(state.inventory.map(i=>i.id));const ids=refs[cat]||[];const opts=ids.filter(id=>allowed.has(id)||isCeoOwnerClient()).map(id=>({id,name:itemName(id)}));el.innerHTML=opts.map(o=>`<option value="${o.id}">${escapeHtml(o.name)}</option>`).join('')||'<option value="">Nenhum item disponível</option>';const current=state.profile.avatar[cat];el.value=(current&&opts.some(o=>o.id===current))?current:(opts[0]?.id||'');el.onchange=()=>{state.profile.avatar[cat]=el.value||null;renderCharacter('#customCharacter',state.profile.avatar);};}$('#customEyes').value=state.profile.avatar.eyes||'#1d2433';$('#customHairColor').value=state.profile.avatar.hairColor||'#171717';$('#customEyes').onchange=e=>{state.profile.avatar.eyes=e.target.value;renderCharacter('#customCharacter',state.profile.avatar)};$('#customHairColor').onchange=e=>{state.profile.avatar.hairColor=e.target.value;renderCharacter('#customCharacter',state.profile.avatar)};}
function openCustomize(){populateCustomizer();show('#customizeModal');renderCharacter('#customCharacter',state.profile.avatar);}
async function saveCharacter(){try{const d=await postJSON('/profile',{avatar:state.profile.avatar,settings:state.profile.settings,bio:state.profile.bio||''},{method:'PUT'});state.profile=d.profile;hide('#customizeModal');renderCharacter('#heroCharacter',state.profile.avatar);renderCharacter('#heroCharacterLarge',state.profile.avatar);renderCharacter('#profileCharacterLarge',state.profile.avatar);toast('Personagem salvo!','success');}catch(e){toast(e.message,'error');}}
async function saveSettingsFromUI(){if(!state.profile)return;state.profile.settings={music:$('#setMusic').checked,musicVolume:Number($('#setMusicVol').value),sfx:$('#setSfx').checked,sfxVolume:Number($('#setSfxVol').value),animations:$('#setAnimations').checked,reducedMotion:$('#setReducedMotion').checked,chatWorld:$('#setWorldChat').checked,chatRoom:$('#setRoomChat').checked,chatPrivate:$('#setPrivateChat').checked};SoundFX.enabled=state.profile.settings.sfx;SoundFX.volume=state.profile.settings.sfxVolume;BackgroundMusic.setVolume(state.profile.settings.musicVolume);BackgroundMusic.setEnabled(state.profile.settings.music);localStorage.setItem('uv_reduced_motion',state.profile.settings.reducedMotion?'1':'0'); localStorage.setItem('uv_audio_settings',JSON.stringify({music:state.profile.settings.music,musicVolume:state.profile.settings.musicVolume,sfx:state.profile.settings.sfx,sfxVolume:state.profile.settings.sfxVolume}));document.documentElement.style.setProperty('--motion',state.profile.settings.reducedMotion?'0':'1');try{const d=await postJSON('/profile',{avatar:state.profile.avatar,settings:state.profile.settings,bio:state.profile.bio||''},{method:'PUT'});state.profile=d.profile;}catch{}}
function applySettings(){const s=state.profile.settings||defaultClientSettings();state.settings=s;$('#setMusic').checked=s.music;$('#setMusicVol').value=s.musicVolume;$('#setSfx').checked=s.sfx;$('#setSfxVol').value=s.sfxVolume;$('#setAnimations').checked=s.animations;$('#setReducedMotion').checked=s.reducedMotion;$('#setWorldChat').checked=s.chatWorld;$('#setRoomChat').checked=s.chatRoom;$('#setPrivateChat').checked=s.chatPrivate;SoundFX.enabled=s.sfx;SoundFX.volume=s.sfxVolume;}

function renderCharacter(selector,a){const el=typeof selector==='string'?$(selector):selector;if(!el||!a)return;const hair=a.hair||'hair_basic';const hairColor=a.hairColor||'#171717';const eventVisual=({event_pharaoh_crown:'event_pharaoh_crown',event_crown_40:'event_crown_40',event_scarab_10:'event_scarab_10',event_necklace_30:'event_necklace_30',event_anubis_mask:'event_anubis_mask',event_eye_ra:'event_eye_ra'}[a.accessory]||a.accessory||'');el.innerHTML=`<div class="char-aura ${a.effect||''}"></div><div class="char-body" style="--skin:${a.skinColor||'#d59b76'};--eyes:${a.eyes||'#1d2433'}"><div class="char-head"><div class="char-hair ${hair}" style="--hair:${hairColor}"></div><div class="char-eye left"></div><div class="char-eye right"></div><div class="char-mouth"></div></div><div class="char-torso ${a.top||'shirt_basic'}"></div><div class="char-bottom ${a.bottom||'pants_basic'}"></div><div class="char-shoes ${a.shoes||'shoes_basic'}"></div><div class="char-accessory ${eventVisual}"></div></div>`;}

async function openCEO(){if(!isCeoOwnerClient()){toast('Acesso restrito.','error');return;}navigate('ceo');await loadCEOOverview();}
async function loadCEOOverview(){try{const d=await getJSON('/admin/overview');$('#ceoSeasonInfo').textContent=`Temporada ${d.season.seasonNumber} • ${d.season.status} • termina em ${new Date(d.season.endsAt).toLocaleString('pt-BR')}`;$('#ceoPauseBtn').textContent=d.paused.paused?'▶️ RETOMAR JOGO':'⏸️ PARALISAR JOGO';$('#btnNextSeason')?.classList.toggle('hidden',!d.season.canNext);$('#ceoRooms').innerHTML=(d.rooms||[]).map(r=>`<div class="ceo-row"><div><b>${escapeHtml(r.name)}</b><small>${escapeHtml(r.code)} • ${r.players.length} jogadores</small><span>${r.players.map(escapeHtml).join(' • ')||'Sem jogadores'}</span></div><button class="btn btn-danger ceo-stop-room" data-code="${escapeHtml(r.code)}">PARALISAR PARTIDA</button></div>`).join('')||'<div class="empty-state">Nenhuma partida ativa.</div>';$('#ceoReports').innerHTML=(d.reports||[]).map(r=>`<div class="ceo-row"><div><b>#${r.id} • ${escapeHtml(r.target)}</b><small>por ${escapeHtml(r.reporter)} • ${new Date(r.created_at).toLocaleString('pt-BR')}</small><span>${escapeHtml(r.reason)}</span></div><button class="btn btn-secondary ceo-resolve" data-id="${r.id}">RESOLVER</button></div>`).join('')||'<div class="empty-state">Nenhuma denúncia aberta.</div>';}catch(e){toast(e.message,'error');}}
async function ceoFindPlayer(){const name=$('#ceoPlayerName').value.trim();if(!name)return toast('Digite o nome do jogador.','error');try{const d=await getJSON('/admin/player?username='+encodeURIComponent(name));const p=d.player;$('#ceoPlayerResult').innerHTML=`<div class="ceo-player-card"><b>${escapeHtml(p.username)} ${flagForCountry(p.country)}</b><small>Nível ${p.level} • P${Math.min(5,Number(p.prestige||0))} • ${p.gamesPlayed} partidas • ${p.wins} vitórias</small><span>🪙 ${formatNum(p.coins)} • ⭐ ${formatNum(p.xp)} XP</span><div class="ceo-actions"><button data-ceo-action="clear_inventory">🧹 Limpar inventário</button><button data-ceo-action="clear_xp">⭐ Zerar XP</button><button data-ceo-action="clear_coins">🪙 Zerar ouro</button><button data-ceo-action="set_rank">🏆 Alterar posição no Rank</button><button data-ceo-action="clear_rank">↩️ Remover posição manual</button><button data-ceo-action="ban">⛔ Banir</button><button data-ceo-action="suspend">⏸️ Suspender com motivo</button></div></div>`;const h=p.history||[];const r=p.reports||[];$('#ceoPlayerHistory').innerHTML=`<div class="ceo-history-grid">${h.length?h.map(x=>`<div class="ceo-history-row"><span>${escapeHtml(String(x.mode||'ONLINE').toUpperCase())}</span><small>${new Date(x.started_at).toLocaleString('pt-BR')}</small><small>${escapeHtml(x.result||'playing')} • +${Number(x.xp_earned||0)} XP</small></div>`).join(''):'<div class="empty-state">Sem partidas registradas.</div>'}</div>${r.length?`<div class="ceo-report-history"><b>🚨 Histórico de denúncias: ${r.length}</b>${r.slice(0,10).map(x=>`<div><small>#${x.id} • ${escapeHtml(x.status)} • ${escapeHtml(x.reporter)} • ${new Date(x.created_at).toLocaleString('pt-BR')}</small><br>${escapeHtml(x.reason)}</div>`).join('')}</div>`:''}`;window.__ceoTarget=p;}catch(e){toast(e.message,'error');}}
async function ceoPlayerAction(action){const p=window.__ceoTarget;if(!p)return;let body={userId:p.id,action};if(action==='ban'||action==='suspend'){body.minutes=Number(prompt('Duração em minutos:','60')||60);body.reason=prompt('Mensagem/motivo para o jogador:','Ação administrativa.')||'Ação administrativa.';}if(action==='set_rank'){const rank=Number(prompt('Nova posição no Rank mundial (1 a 1000):','10')||10);body.rank=rank;}try{const d=await postJSON('/admin/player/action',body);toast(d.message,'success');await ceoFindPlayer();loadCEOOverview();}catch(e){toast(e.message,'error');}}
async function openRank(){
  navigate('rank');
  try{
    const d=await getJSON('/rank');
    $('#rankSeasonLabel').textContent=`TEMPORADA ${d.season?.seasonNumber||1}`;
    $('#rankUpdated').textContent=`Atualizado ${new Date().toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})}`;
    const players=(d.players||[]).slice(0,10);
    const top=$('#rankTop10');
    top.innerHTML=players.map((p,i)=>`<article class="rank-player-card ${i<3?'rank-podium':''}">
      <div class="rank-position">${i<3?['🥇','🥈','🥉'][i]:`#${i+1}`}</div>
      <div class="rank-character-wrap"><div class="character-stage rank-character" data-rank-avatar="${i}"></div></div>
      <div class="rank-photo"><div class="character-stage mini" data-rank-photo="${i}"></div></div>
      <div class="rank-main-info"><div class="rank-name-line"><b>${escapeHtml(p.username)}</b><span class="country-flag" title="${escapeHtml(countryName(p.country))}">${flagForCountry(p.country)}</span></div>
      <div class="rank-badges"><span class="status-dot ${p.online?'online':'offline'}"></span>${p.online?'ONLINE':'OFFLINE'}<span class="prestige-badge p${p.prestige}">P${p.prestige}</span><span>NÍVEL ${p.level}</span></div>
      <div class="rank-metrics"><span>⭐ ${formatNum(p.xp)} XP</span><span>🪙 ${formatNum(p.coins)}</span><span>🏆 ${formatNum(p.wins)} vitórias</span><span>📊 ${Number(p.winRate||0).toFixed(1)}%</span></div></div>
    </article>`).join('')||'<div class="empty-state">Nenhum jogador no ranking ainda.</div>';
    players.forEach((p,i)=>{const a={...p.avatar};renderCharacter($(`[data-rank-avatar="${i}"]`),a);renderCharacter($(`[data-rank-photo="${i}"]`),a);});
  }catch(e){toast(e.message,'error');}
}
function flagForCountry(code){const c=String(code||'BR').toUpperCase();if(c==='OTHER')return '🌎';if(c.length!==2)return '🌎';return String.fromCodePoint(...[...c].map(ch=>127397+ch.charCodeAt(0)));}
function countryName(code){return ({BR:'Brasil',PT:'Portugal',US:'Estados Unidos',AR:'Argentina',CL:'Chile',CO:'Colômbia',MX:'México',ES:'Espanha',FR:'França',DE:'Alemanha',IT:'Itália',GB:'Reino Unido',JP:'Japão',KR:'Coreia do Sul',IN:'Índia',CA:'Canadá',AU:'Austrália',OTHER:'Outro'})[String(code||'BR').toUpperCase()]||'Outro';}
async function loadSeasonPanel(){
  const box=$('#ceoSeasonPanel'); if(!box)return;
  if(!isCeoOwnerClient()){box.classList.add('hidden');return;}
  box.classList.remove('hidden');
  try{const d=await getJSON('/season');const x=d.season; $('#seasonNumber').textContent=x.seasonNumber; const end=new Date(x.endsAt); const update=()=>{const ms=end-Date.now(); if(ms<=0){$('#seasonCountdown').textContent='TEMPORADA ENCERRADA';show('#btnNextSeason');}else{$('#seasonCountdown').textContent=formatDuration(ms);hide('#btnNextSeason');}};update();clearInterval(loadSeasonPanel.timer);loadSeasonPanel.timer=setInterval(update,1000);$('#btnScheduleSeason').onclick=async()=>{const days=Number($('#seasonDays').value);try{const r=await postJSON('/season/schedule',{days});$('#seasonCountdown').textContent=formatDuration(new Date(r.season.endsAt)-Date.now());toast('Cronômetro da temporada atualizado.','success');}catch(e){toast(e.message,'error')}};$('#btnNextSeason').onclick=async()=>{try{await postJSON('/season/next',{});showSeasonNewAnimation();loadSeasonPanel();loadMiniRank();}catch(e){toast(e.message,'error')}};}catch(e){toast(e.message,'error')}}
function formatDuration(ms){let s=Math.max(0,Math.floor(ms/1000));const d=Math.floor(s/86400);s%=86400;const h=Math.floor(s/3600);s%=3600;const m=Math.floor(s/60);s%=60;return `${d}d ${String(h).padStart(2,'0')}h ${String(m).padStart(2,'0')}m ${String(s).padStart(2,'0')}s`;}
function showSeasonNewAnimation(){const el=$('#seasonNewOverlay');if(!el)return;el.classList.remove('hidden');setTimeout(()=>el.classList.add('hidden'),4200);}

async function openEvent(){
  navigate('event');
  try{
    const d=await getJSON('/event/egypt');
    $('#eventLevelLabel').textContent=`NÍVEL ${d.level}`;
    $('#eventXpLabel').textContent=`${d.progressXp} / 100 XP`;
    $('#eventXpBar').style.width=`${d.progressPercent}%`;
    $('#eventPrestigeLabel').textContent=`PRESTÍGIO ${Number(state.user?.prestige||0)}`;
    $('#eventStatusLabel').textContent=d.level>=100?'PASSE COMPLETO':'Continue jogando para liberar recompensas';
    $('#eventRewards').innerHTML=(d.rewards||[]).map(r=>`<article class="event-reward glass ${r.unlocked?'unlocked':'locked'}"><div class="event-reward-visual ${r.id==='event_pharaoh_crown'?'pharaoh-crown':''}">${r.id==='event_pharaoh_crown'?'<img class="pharaoh-crown-art" src="/pharaoh-crown.svg" alt="Coroa do Faraó">':'<span class="event-reward-glyph">EGITO</span>'}</div><div><span>NÍVEL ${r.level}</span><b>${escapeHtml(r.name)}</b><small>${escapeHtml(r.description)}</small></div><strong>${r.unlocked?'DESBLOQUEADO':'BLOQUEADO'}</strong></article>`).join('');
    if(d.claimed?.length) toast(`🏺 ${d.claimed.length} recompensa(s) do evento adicionada(s) ao inventário!`,'success',3500);
    state.inventory=(await getJSON('/inventory')).items||[];populateCustomizer();
  }catch(e){toast(e.message,'error');}
}

async function logout(){try{await postJSON('/logout',undefined);}catch{}try{state.socket?.disconnect()}catch{}state.user=null;state.profile=null;state.token=null;state.currentRoom=null;try{sessionStorage.clear();localStorage.removeItem('uv_last_user');localStorage.removeItem('uno50_view');localStorage.removeItem('uno50_room');if('caches' in window){const keys=await caches.keys();await Promise.all(keys.map(k=>caches.delete(k)));}}catch{}BackgroundMusic.stop();$$('.view').forEach(v=>v.classList.add('hidden'));hide('#appScreen');show('#authScreen');switchAuthMode('login');$('#loginPassword').value='';$('#loginUsername').value='';window.history.replaceState({},document.title,'/');window.scrollTo(0,0);toast('Você saiu da conta.','success');}


async function refreshResourceStatus(){const el=$('#resourceStatus');if(!el)return;const ok=await verifyAllResources();el.textContent=ok?'✅ Todos os recursos estão salvos neste dispositivo.':'⚠️ Alguns recursos ainda não foram baixados.';el.className=`form-message ${ok?'success':'info'}`;}
async function downloadAllResources(){const el=$('#resourceStatus'), btn=$('#btnDownloadResources'); if(btn)btn.disabled=true; if(el)el.textContent='Baixando mapas, música, cartas e cosméticos...'; const ok=await cacheGameResources(); if(el){el.textContent=ok?'✅ Download completo. Tudo salvo neste dispositivo.':'❌ O download não terminou. Verifique a conexão e tente novamente.';el.className=`form-message ${ok?'success':'error'}`;} if(btn)btn.disabled=false;}

function setupShopTabs(){/* reservado */}

// Seleção de uma carta online: servidor gera o desafio e só então a carta pode ser enviada.
// O cliente nunca recebe a resposta correta do desafio.

window.addEventListener('DOMContentLoaded',init);
document.addEventListener('click',e=>{const a=e.target.closest('[data-ceo-action]');if(a)ceoPlayerAction(a.dataset.ceoAction);const r=e.target.closest('.ceo-stop-room');if(r)postJSON('/admin/room/stop',{code:r.dataset.code}).then(()=>loadCEOOverview()).catch(x=>toast(x.message,'error'));const q=e.target.closest('.ceo-resolve');if(q)postJSON('/admin/reports/'+q.dataset.id+'/resolve',{}).then(()=>loadCEOOverview()).catch(x=>toast(x.message,'error'));const rp=e.target.closest('[data-report-player]');if(rp){state.reportTarget={id:rp.dataset.reportPlayer,name:rp.dataset.reportName};$('#reportTargetLabel').textContent=`Denunciar ${state.reportTarget.name}`;$('#reportReason').value='trapaça';$('#reportDetails').value='';show('#reportModal');}});
async function sendReport(){const t=state.reportTarget;if(!t)return;const reason=$('#reportReason').value;const details=$('#reportDetails').value.trim();const full=details?`${reason}: ${details}`:reason;try{await postJSON('/report',{targetId:t.id,targetName:t.name,reason:full});hide('#reportModal');toast('Denúncia enviada ao CEO. Obrigado por ajudar a manter o UNO50 seguro.','success',4500);state.reportTarget=null;}catch(e){toast(e.message,'error');}}
