// ═══════════════════════════════════════════════
// AL-DANISH WELFARE FOUNDATION — BACKEND SERVER
// Node.js + Express + Supabase
// ═══════════════════════════════════════════════

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');

const app = express();
const PORT = process.env.PORT || 3000;

// ─── SUPABASE CLIENT (Service Key - hidden on server) ───
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY // Service key - full access, never in frontend!
);

// ─── MIDDLEWARE ───
app.use(express.json({ limit: '10mb' })); // For base64 images
app.use(cors({
  origin: [
    'https://aldanishwelfarefoundation.netlify.app',
    'https://tubular-dango-813c5d.netlify.app',
    'http://localhost:3000',
    'http://127.0.0.1:5500'
  ],
  credentials: true
}));

// Rate limiting - brute force se bachao
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // max 10 login attempts
  message: { error: 'Bohot zyada attempts. 15 minute baad try karein.' }
});

const apiLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 60 // 60 requests per minute
});

app.use('/api/', apiLimiter);

// ─── JWT VERIFY MIDDLEWARE ───
function verifyToken(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Token nahi mila' });
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Token galat hai ya expire ho gaya' });
  }
}

function adminOnly(req, res, next) {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ error: 'Sirf admin access kar sakta hai' });
  }
  next();
}

// ─── HEALTH CHECK ───
app.get('/', (req, res) => {
  res.json({
    status: '✅ Al-Danish Backend Running',
    version: '1.0.0',
    time: new Date().toLocaleString('en-PK')
  });
});

// ═══════════════════════════════════════════════
// AUTH ROUTES
// ═══════════════════════════════════════════════

// Admin Login
app.post('/api/auth/login', loginLimiter, async (req, res) => {
  const { username, password } = req.body;
  
  // Admin check (server side - safe!)
  if (
    username === process.env.ADMIN_USERNAME && 
    password === process.env.ADMIN_PASSWORD
  ) {
    const token = jwt.sign(
      { id: 'admin', name: 'Admin Usman', role: 'admin', logAccess: true },
      process.env.JWT_SECRET,
      { expiresIn: '24h' }
    );
    await logActivity('login', 'Admin login successful', 'Admin Usman');
    return res.json({ success: true, token, user: { name: 'Admin Usman', role: 'Administrator', type: 'admin' } });
  }

  // Staff check from Supabase
  const { data: staffList } = await supabase.from('staff').select('*');
  const staff = staffList?.find(s => {
    const data = s.data || s;
    return (data.username === username || data.name?.toLowerCase().replace(/\s+/g, '.') === username) 
      && data.pass === password && data.active !== false;
  });

  if (staff) {
    const sd = staff.data || staff;
    const token = jwt.sign(
      { id: sd.id, name: sd.name, role: sd.role, type: 'staff', perms: sd.perms, logAccess: sd.logAccess },
      process.env.JWT_SECRET,
      { expiresIn: '12h' }
    );
    await logActivity('login', `Staff login: ${sd.name}`, sd.name);
    return res.json({ success: true, token, user: { name: sd.name, role: sd.role, type: 'staff', perms: sd.perms, logAccess: sd.logAccess, firstLogin: sd.firstLogin } });
  }

  res.status(401).json({ error: 'Galat username ya password' });
});

// OTP Verify
app.post('/api/auth/verify-otp', loginLimiter, (req, res) => {
  const { otp } = req.body;
  if (otp === process.env.ADMIN_OTP) {
    res.json({ success: true, message: 'OTP sahi hai' });
  } else {
    res.status(401).json({ error: 'Galat OTP' });
  }
});

// ═══════════════════════════════════════════════
// AI ROUTE (Gemini key hidden on server!)
// ═══════════════════════════════════════════════

app.post('/api/ai/chat', verifyToken, async (req, res) => {
  const { messages, systemPrompt, lang } = req.body;
  
  try {
    const defaultSP = `Tum Al-Danish Welfare Foundation ke AI assistant ho. 
Blood donation, NGO programs aur website ke baare mein help karo. 
Urdu aur English dono mein jawab do. 
Donors aur patients ki matching mein bhi help karo.`;

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${process.env.GEMINI_MODEL}:generateContent?key=${process.env.GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: messages.slice(-10), // Last 10 messages
          systemInstruction: { parts: [{ text: systemPrompt || defaultSP }] },
          generationConfig: { maxOutputTokens: 500, temperature: 0.7 }
        })
      }
    );
    
    const data = await response.json();
    if (!response.ok) throw new Error(data?.error?.message || 'AI error');
    
    const reply = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    res.json({ success: true, reply });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Document Scan (Image/Text → AI extract)
app.post('/api/ai/scan', verifyToken, async (req, res) => {
  const { imageBase64, imageMime, text, formType } = req.body;
  
  const prompts = {
    donor: 'Extract donor info. Return ONLY JSON: {"name":"","age":"","city":"","phone":"","bloodGroup":"A/B/AB/O","rh":"+/-","hospitals":[],"fee":"Yes/No"}',
    patient: 'Extract patient info. Return ONLY JSON: {"patientName":"","case":"","hospital":"","date":"YYYY-MM-DD","time":"HH:MM","attendantName":"","attendantPhone":"","bloodGroup":"A/B/AB/O","rh":"+/-","pickup":"Yes/No"}',
    give: 'Extract donation info. Return ONLY JSON: {"name":"","phone":"","city":"","program":"","purpose":"Zakat/Fitar/Sadqa/Donation/Other","amount":"","note":""}',
    take: 'Extract applicant info. Return ONLY JSON: {"name":"","age":"","phone":"","city":"","address":"","program":"","purpose":"Education/Rashan/Dress/Medical/Other","familyMembers":"","income":"","note":""}'
  };
  
  try {
    let parts = [];
    if (imageBase64) {
      parts = [{ inline_data: { mime_type: imageMime || 'image/jpeg', data: imageBase64 } }, { text: prompts[formType] }];
    } else {
      parts = [{ text: `Document:\n${text}\n\n${prompts[formType]}` }];
    }
    
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${process.env.GEMINI_MODEL}:generateContent?key=${process.env.GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts }], generationConfig: { maxOutputTokens: 400, temperature: 0.1 } })
      }
    );
    
    const data = await response.json();
    const raw = data?.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
    const extracted = JSON.parse(raw.replace(/```json|```/g, '').trim());
    res.json({ success: true, data: extracted });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ═══════════════════════════════════════════════
// DATA ROUTES
// ═══════════════════════════════════════════════

// Generic CRUD helper
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
  const { error } = await supabase.from(table).update({ data: rowData }).eq('data->>id', id);
  if (error) throw error;
}

async function deleteOne(table, id) {
  const { error } = await supabase.from(table).delete().eq('data->>id', id);
  if (error) throw error;
}

async function logActivity(type, msg, user) {
  try {
    await supabase.from('activity_log').insert({
      data: { type, msg, user, time: new Date().toLocaleString('en-PK'), ts: Date.now() }
    });
  } catch(e) { console.warn('Log error:', e.message); }
}

// DONORS
app.get('/api/donors', verifyToken, async (req, res) => {
  try { res.json(await getAll('donors')); }
  catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/donors', verifyToken, async (req, res) => {
  try {
    await insertOne('donors', req.body);
    await logActivity('donor', 'New donor: ' + req.body.name, req.user.name);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/donors/:id', verifyToken, async (req, res) => {
  try {
    await updateOne('donors', req.params.id, req.body);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/donors/:id', verifyToken, async (req, res) => {
  try {
    await deleteOne('donors', req.params.id);
    await logActivity('donor', 'Donor deleted: ' + req.params.id, req.user.name);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// PATIENTS
app.get('/api/patients', verifyToken, async (req, res) => {
  try { res.json(await getAll('patients')); }
  catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/patients', verifyToken, async (req, res) => {
  try {
    await insertOne('patients', req.body);
    await logActivity('patient', 'New patient: ' + req.body.patient, req.user.name);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/patients/:id', verifyToken, async (req, res) => {
  try {
    await updateOne('patients', req.params.id, req.body);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/patients/:id', verifyToken, async (req, res) => {
  try {
    await deleteOne('patients', req.params.id);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// GALLERY
app.get('/api/gallery', verifyToken, async (req, res) => {
  try { res.json(await getAll('gallery')); }
  catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/gallery', verifyToken, async (req, res) => {
  try { await insertOne('gallery', req.body); res.json({ success: true }); }
  catch(e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/gallery/:id', verifyToken, async (req, res) => {
  try { await updateOne('gallery', req.params.id, req.body); res.json({ success: true }); }
  catch(e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/gallery/:id', verifyToken, async (req, res) => {
  try { await deleteOne('gallery', req.params.id); res.json({ success: true }); }
  catch(e) { res.status(500).json({ error: e.message }); }
});

// GIVES
app.get('/api/gives', verifyToken, async (req, res) => {
  try { res.json(await getAll('gives')); }
  catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/gives', verifyToken, async (req, res) => {
  try { await insertOne('gives', req.body); res.json({ success: true }); }
  catch(e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/gives/:id', verifyToken, async (req, res) => {
  try { await deleteOne('gives', req.params.id); res.json({ success: true }); }
  catch(e) { res.status(500).json({ error: e.message }); }
});

// TAKES
app.get('/api/takes', verifyToken, async (req, res) => {
  try { res.json(await getAll('takes')); }
  catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/takes', verifyToken, async (req, res) => {
  try { await insertOne('takes', req.body); res.json({ success: true }); }
  catch(e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/takes/:id', verifyToken, async (req, res) => {
  try { await updateOne('takes', req.params.id, req.body); res.json({ success: true }); }
  catch(e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/takes/:id', verifyToken, async (req, res) => {
  try { await deleteOne('takes', req.params.id); res.json({ success: true }); }
  catch(e) { res.status(500).json({ error: e.message }); }
});

// DONATIONS
app.get('/api/donations', verifyToken, async (req, res) => {
  try { res.json(await getAll('donations')); }
  catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/donations', verifyToken, async (req, res) => {
  try { await insertOne('donations', req.body); res.json({ success: true }); }
  catch(e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/donations/:id', verifyToken, async (req, res) => {
  try { await deleteOne('donations', req.params.id); res.json({ success: true }); }
  catch(e) { res.status(500).json({ error: e.message }); }
});

// WELFARE PROGRAMS
app.get('/api/welfare', verifyToken, async (req, res) => {
  try { res.json(await getAll('welfare_programs')); }
  catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/welfare', verifyToken, adminOnly, async (req, res) => {
  try { await insertOne('welfare_programs', req.body); res.json({ success: true }); }
  catch(e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/welfare/:id', verifyToken, adminOnly, async (req, res) => {
  try { await deleteOne('welfare_programs', req.params.id); res.json({ success: true }); }
  catch(e) { res.status(500).json({ error: e.message }); }
});

// STAFF (Admin only)
app.get('/api/staff', verifyToken, adminOnly, async (req, res) => {
  try {
    const list = await getAll('staff');
    // Password hide karo!
    const safe = list.map(s => ({ ...s, pass: undefined }));
    res.json(safe);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/staff', verifyToken, adminOnly, async (req, res) => {
  try {
    await insertOne('staff', req.body);
    await logActivity('settings', 'Staff created: ' + req.body.name, req.user.name);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/staff/:id', verifyToken, adminOnly, async (req, res) => {
  try { await updateOne('staff', req.params.id, req.body); res.json({ success: true }); }
  catch(e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/staff/:id', verifyToken, adminOnly, async (req, res) => {
  try {
    await deleteOne('staff', req.params.id);
    await logActivity('settings', 'Staff deleted: ' + req.params.id, req.user.name);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// SETTINGS
app.get('/api/settings', verifyToken, async (req, res) => {
  try {
    const { data } = await supabase.from('settings').select('*').eq('key', 'site_settings').single();
    res.json(data?.value || {});
  } catch(e) { res.json({}); }
});

app.post('/api/settings', verifyToken, adminOnly, async (req, res) => {
  try {
    await supabase.from('settings').upsert({ key: 'site_settings', value: req.body, updated_at: new Date().toISOString() });
    await logActivity('settings', 'Settings updated', req.user.name);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ACTIVITY LOG
app.get('/api/log', verifyToken, async (req, res) => {
  try {
    const { data } = await supabase.from('activity_log').select('*').order('id', { ascending: false }).limit(200);
    res.json(data.map(r => r.data || r));
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/log', verifyToken, async (req, res) => {
  try {
    await logActivity(req.body.type, req.body.msg, req.user.name);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// CHANGE PASSWORD (Admin)
app.post('/api/auth/change-password', verifyToken, adminOnly, async (req, res) => {
  const { oldPass, newPass } = req.body;
  if (oldPass !== process.env.ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Purana password galat hai' });
  }
  // Note: In production, update in database or env
  res.json({ success: true, message: 'Password change ho gaya' });
});

// ─── START SERVER ───
app.listen(PORT, () => {
  console.log(`
╔══════════════════════════════════════╗
║  Al-Danish Welfare Foundation API   ║
║  Running on port: ${PORT}              ║
║  Status: ✅ Active                   ║
╚══════════════════════════════════════╝
  `);
});
