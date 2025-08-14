// src/App.jsx
import { useEffect, useMemo, useState } from 'react';
import { supabase } from './lib/supabase';
import { SITE_URL } from './config';
import { LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, ResponsiveContainer } from 'recharts';

// Movements by weekday (units set)
const MOVEMENTS = {
  Sunday:    { key: 'sun', name: '3 Rep Max Landmine clean', unit: 'lbs' },
  Monday:    { key: 'mon', name: '6 Rep Reverse Lunge Max', unit: 'lbs' },
  Tuesday:   { key: 'tue', name: 'Max power Keiser Push/Pull', unit: 'watts' },
  Wednesday: { key: 'wed', name: 'Max Treadmill Speed', unit: 'mph' },
  Thursday:  { key: 'thu', name: '6 Rep Max Kickstand RDL', unit: 'lbs' },
  Friday:    { key: 'fri', name: '6 Rep Max S/A Pull Down', unit: 'lbs' },
  Saturday:  { key: 'sat', name: 'Max distance 30 sec assault bike', unit: 'miles' },
};

// Helpers
const iso = (d) => d.toISOString().slice(0, 10);
const dayName = (d) => d.toLocaleDateString('en-US', { weekday: 'long' });
const monthLabel = (d) => d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
const range = (n) => Array.from({ length: n }, (_, i) => i);

// Parse #hash params like access_token, refresh_token, etc. (when link opens in browser)
function parseHash() {
  if (!window.location.hash || window.location.hash.length < 2) return {};
  return window.location.hash
    .substring(1)
    .split('&')
    .map(pair => pair.split('='))
    .reduce((acc, [k, v]) => {
      acc[decodeURIComponent(k)] = decodeURIComponent(v || '');
      return acc;
    }, {});
}

export default function App() {
  // Auth/session
  const [session, setSession] = useState(null);

  // Login state (supports magic link, paste, and 6-digit OTP)
  const [email, setEmail]     = useState('');
  const [pasted, setPasted]   = useState(''); // paste magic link or code
  const [otp, setOtp]         = useState(''); // 6-digit code

  // Profile (also mirrored locally)
  const [profileOpen, setProfileOpen] = useState(false);
  const [name,   setName]   = useState(localStorage.getItem('mom3nt_name')   || '');
  const [gender, setGender] = useState(localStorage.getItem('mom3nt_gender') || '');

  // UI
  const [tab, setTab]                 = useState('calendar'); // calendar | database | leaderboard
  const [monthDate, setMonthDate]     = useState(new Date());
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [inputVal, setInputVal]       = useState('');

  // Data
  const [entries, setEntries] = useState([]);

  // Handle magic link tokens (if opened in browser) + subscribe to auth changes
  useEffect(() => {
    let sub;
    (async () => {
      const h = parseHash();
      if (h.error_description) alert(h.error_description.replace(/\+/g, ' '));

      if (h.access_token && h.refresh_token) {
        try {
          const { data, error } = await supabase.auth.setSession({
            access_token: h.access_token,
            refresh_token: h.refresh_token,
          });
          if (error) console.error('setSession error:', error);
          setSession(data?.session ?? null);
        } catch (e) {
          console.error('setSession threw:', e);
        } finally {
          // remove hash/query from URL
          const url = new URL(window.location.href);
          window.history.replaceState({}, document.title, url.origin + url.pathname);
        }
      } else {
        const { data } = await supabase.auth.getSession();
        setSession(data.session ?? null);
      }

      const res = supabase.auth.onAuthStateChange((_event, s) => setSession(s));
      sub = res.data?.subscription;
    })();
    return () => { if (sub) sub.unsubscribe(); };
  }, []);

  // Load entries + profile once logged in
  useEffect(() => {
    if (!session) return;
    (async () => {
      const { data: eData } = await supabase
        .from('entries')
        .select('*')
        .order('date', { ascending: true });
      setEntries(eData || []);

      const { data: pData } = await supabase
        .from('profiles')
        .select('name, gender')
        .eq('id', session.user.id)
        .maybeSingle();

      if (pData) {
        if (pData.name)   setName(pData.name);
        if (pData.gender) setGender(pData.gender);
        localStorage.setItem('mom3nt_name',   pData.name   || '');
        localStorage.setItem('mom3nt_gender', pData.gender || '');
      }
    })();
  }, [session]);

  // Keep local mirror updated
  useEffect(() => {
    localStorage.setItem('mom3nt_name',   name   || '');
    localStorage.setItem('mom3nt_gender', gender || '');
  }, [name, gender]);

  // Save profile
  async function saveProfile() {
    if (!session) return;
    const trimmed = (name || '').trim();
    const g = gender || null;
    const { error } = await supabase.from('profiles').upsert({
      id: session.user.id,
      name: trimmed || null,
      gender: g
    });
    if (error) return alert(error.message);
    alert('Profile saved!');
    setProfileOpen(false);
  }

  function movementForDate(d) {
    return MOVEMENTS[dayName(d)];
  }

  // Save an entry
  async function saveEntry() {
    if (!session) return alert('Please sign in first.');
    if (!name.trim() || !gender) { setProfileOpen(true); return; }
    const v = parseFloat(inputVal);
    if (!v || v <= 0) return alert('Enter a positive number.');

    const mov = movementForDate(selectedDate);
    const row = {
      user_id: session.user.id,
      date: iso(selectedDate),
      movement: mov.name,
      value: v,
      unit: mov.unit,
      name: name.trim(),
      gender
    };

    const { error } = await supabase.from('entries').insert(row);
    if (error) return alert(error.message);
    setInputVal('');

    const { data } = await supabase.from('entries').select('*').order('date', { ascending: true });
    setEntries(data || []);
  }

  // LOGIN helpers
  async function sendMagicLink() {
    if (!email) return alert('Enter your email');
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: SITE_URL } // your deployed URL
    });
    if (error) alert(error.message);
    else alert('Magic link sent!\n\niPhone PWA tip: press-and-hold the email link → Copy Link.\nReturn here and paste below, or use the 6-digit code.');
  }

  // Robust paste handler: handles ?code=, ?token[_hash]=, and #access_token
  async function signInWithPasted() {
    const raw = (pasted || '').trim();
    if (!raw) return alert('Paste the email link or the code');
    if (!email) return alert('Enter your email above first.');

    let code = null;
    let token = null;
    let token_hash = null;
    let type = null;
    let access_token = null;
    let refresh_token = null;

    // Try parsing as a URL
    try {
      const u = new URL(raw);
      const sp = u.searchParams;

      // 1) PKCE code: /?code=...
      code = sp.get('code');

      // 2) Magic link variants:
      //    /verify?type=magiclink&token=...
      //    /verify?type=magiclink&token_hash=...
      token = sp.get('token');
      token_hash = sp.get('token_hash');
      type = sp.get('type');

      // 3) Hash tokens: #access_token=...&refresh_token=...
      if (u.hash && u.hash.length > 1) {
        const hp = new URLSearchParams(u.hash.substring(1));
        access_token = hp.get('access_token');
        refresh_token = hp.get('refresh_token');
      }
    } catch {
      // Not a URL; maybe it’s just a 6-digit code
    }

    try {
      // A) Direct hash tokens (PWA friendly)
      if (access_token && refresh_token) {
        const { data, error } = await supabase.auth.setSession({ access_token, refresh_token });
        if (error) throw error;
        setSession(data?.session || null);
        return;
      }

      // B) PKCE code (/?code=...)
      if (code) {
        const { data, error } = await supabase.auth.exchangeCodeForSession(code);
        if (error) throw error;
        setSession(data?.session || null);
        return;
      }

      // C) Magic link with token or token_hash
      if ((token || token_hash) && (type === 'magiclink' || type === 'recovery' || type === 'email_change')) {
        // Try token first (email required)…
        if (token) {
          const { data, error } = await supabase.auth.verifyOtp({
            email,
            token,
            type // 'magiclink'
          });
          if (!error) {
            setSession(data?.session || null);
            return;
          }
          // If token didn’t work, fall through and try token_hash style.
        }
        // …then try token_hash variant (no email needed)
        const { data, error } = await supabase.auth.verifyOtp({
          token_hash: token_hash || token,
          type // 'magiclink'
        });
        if (error) throw error;
        setSession(data?.session || null);
        return;
      }

      // D) Raw 6-digit code (email OTP)
      if (/^\d{6}$/.test(raw)) {
        const { data, error } = await supabase.auth.verifyOtp({
          email,
          token: raw,
          type: 'email'
        });
        if (error) throw error;
        setSession(data?.session || null);
        return;
      }
    } catch (e) {
      alert(e.message);
      return;
    }

    alert('Could not find a token or code. Copy the full link (or code) from the email and paste it here.');
  }

  // 6-digit email code (best for iPhone PWA)
  async function verifySixDigitCode() {
    if (!email) return alert('Enter your email above first');
    if (!/^\d{6}$/.test(otp.trim())) return alert('Enter the 6-digit code from the email');

    const { data, error } = await supabase.auth.verifyOtp({
      email,
      token: otp.trim(),
      type: 'email'
    });
    if (error) return alert(error.message);
    setSession(data?.session || null);
  }

  // My entries only
  const myEntries = useMemo(() => {
    if (!session) return [];
    return entries.filter(e => e.user_id === session.user.id);
  }, [entries, session]);

  // Series per movement (my data only)
  const seriesByMovement = useMemo(() => {
    const map = {};
    Object.values(MOVEMENTS).forEach(m => { map[m.name] = []; });
    for (const e of myEntries) {
      map[e.movement]?.push({ date: e.date, value: Number(e.value) });
    }
    Object.keys(map).forEach(k => map[k].sort((a,b)=>a.date.localeCompare(b.date)));
    return map;
  }, [myEntries]);

  // Leaderboard for today — Top 5 per gender, one record per person (best)
  const todaysMovement = movementForDate(new Date());
  const leaderboard = useMemo(() => {
    const rows = entries.filter(e => e.movement === todaysMovement.name && (e.gender === 'male' || e.gender === 'female'));
    const bestMale = new Map();
    const bestFemale = new Map();
    for (const r of rows) {
      const key = (r.name || 'Member').trim() || 'Member';
      const bucket = r.gender === 'male' ? bestMale : bestFemale;
      const prev = bucket.get(key);
      if (!prev || Number(r.value) > Number(prev.value)) bucket.set(key, r);
    }
    const top5 = (m) => Array.from(m.values()).sort((a,b)=>Number(b.value)-Number(a.value)).slice(0,5);
    return { male: top5(bestMale), female: top5(bestFemale) };
  }, [entries, todaysMovement.name]);

  // --------- LOGGED-OUT UI ----------
  if (!session) {
    return (
      <div style={{display:'grid',placeItems:'center',height:'100vh',background:'#000',color:'#fff',textAlign:'center',padding:16}}>
        <div style={{maxWidth:360, width:'100%', background:'#111', borderRadius:12, padding:16, border:'1px solid #333'}}>
          <h1 style={{marginBottom:8}}>MOM3NT DATA</h1>
          <p style={{marginBottom:12, opacity:.9}}>Sign in with a magic link, paste the link/code, or use the 6-digit code.</p>

          {/* Email (white text on dark bg) */}
          <input
            type="email"
            placeholder="you@example.com"
            value={email}
            onChange={(e)=>setEmail(e.target.value)}
            style={{
              width:'100%',
              padding:'10px',
              borderRadius:10,
              border:'1px solid #444',
              marginBottom:8,
              background:'#111',
              color:'#fff'
            }}
          />

          {/* Send link */}
          <button
            onClick={sendMagicLink}
            style={{
              width:'100%',
              padding:'10px',
              borderRadius:10,
              border:'1px solid #111',
              background:'#dca636',
              color:'#000',
              fontWeight:700
            }}
          >
            Send Magic Link
          </button>

          {/* Paste link or code */}
          <div style={{textAlign:'left', fontSize:12, marginTop:12, marginBottom:6, opacity:.9}}>
            Or paste the email link (or just the code):
          </div>
          <input
            type="text"
            placeholder="Paste magic link or code here"
            value={pasted}
            onChange={(e)=>setPasted(e.target.value)}
            style={{
              width:'100%',
              padding:'10px',
              borderRadius:10,
              border:'1px solid #444',
              marginBottom:8,
              background:'#111',
              color:'#fff',
              letterSpacing:1
            }}
          />
          <button
            onClick={signInWithPasted}
            style={{
              width:'100%',
              padding:'10px',
              borderRadius:10,
              border:'1px solid #333',
              background:'#fff',
              color:'#000',
              fontWeight:700
            }}
          >
            Sign In with Pasted Link/Code
          </button>

          {/* 6-digit code (most reliable for iPhone PWA) */}
          <div style={{textAlign:'left', fontSize:12, marginTop:12, marginBottom:6, opacity:.9}}>
            Or enter the 6-digit code from the email:
          </div>
          <input
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            placeholder="Enter 6-digit code"
            value={otp}
            onChange={(e)=>setOtp(e.target.value)}
            style={{
              width:'100%',
              padding:'10px',
              borderRadius:10,
              border:'1px solid #444',
              marginBottom:8,
              background:'#111',
              color:'#fff',
              letterSpacing:2,
              textAlign:'center'
            }}
          />
          <button
            onClick={verifySixDigitCode}
            style={{
              width:'100%',
              padding:'10px',
              borderRadius:10,
              border:'1px solid #333',
              background:'#fff',
              color:'#000',
              fontWeight:700
            }}
          >
            Sign In with Code
          </button>
        </div>
      </div>
    );
  }
  // -----------------------------------

  // Calendar grid (mobile friendly)
  function CalendarGrid() {
    const y = monthDate.getFullYear();
    const m = monthDate.getMonth();
    const first = new Date(y, m, 1);
    const start = first.getDay(); // 0 Sun
    const days = new Date(y, m + 1, 0).getDate();
    const cells = [...range(start).map(() => null), ...range(days).map(d => new Date(y, m, d + 1))];

    return (
      <div style={{display:'grid',gridTemplateColumns:'repeat(7, 1fr)',gap:6}}>
        {['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map(d => (
          <div key={d} style={{fontSize:12,color:'#666',textAlign:'center'}}>{d}</div>
        ))}
        {cells.map((d,i) => {
          if (!d) return <div key={`sp-${i}`} />;
          const sel = iso(d) === iso(selectedDate);
          const today = iso(d) === iso(new Date());
          const mov = movementForDate(d);
          return (
            <button
              key={d.toISOString()}
              onClick={() => setSelectedDate(d)}
              style={{
                height:64,borderRadius:12,border:'1px solid #eee',
                background: sel ? '#000' : '#fff',
                color: sel ? '#fff' : '#111',
                outline: today ? '2px solid #dca636' : 'none',
                display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center
