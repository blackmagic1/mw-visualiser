import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI } from '@google/genai';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json({ limit: '20mb' }));
app.use(express.static(path.join(__dirname, 'dist')));

const TEXT_MODEL = process.env.TEXT_MODEL || 'gemini-2.5-flash';
const IMAGE_MODEL = process.env.IMAGE_MODEL || 'gemini-3-pro-image';

function ai() { return new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY }); }
function parseDataUrl(d) { const m = /^data:(.+?);base64,(.*)$/s.exec(d || ''); return m ? { mimeType: m[1], data: m[2] } : null; }
function textOf(r){ return (r.candidates?.[0]?.content?.parts||[]).map(p=>p.text).filter(Boolean).join('') || r.text || ''; }

// fabric image cache: fetch each fabric image from the site ONCE
const fabricCache = new Map();
async function getFabricImage(url) {
  if (fabricCache.has(url)) return fabricCache.get(url);
  const resp = await fetch(url);
  if (!resp.ok) throw new Error('fabric image fetch failed ' + resp.status);
  const buf = Buffer.from(await resp.arrayBuffer());
  const rec = { mimeType: resp.headers.get('content-type') || 'image/jpeg', data: buf.toString('base64') };
  fabricCache.set(url, rec);
  return rec;
}

// analyse the room, choose 4 fabrics from the supplied list
app.post('/api/analyse', async (req, res) => {
  try {
    if (!process.env.GEMINI_API_KEY) return res.status(500).json({ error: 'Set GEMINI_API_KEY in Railway > Variables.' });
    const { room, fabrics = [] } = req.body || {};
    const r = parseDataUrl(room);
    if (!r) return res.status(400).json({ error: 'Missing room image.' });
    const list = fabrics.map(f => `${f.id}: ${f.name}`).join('\n');
    const prompt =
      'Look at this room photo and choose fabrics that would suit it. Return JSON only with this shape: ' +
      '{"style":"short phrase describing the room","palette":["#hex","#hex","#hex"],"picks":[{"id":"fabric-id","reason":"one short sentence tied to something visible in the room"}]}. ' +
      'palette = 3 to 5 hex colours pulled from the room. picks = EXACTLY 4 fabrics, chosen from the list below, varied across tone, using the id verbatim.\n\nFABRICS:\n' + list;
    const response = await ai().models.generateContent({
      model: TEXT_MODEL,
      contents: [{ text: prompt }, { inlineData: { mimeType: r.mimeType, data: r.data } }],
      config: { responseMimeType: 'application/json' },
    });
    let txt = textOf(response).trim();
    let parsed;
    try { parsed = JSON.parse(txt); }
    catch { const m = txt.match(/\{[\s\S]*\}/); parsed = m ? JSON.parse(m[0]) : null; }
    if (!parsed) return res.status(502).json({ error: 'Could not parse analysis.' });
    res.json({ style: parsed.style || '', palette: parsed.palette || [], picks: (parsed.picks || []).slice(0, 4) });
  } catch (e) { res.status(500).json({ error: e.message || 'analyse failed' }); }
});

// render one fabric onto the room window, with retries
async function generateImage(parts, tries = 3) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try {
      const response = await ai().models.generateContent({ model: IMAGE_MODEL, contents: parts });
      const out = (response.candidates?.[0]?.content?.parts || []).find(p => p.inlineData);
      if (out) return out;
      lastErr = new Error('no image returned');
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error('render failed');
}

app.post('/api/render', async (req, res) => {
  try {
    if (!process.env.GEMINI_API_KEY) return res.status(500).json({ error: 'Set GEMINI_API_KEY in Railway > Variables.' });
    const { room, fabric, fabricUrl, product = 'blind', fabricName = '' } = req.body || {};
    const r = parseDataUrl(room);
    if (!r) return res.status(400).json({ error: 'Missing room image.' });
    let f = null;
    if (fabricUrl) f = await getFabricImage(fabricUrl);
    else f = parseDataUrl(fabric);

    const item = product === 'curtain' ? 'pair of curtains' : 'Roman blind';
    const prompt =
      `Edit the FIRST image, which is a real customer's room photo. Keep that room exactly as it is: the same walls, window frame, sill, furniture, plants, camera angle and lighting must stay identical. ` +
      `Only add a made-to-measure ${item} fitted to the window. ` +
      `The SECOND image is a fabric sample, provided ONLY as a reference for the material's colour, weave and pattern. Do NOT copy the room, window, scene, props or lighting from the second image; take nothing from it except the fabric itself` +
      (fabricName ? ` (${fabricName})` : '') + `. ` +
      `The ${item} has full blackout lining, so the fabric is completely opaque: no sunlight, glow or window view shows through it, and it reads as solid colour with soft natural folds. ` +
      `Keep anything in front of the window, such as plants, the sill or furniture, in front of the ${item}. ` +
      `Photorealistic, with natural folds and soft shadows. Return only the edited photograph of the customer's room.`;

    const parts = [{ text: prompt }, { inlineData: { mimeType: r.mimeType, data: r.data } }];
    if (f) parts.push({ inlineData: { mimeType: f.mimeType, data: f.data } });

    const out = await generateImage(parts, 3);
    res.json({ image: `data:${out.inlineData.mimeType || 'image/png'};base64,${out.inlineData.data}` });
  } catch (e) { res.status(500).json({ error: e.message || 'render failed' }); }
});

app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'dist', 'index.html')));
const PORT = process.env.PORT || 4173;
app.listen(PORT, () => console.log('listening on ' + PORT));
