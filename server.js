import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI } from '@google/genai';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json({ limit: '20mb' }));
app.use(express.static(path.join(__dirname, 'dist')));

const TEXT_CANDIDATES = [process.env.TEXT_MODEL, 'gemini-flash-latest', 'gemini-3.5-flash', 'gemini-3-flash', 'gemini-3.1-flash-lite', 'gemini-2.0-flash'].filter(Boolean);
let RESOLVED_TEXT_MODEL = null;
const IMAGE_CANDIDATES = [process.env.IMAGE_MODEL, 'gemini-3-pro-image', 'gemini-3.1-flash-image', 'gemini-2.5-flash-image'].filter(Boolean);
let RESOLVED_IMAGE_MODEL = null;
const FEED_URL = process.env.FEED_URL || 'https://materialworldireland.com/feeds/facebook_export.xml';
const MEDIA = 'https://materialworldireland.com/media/catalog/product';

function ai() { return new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY }); }
function parseDataUrl(d) { const m = /^data:(.+?);base64,(.*)$/s.exec(d || ''); return m ? { mimeType: m[1], data: m[2] } : null; }
function textOf(r){ return (r.candidates?.[0]?.content?.parts||[]).map(p=>p.text).filter(Boolean).join('') || r.text || ''; }
async function textGen(contents){
  const list = [...new Set([RESOLVED_TEXT_MODEL, ...TEXT_CANDIDATES].filter(Boolean))];
  let last;
  for(const m of list){
    try { const r = await ai().models.generateContent({ model: m, contents }); RESOLVED_TEXT_MODEL = m; return r; }
    catch(e){ last = e; }
  }
  throw last || new Error('no text model available');
}

// small embedded catalogue used only if the live feed cannot be read
const EMBEDDED = [
  { id:'marela-apple-green', name:'Marela Herringbone Apple Green', url:`${MEDIA}/m/a/marela_herrinngbone_apple_green-3.jpg`, price:30, tone:'green', motif:'herringbone', outlet:false },
  { id:'marela-burnt-orange', name:'Marela Herringbone Burnt Orange', url:`${MEDIA}/m/a/marela_herringbone_burnt_orange-4.jpg`, price:30, tone:'warm', motif:'herringbone', outlet:false },
  { id:'ascot-steel', name:'Ascot Steel', url:`${MEDIA}/a/s/ascot_steel-3.jpg`, price:26, tone:'neutral', motif:'damask', outlet:false },
  { id:'warwick-cream-grey', name:'Warwick Cream-Grey Damask', url:`${MEDIA}/w/a/warwick_cream-grey_damask-2.jpg`, price:26, tone:'neutral', motif:'damask', outlet:false },
  { id:'albion-navy-stripe', name:'Albion Navy Stripe', url:`${MEDIA}/_/a/_albion_stripe-3.jpg`, price:26, tone:'cool', motif:'stripe', outlet:false },
  { id:'agapanthus-blue-large', name:'Agapanthus Blue Large', url:`${MEDIA}/2/1/21-5.jpg`, price:35, tone:'cool', motif:'floral', outlet:false },
  { id:'toile-blue', name:'Toile Blue', url:`${MEDIA}/1/-/1-2_18.jpg`, price:40, tone:'cool', motif:'floral', outlet:false },
  { id:'hampton-blossom-blue', name:'Hampton Blossom Pale Blue', url:`${MEDIA}/b/l/blossom_blue-2.jpg`, price:28, tone:'cool', motif:'floral', outlet:false },
  { id:'toile-green', name:'Toile Green', url:`${MEDIA}/1/-/1-2_22.jpg`, price:40, tone:'green', motif:'floral', outlet:false },
  { id:'warwick-gold-damask', name:'Warwick Gold Damask', url:`${MEDIA}/w/a/warwick_gold_damask-5.jpg`, price:26, tone:'warm', motif:'damask', outlet:false },
  { id:'vasco', name:'Vasco Wine & Gold', url:`${MEDIA}/v/a/vasco-2.jpg`, price:35, tone:'warm', motif:'damask', outlet:false },
  { id:'victoria-oyster', name:'Victoria Oyster', url:`${MEDIA}/v/i/victoria_oyster-3_1.jpg`, price:26, tone:'neutral', motif:'damask', outlet:false },
];

// full catalogue from the live feed (cached), falls back to EMBEDDED
let CATALOGUE = null, CAT_AT = 0;
const GREEN=['green','sage','olive','fern','moss','apple','mint'];
const WARM=['gold','orange','terracotta','rust','wine','red','burgundy','coral','brick','mustard','ochre','peach','pink','blush','plum','berry','buttermilk'];
const COOL=['blue','navy','denim','teal','aqua','marine','duck egg','duckegg','indigo'];
const NEUTRAL=['cream','ivory','natural','oat','oyster','beige','taupe','stone','greige','linen','white','sand','mocha','charcoal','grey','gray','silver','steel'];
function toneOf(t){ t=t.toLowerCase(); if(GREEN.some(w=>t.includes(w)))return'green'; if(WARM.some(w=>t.includes(w)))return'warm'; if(COOL.some(w=>t.includes(w)))return'cool'; return'neutral'; }
function motifOf(m){ m=(m||'').toLowerCase(); if(m.includes('herringbone'))return'herringbone'; if(m.includes('stripe'))return'stripe'; if(m.includes('damask'))return'damask'; if(m.includes('floral'))return'floral'; if(m.includes('trellis'))return'trellis'; if(m.includes('plain'))return'plain'; return'damask'; }
function normTone(x){ x=(x||'').toLowerCase(); return ['warm','cool','green','neutral'].includes(x)?x:(x.includes('blue')?'cool':x.includes('green')?'green':x.includes('warm')?'warm':'neutral'); }
function normMotif(x){ x=(x||'').toLowerCase(); if(x.startsWith('herring'))return'herringbone'; if(x.includes('stripe')||x.includes('check'))return'stripe'; if(x.includes('damask'))return'damask'; if(x.includes('floral'))return'floral'; if(x.includes('trellis'))return'trellis'; if(x.includes('plain'))return'plain'; return'damask'; }

async function loadCatalogue(){
  if(CATALOGUE && Date.now()-CAT_AT < 6*3600*1000) return CATALOGUE;
  try{
    const xml = await (await fetch(FEED_URL)).text();
    const items = xml.split('<item>').slice(1);
    const out = [];
    for(const chunk of items){
      const g = tag => { const m = chunk.match(new RegExp('<'+tag+'>([\\s\\S]*?)</'+tag+'>')); return m ? m[1].replace(/<!\[CDATA\[|\]\]>/g,'').trim() : ''; };
      const id=g('g:id'), title=g('g:title'), url=g('g:image_link');
      if(!id||!title||!url) continue;
      if(!/in stock/i.test(g('g:availability')||'in stock')) continue;
      out.push({ id, name:title.replace(/\s*Fabric\s*$/i,'').trim(), url, price:Math.round(parseFloat(g('g:price'))||0), tone:toneOf(title), motif:motifOf(g('g:material')), outlet:(g('g:custom_label_1')||'').trim().toLowerCase()==='outlet' });
    }
    if(out.length >= 20){ CATALOGUE=out; CAT_AT=Date.now(); return CATALOGUE; }
  }catch(e){ console.error('feed load failed:', e.message); }
  return EMBEDDED;
}

function matchPicks(briefs, cat){
  const pool = cat.filter(x=>x.url);
  const nonOutlet = pool.filter(x=>!x.outlet);
  const base = nonOutlet.length>=12 ? nonOutlet : pool;
  const used=new Set(); const picks=[]; const rand=a=>a[Math.floor(Math.random()*a.length)];
  for(const b of (briefs||[])){
    const tone=normTone(b.tone), motif=normMotif(b.motif);
    let cand=base.filter(x=>!used.has(x.id)&&x.tone===tone&&x.motif===motif);
    if(!cand.length) cand=base.filter(x=>!used.has(x.id)&&x.tone===tone);
    if(!cand.length) cand=base.filter(x=>!used.has(x.id));
    if(!cand.length) break;
    const c=rand(cand); used.add(c.id);
    picks.push({ id:c.id, name:c.name, url:c.url, price:c.price, reason:b.reason||'' });
  }
  while(picks.length<4){ const cand=base.filter(x=>!used.has(x.id)); if(!cand.length) break; const c=rand(cand); used.add(c.id); picks.push({ id:c.id, name:c.name, url:c.url, price:c.price, reason:'' }); }
  return picks.slice(0,4);
}

app.post('/api/analyse', async (req, res) => {
  try {
    if (!process.env.GEMINI_API_KEY) return res.status(500).json({ error: 'Set GEMINI_API_KEY in Railway > Variables.' });
    const r = parseDataUrl((req.body||{}).room);
    if (!r) return res.status(400).json({ error: 'Missing room image.' });
    const prompt =
      'You are a soft-furnishings stylist looking at a photo of a room to recommend Roman blind fabrics. ' +
      'Reply with ONLY raw JSON, no markdown, in this shape: ' +
      '{"style":"short phrase describing the room","wall":"the wall colour in plain words","light":"the light in the room","palette":["#hex","#hex","#hex"],' +
      '"summary":"one or two warm sentences explaining why these fabrics suit this room, referring to the wall colour and the light","picks":[{"tone":"warm|cool|green|neutral","motif":"plain|herringbone|stripe|damask|floral|trellis","reason":"one short sentence that refers to the wall colour or the light"}]}. ' +
      'Read the wall colour and the light carefully and let them drive the choices: in a dim or north-facing room prefer lighter or warmer fabrics; in a bright room richer or cooler tones also work; either match the walls tonally or gently complement them. ' +
      'Give EXACTLY 4 picks and make them varied; do not repeat the same tone four times.';
    const response = await textGen([{ text: prompt }, { inlineData: { mimeType: r.mimeType, data: r.data } }]);
    let txt = textOf(response).replace(/```json|```/g,'').trim(); let parsed;
    try { parsed = JSON.parse(txt); } catch { const m = txt.match(/\{[\s\S]*\}/); parsed = m ? JSON.parse(m[0]) : null; }
    if (!parsed) return res.status(502).json({ error: 'Could not parse analysis.' });
    const cat = await loadCatalogue();
    const picks = matchPicks(parsed.picks, cat);
    res.json({ style: parsed.style || '', wall: parsed.wall || '', light: parsed.light || '', summary: parsed.summary || '', palette: parsed.palette || [], picks });
  } catch (e) { console.error('analyse failed:', e.message); res.status(500).json({ error: e.message || 'analyse failed' }); }
});

const RATIOS=[['1:1',1],['4:5',0.8],['5:4',1.25],['3:4',0.75],['4:3',4/3],['2:3',2/3],['3:2',1.5],['9:16',0.5625],['16:9',16/9]];
function nearestAspect(w,h){ const r=w/h; let best='1:1',bd=1e9; for(const x of RATIOS){ const d=Math.abs(x[1]-r); if(d<bd){bd=d;best=x[0];} } return best; }
function readImageSize(buf){
  try{
    if(buf.length>24 && buf[0]===0x89 && buf[1]===0x50) return { w:buf.readUInt32BE(16), h:buf.readUInt32BE(20) };
    if(buf[0]===0xFF && buf[1]===0xD8){ let o=2; while(o<buf.length-8){ if(buf[o]!==0xFF){o++;continue;} const m=buf[o+1]; if(m>=0xC0&&m<=0xCF&&m!==0xC4&&m!==0xC8&&m!==0xCC){ return { h:buf.readUInt16BE(o+5), w:buf.readUInt16BE(o+7) }; } o+=2+buf.readUInt16BE(o+2); } }
  }catch(e){}
  return null;
}
const fabricCache = new Map();
async function getFabricImage(url){
  if(fabricCache.has(url)) return fabricCache.get(url);
  const resp = await fetch(url); if(!resp.ok) throw new Error('fabric image fetch failed '+resp.status);
  const buf = Buffer.from(await resp.arrayBuffer());
  const rec = { mimeType: resp.headers.get('content-type')||'image/jpeg', data: buf.toString('base64') };
  fabricCache.set(url, rec); return rec;
}
async function generateImage(parts){
  let last;
  for(const m of [...new Set(IMAGE_CANDIDATES)]){
    try{ const r=await ai().models.generateContent({ model:m, contents:parts }); const out=(r.candidates?.[0]?.content?.parts||[]).find(p=>p.inlineData); if(out){ RESOLVED_IMAGE_MODEL=m; return out; } last=new Error('no image from '+m); }
    catch(e){ last=e; }
  }
  throw last||new Error('render failed');
}
app.post('/api/render', async (req, res) => {
  try {
    if (!process.env.GEMINI_API_KEY) return res.status(500).json({ error: 'Set GEMINI_API_KEY in Railway > Variables.' });
    const { room, fabric, fabricUrl, product = 'blind', fabricName = '' } = req.body || {};
    const r = parseDataUrl(room); if (!r) return res.status(400).json({ error: 'Missing room image.' });
    const sz = readImageSize(Buffer.from(r.data,'base64'));
    const aspect = sz ? nearestAspect(sz.w, sz.h) : null;
    let f = fabricUrl ? await getFabricImage(fabricUrl) : parseDataUrl(fabric);
    const item = product === 'curtain' ? 'pair of curtains' : 'Roman blind';
    const raise = product === 'blind'
      ? 'Show the Roman blind partially raised: gathered into crisp, evenly spaced horizontal folds that stack neatly at the top of the window, with the lower part of the window and its light visible below. The blind must look tailored and structured, hanging flat and square to the window, not loose, bunched, draped or puddling. Do not show it fully lowered covering the whole window. '
      : '';
    const prompt =
      `Edit the FIRST image, which is a real customer's room photo. Keep that room exactly as it is: the same walls, window frame, sill, furniture, plants, camera angle and lighting must stay identical. Keep the exact same aspect ratio, framing and full extent of the first image: the output must show exactly the same area as the input photo, including the walls, floor, furniture and every object at the edges, and must NOT zoom in on the window, crop, or recompose the shot. ` +
      `If the window already has any existing blind, curtains, roller blind or covering, first remove it completely, then fit a new made-to-measure ${item} in its place. If the window is bare, simply add the ${item}. ` +
      raise +
      `The ${item} should sit naturally within the window recess and be the only window covering in the final image. ` +
      `The SECOND image is a fabric sample, provided ONLY as a reference for the material's colour, weave and pattern. Do NOT copy the room, window, scene, props or lighting from the second image; take nothing from it except the fabric itself` +
      (fabricName ? ` (${fabricName})` : '') + `. ` +
      `The fabric must appear ONLY as the ${item} fitted inside the window recess. Do not drape, hang, tent or place the fabric anywhere else in the room, and do not add any extra fabric, canopy or covering across the walls, ceiling, bed or floor. ` +
      `The ${item} has full blackout lining, so the fabric is completely opaque: no sunlight, glow or window view shows through the fabric itself, and it reads as solid colour with soft natural folds. ` +
      `Keep anything in front of the window, such as plants, the sill or furniture, in front of the ${item}. ` +
      `Photorealistic, with natural folds and soft shadows. Return only the edited photograph of the customer's room.`;
    const parts = [{ text: prompt }, { inlineData: { mimeType: r.mimeType, data: r.data } }];
    if (f) parts.push({ inlineData: { mimeType: f.mimeType, data: f.data } });
    const out = await generateImage(parts);
    res.json({ image: `data:${out.inlineData.mimeType || 'image/png'};base64,${out.inlineData.data}` });
  } catch (e) { console.error('render failed:', e.message); res.status(500).json({ error: e.message || 'render failed' }); }
});

// quick diagnostic: visit /api/diag in the browser to see why analysis may be failing
app.get('/api/diag', async (req, res) => {
  const out = { hasKey: !!process.env.GEMINI_API_KEY, textCandidates: TEXT_CANDIDATES, imageCandidates: IMAGE_CANDIDATES };
  try {
    const r = await textGen([{ text: 'Reply with the single word OK.' }]);
    out.textModelWorks = true; out.resolvedTextModel = RESOLVED_TEXT_MODEL; out.textSample = textOf(r).slice(0, 60);
  } catch (e) { out.textModelWorks = false; out.textModelError = e.message; }
  try {
    await generateImage([{ text: 'Generate a simple image: a small solid blue square on a white background.' }]);
    out.imageModelWorks = true; out.resolvedImageModel = RESOLVED_IMAGE_MODEL;
  } catch (e) { out.imageModelWorks = false; out.imageModelError = e.message; }
  try {
    const cat = await loadCatalogue();
    out.catalogueCount = cat.length; out.usingEmbeddedFallback = (cat === EMBEDDED);
  } catch (e) { out.catalogueError = e.message; }
  res.json(out);
});

app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'dist', 'index.html')));
const PORT = process.env.PORT || 4173;
app.listen(PORT, () => console.log('listening on ' + PORT));
