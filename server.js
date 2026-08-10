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

// ---- fabric image cache: fetch each fabric image from the site ONCE ----
const fabricCache = new Map(); // url -> { mimeType, data }
async function getFabricImage(url) {
  if (fabricCache.has(url)) return fabricCache.get(url);
  const resp = await fetch(url);
  if (!resp.ok) throw new Error('fabric image fetch failed ' + resp.status);
  const buf = Buffer.from(await resp.arrayBuffer());
  const rec = { mimeType: resp.headers.get('content-type') || 'image/jpeg', data: buf.toString('base64') };
  fabricCache.set(url, rec);
  return rec;
}

// ---- analyse the room, choose 4 fabrics from the supplied list ----
app.post('/api/analyse', async (req, res) => {
  try {
    if (!process.env.GEMINI_API_KEY) return res.status(500).json({ error: 'Set GEMINI_API_KEY in Railway > Variables.' });
    const { room, fabrics = [] } = req.body || {};
    const r = parseDataUrl(room);
    if (!r) return res.status(400).json({ error: 'Missing room image.' });
    const list = fabrics.map(f => `${f.id}: ${f.name}`).join('\n');
    const prompt =
      'Look at this room photo. Respond with ONLY raw JSON, no markdown. Schema: ' +
      '{"style":string,"palette":[string],"picks":[{"id":string,"reason":string}]}. ' +
      'style = one short phrase for the room. palette = 3-5 hex colours from the room. ' +
      'picks = EXACTLY 4 fabrics chosen from the list below that would suit this room, varied across tone. ' +
      'Use the id verbatim. reason = one short sentence tied to something visible in the room.\n\nFABRICS:\n' + list;
    const response = await ai().models.generateContent({
      model: TEXT_MODEL,
      contents: [{ text: prompt }, { inlineData: { mimeType: r.mimeType, data: r.data } }],
    });
    const txt = textOf(response).replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(txt);
    res.json({ style: parsed.style || '', palette: parsed.palette || [], picks: (parsed.picks || []).slice(0, 4) });
  } catch (e) { res.status(500).json({ error: e.message || 'analyse failed' }); }
});

// ---- render one fabric onto the room window ----
app.post('/api/render', async (req, res) => {
  try {
    if (!process.env.GEMINI_API_KEY) return res.status(500).json({ error: 'Set GEMINI_API_KEY in Railway > Variables.' });
    const { room, fabric, fabricUrl, product = 'blind', fabricName = '' } = req.body || {};
    const r = parseDataUrl(room);
    if (!r) return res.status(400).json({ error: 'Missing room image.' });
    // Prefer a real fabric image URL (cached once); fall back to a swatch sent by the client
    let f = null;
    if (fabricUrl) f = await getFabricImage(fabricUrl);
    else f = parseDataUrl(fabric);

    const item = product === 'curtain' ? 'pair of curtains' : 'Roman blind';
    const prompt =
      `Add a made-to-measure ${item} to the window in the first image, using the fabric shown in the second image` +
      (fabricName ? ` (${fabricName})` : '') +
      `. Match the room's perspective, scale and lighting. Keep everything else in the room exactly the same. ` +
      `Anything in front of the window, such as plants, a windowsill or furniture, must remain in front of the ${product === 'curtain' ? 'curtains' : 'blind'}. ` +
      `Photorealistic, with natural fabric folds and soft shadows.`;
    const parts = [{ text: prompt }, { inlineData: { mimeType: r.mimeType, data: r.data } }];
    if (f) parts.push({ inlineData: { mimeType: f.mimeType, data: f.data } });

    const response = await ai().models.generateContent({ model: IMAGE_MODEL, contents: parts });
    const out = (response.candidates?.[0]?.content?.parts || []).find(p => p.inlineData);
    if (!out) return res.status(502).json({ error: 'No image returned by the model.' });
    res.json({ image: `data:${out.inlineData.mimeType || 'image/png'};base64,${out.inlineData.data}` });
  } catch (e) { res.status(500).json({ error: e.message || 'render failed' }); }
});

app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'dist', 'index.html')));
const PORT = process.env.PORT || 4173;
app.listen(PORT, () => console.log('listening on ' + PORT));
