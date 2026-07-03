// ═══════════════════════════════════════════════
// AL-DANISH WELFARE FOUNDATION — BACKEND SERVER
// Node.js + Express + Supabase
// Updated: New AQ. Auth key format for Gemini
// ═══════════════════════════════════════════════

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');

const app = express();
const PORT = process.env.PORT || 3000;

// Supabase
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// Middleware
app.use(express.json({ limit: '10mb' }));
app.use(cors({
  origin: '*', // Allow all for now
  credentials: true
}));

// Rate limiting
const loginLimiter = rateLimit({ windowMs: 15*60*1000, max: 10 });
const apiLimiter = rateLimit({ windowMs: 60*1000, max: 60 });
app.use('/api/', apiLimiter);

// JWT Verify
function verifyToken(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Token nahi mila' });
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET || 'aldanish_secret');
    next();
  } catch {
    res.status(401).json({ error: 'Token galat hai' });
  }
}

function adminOnly(req, res, next) {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Sirf admin' });
  next();
}

// Health check
app.get('/', (req, res) => {
  res.json({ status: '✅ Al-Danish Backend Running', time: new Date().toLocaleString() });
});

// ─── AUTH ───
app.post('/api/auth/login', loginLimiter, async (req, res) => {
  const { username, password } = req.body;
  if (username === process.env.ADMIN_USERNAME && password === process.env.ADMIN_PASSWORD) {
    const token = jwt.sign(
      { id: 'admin', name: 'Admin Usman', role: 'admin', type: 'admin', logAccess: true },
      process.env.JWT_SECRET || 'aldanish_secret',
      { expiresIn: '24h' }
    );
    await logActivity('login', 'Admin login', 'Admin Usman');
    return res.json({ success: true, token, user: { name: 'Admin Usman', role: 'Administrator', type: 'admin' } });
  }
  // Staff check
  const { data: staffList } = await supabase.from('staff').select('*');
  const staff = staffList?.find(s => {
    const d = s.data || s;
    return (d.username === username || d.name?.toLowerCase().replace(/\s+/g,'.') === username) && d.pass === password && d.active !== false;
  });
  if (staff) {
    const sd = staff.data || staff;
    const token = jwt.sign(
      { id: sd.id, name: sd.name, role: sd.role, type: 'staff', perms: sd.perms, logAccess: sd.logAccess },
      process.env.JWT_SECRET || 'aldanish_secret',
      { expiresIn: '12h' }
    );
    return res.json({ success: true, token, user: { name: sd.name, role: sd.role, type: 'staff', perms: sd.perms, logAccess: sd.logAccess, firstLogin: sd.firstLogin } });
  }
  res.status(401).json({ error: 'Galat username ya password' });
});

app.post('/api/auth/verify-otp', loginLimiter, (req, res) => {
  if (req.body.otp === process.env.ADMIN_OTP) {
    res.json({ success: true });
  } else {
    res.status(401).json({ error: 'Galat OTP' });
  }
});

// ─── AI ROUTES (New AQ. Auth key format) ───
app.post('/api/ai/chat', verifyToken, async (req, res) => {
  const { messages, systemPrompt } = req.body;
  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': process.env.GEMINI_API_KEY  // New AQ. key format
        },
        body: JSON.stringify({
          contents: (messages || []).slice(-10),
          systemInstruction: { parts: [{ text: systemPrompt || 'Tum Al-Danish Welfare Foundation ke AI assistant ho. Urdu aur English dono mein jawab do.' }] },
          generationConfig: { maxOutputTokens: 500, temperature: 0.7 }
        })
      }
    );
    const data = await response.json();
    if (!response.ok) throw new Error(data?.error?.message || 'AI error');
    const reply = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    res.json({ success: true, reply });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/ai/scan', verifyToken, async (req, res) => {
  const { imageBase64, imageMime, text, formType } = req.body;
  const prompts = {
    donor: 'Extract donor info. Return ONLY JSON: {"name":"","age":"","city":"","phone":"","bloodGroup":"A/B/AB/O","rh":"+/-","hospitals":[],"fee":"Yes/No"}',
    patient: 'Extract patient info. Return ONLY JSON: {"patientName":"","case":"","hospital":"","date":"YYYY-MM-DD","time":"HH:MM","attendantName":"","attendantPhone":"","bloodGroup":"A/B/AB/O","rh":"+/-","pickup":"Yes/No"}',
    give: 'Extract donation info. Return ONLY JSON: {"name":"","phone":"","city":"","program":"","purpose":"Zakat/Fitar/Sadqa/Donation/Other","amount":"","note":""}',
    take: 'Extract applicant info. Return ONLY JSON: {"name":"","age":"","phone":"","city":"","address":"","program":"","purpose":"Education/Rashan/Dress/Medical/Other","familyMembers":"","income":"","note":""}'
  };
  try {
    let parts = imageBase64
      ? [{ inline_data: { mime_type: imageMime || 'image/jpeg', data: imageBase64 } }, { text: prompts[formType] }]
      : [{ text: `Document:\n${text}\n\n${prompts[formType]}` }];

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': process.env.GEMINI_API_KEY
        },
        body: JSON.stringify({
          contents: [{ parts }],
          generationConfig: { maxOutputTokens: 400, temperature: 0.1 }
        })
      }
    );
    const data = await response.json();
    const raw = data?.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
    const extracted = JSON.parse(raw.replace(/```json|```/g, '').trim());
    res.json({ success: true, data: extracted });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── DATA HELPERS ───
async function getAll(table) {
  const { data, error } = await supabase.from(table).select('*').order('id');
  if (error) throw error;
  return data.map(r => r.data || r);
}
async function insertOne(table, rowData) {
  const { error } = await supabase.from(table).insert({ data: rowData });
  if (error) throw error;
}
async function updateOne(table, id, rowData) {
  const { error } = await supabase.from(table).update({ data: rowData }).eq('data->>id', String(id));
  if (error) throw error;
}
async function deleteOne(table, id) {
  const { error } = await supabase.from(table).delete().eq('data->>id', String(id));
  if (error) throw error;
}
async function logActivity(type, msg, user) {
  try {
    await supabase.from('activity_log').insert({
      data: { type, msg, user, time: new Date().toLocaleString('en-PK'), ts: Date.now() }
    });
  } catch(e) {}
}

// ─── CRUD ROUTES ───
const tables = {
  donors: 'donors', patients: 'patients', gallery: 'gallery',
  gives: 'gives', takes: 'takes', donations: 'donations', welfare: 'welfare_programs'
};

Object.entries(tables).forEach(([route, table]) => {
  app.get(`/api/${route}`, verifyToken, async (req, res) => {
    try { res.json(await getAll(table)); } catch(e) { res.status(500).json({ error: e.message }); }
  });
  app.post(`/api/${route}`, verifyToken, async (req, res) => {
    try { await insertOne(table, req.body); await logActivity(route, `Added to ${route}`, req.user?.name); res.json({ success: true }); }
    catch(e) { res.status(500).json({ error: e.message }); }
  });
  app.put(`/api/${route}/:id`, verifyToken, async (req, res) => {
    try { await updateOne(table, req.params.id, req.body); res.json({ success: true }); }
    catch(e) { res.status(500).json({ error: e.message }); }
  });
  app.delete(`/api/${route}/:id`, verifyToken, async (req, res) => {
    try { await deleteOne(table, req.params.id); res.json({ success: true }); }
    catch(e) { res.status(500).json({ error: e.message }); }
  });
});

// Staff (admin only)
app.get('/api/staff', verifyToken, adminOnly, async (req, res) => {
  try {
    const list = await getAll('staff');
    res.json(list.map(s => ({ ...s, pass: undefined })));
  } catch(e) { res.status(500).json({ error: e.message }); }
});
app.post('/api/staff', verifyToken, adminOnly, async (req, res) => {
  try { await insertOne('staff', req.body); res.json({ success: true }); }
  catch(e) { res.status(500).json({ error: e.message }); }
});
app.put('/api/staff/:id', verifyToken, adminOnly, async (req, res) => {
  try { await updateOne('staff', req.params.id, req.body); res.json({ success: true }); }
  catch(e) { res.status(500).json({ error: e.message }); }
});
app.delete('/api/staff/:id', verifyToken, adminOnly, async (req, res) => {
  try { await deleteOne('staff', req.params.id); res.json({ success: true }); }
  catch(e) { res.status(500).json({ error: e.message }); }
});

// Settings
app.get('/api/settings', verifyToken, async (req, res) => {
  try {
    const { data } = await supabase.from('settings').select('*').eq('key', 'site_settings').single();
    res.json(data?.value || {});
  } catch(e) { res.json({}); }
});
app.post('/api/settings', verifyToken, adminOnly, async (req, res) => {
  try {
    await supabase.from('settings').upsert({ key: 'site_settings', value: req.body, updated_at: new Date().toISOString() });
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Log
app.get('/api/log', verifyToken, async (req, res) => {
  try {
    const { data } = await supabase.from('activity_log').select('*').order('id', { ascending: false }).limit(200);
    res.json(data.map(r => r.data || r));
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.listen(PORT, () => console.log(`✅ Al-Danish Backend on port ${PORT}`));
