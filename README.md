# Al-Danish Welfare Foundation — Backend API

## Deploy karne ka tarika (Railway.app)

### Step 1 — GitHub pe upload karo
1. GitHub pe naya repository banao: `aldanish-backend`
2. Yeh saari files upload karo
3. `.env` file upload MAT karo! (sensitive data hai)

### Step 2 — Railway.app pe deploy
1. railway.app kholo
2. GitHub se login karo
3. "New Project" → "Deploy from GitHub"
4. `aldanish-backend` repository select karo
5. Deploy ho jaayega!

### Step 3 — Environment Variables set karo
Railway Dashboard → Variables → Add:
```
SUPABASE_URL=https://oazehjsrilxraeigabaf.supabase.co
SUPABASE_SERVICE_KEY=your_service_role_key
GEMINI_API_KEY=AIzaSyDKeUj9VpqumGYeunLX9unuG1hngslj9Z4
GEMINI_MODEL=gemini-2.0-flash-exp
ADMIN_USERNAME=admin.usman
ADMIN_PASSWORD=M.usman1966
ADMIN_OTP=05010711
JWT_SECRET=aldanish_2026_super_secret
PORT=3000
```

### Step 4 — Backend URL milegi
Railway pe deploy hone ke baad URL milegi jaise:
`https://aldanish-backend-production.up.railway.app`

### Step 5 — Frontend update karo
`config.js` mein yeh URL dalo:
```js
API_URL: 'https://aldanish-backend-production.up.railway.app'
```

## API Endpoints

| Method | Route | Description |
|--------|-------|-------------|
| POST | /api/auth/login | Login |
| POST | /api/auth/verify-otp | OTP verify |
| GET | /api/donors | Donors list |
| POST | /api/donors | Donor add |
| DELETE | /api/donors/:id | Donor delete |
| GET | /api/patients | Patients list |
| POST | /api/ai/chat | AI chatbot |
| POST | /api/ai/scan | Document scan |

## Security Features
- ✅ JWT Authentication
- ✅ Rate Limiting (brute force protection)
- ✅ CORS (sirf allowed domains)
- ✅ Admin-only routes
- ✅ API keys server pe hidden
- ✅ Passwords server pe hidden
