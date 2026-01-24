// src/App.jsx
import { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from './lib/supabase';
import { SITE_URL } from './config';
import { LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, ResponsiveContainer } from 'recharts';

/* ================= Helpers ================= */
const isoLocal = (d) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};
const dayName = (d) => d.toLocaleDateString('en-US', { weekday: 'long' });
const monthLabel = (d) => d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
const range = (n) => Array.from({ length: n }, (_, i) => i);
const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const formatNiceNumber = (val) => {
  const n = Number(val);
  if (!Number.isFinite(n)) return '';
  const abs = Math.abs(n);
  if (abs >= 1000) return Math.round(n).toLocaleString();
  if (abs >= 100) return Math.round(n).toString();
  if (abs >= 10) return Math.round(n).toString();
  if (abs >= 1) return n.toFixed(1).replace(/\.0$/, '');
  return n.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
};
// Preserve actual value precision for data points: truncate, do not round
const formatExactValue = (val) => {
  const n = Number(val);
  if (!Number.isFinite(n)) return '';
  const truncated = Math.trunc(n * 100) / 100; // keep up to 2 decimals without rounding
  const hasDecimals = Math.abs(truncated % 1) > 0;
  const oneDecimal = Math.abs(Math.trunc(truncated * 10) / 10 - Math.trunc(truncated)) > 0;
  const minFrac = 0;
  const maxFrac = hasDecimals ? (oneDecimal ? 1 : 2) : 0;
  return truncated.toLocaleString(undefined, { minimumFractionDigits: minFrac, maximumFractionDigits: maxFrac });
};

/* ========== Movements & Cycles ========== */
// Legacy block before Sep 1 (your original 7)
const LEGACY_MOVEMENTS = {
  Sunday:    { key: 'sun', name: '3 Rep Max Landmine clean', unit: 'lbs' },
  Monday:    { key: 'mon', name: '6 Rep Reverse Lunge Max', unit: 'lbs' },
  Tuesday:   { key: 'tue', name: 'Max power Keiser Push/Pull', unit: 'watts' },
  Wednesday: { key: 'wed', name: 'Max Treadmill Speed', unit: 'mph' },
  Thursday:  { key: 'thu', name: '6 Rep Max Kickstand RDL', unit: 'lbs' },
  Friday:    { key: 'fri', name: '6 Rep Max S/A Pull Down', unit: 'lbs' },
  Saturday:  { key: 'sat', name: 'Max distance 30 sec assault bike', unit: 'miles' },
};

// Previous 8-week cycle window (explicit for July 6 – Aug 31)
const PREV_CYCLE_START = new Date('2025-07-06'); // Sunday
const PREV_CYCLE_END   = new Date('2025-08-31'); // Sunday
const PREV_WEEK_TEMPLATE = { ...LEGACY_MOVEMENTS };

// Sep cycle: 6 weeks (Sep 1 – Oct 12, 2025)
const SEPT_CYCLE_START = new Date('2025-09-01'); // Monday
const SEPT_CYCLE_WEEKS = 6;
const SEPT_WEEK_TEMPLATE = {
  Monday:    { key: 'w_mon', name: '6 Rep Bulgarian Split Squat', unit: 'lbs' },
  Tuesday:   { key: 'w_tue', name: '6 Rep DB Floor Press',        unit: 'lbs' },
  Wednesday: { key: 'w_wed', name: '.1 Distance Run',              unit: 'time' },
  Thursday:  { key: 'w_thu', name: '6 Rep Smith RDL',              unit: 'lbs' },
  Friday:    { key: 'w_fri', name: 'Pull Up + Push Press EDT',     unit: 'rounds' },
  Saturday:  { key: 'w_sat', name: 'Ski/Curl/Squat METCON',        unit: 'time' },
  Sunday:    { key: 'w_sun', name: 'Keiser Rotate to Press',       unit: 'watts' },
};

// Oct cycle: 6 weeks (Oct 13 – Nov 23, 2025)
const OCT_CYCLE_START = new Date('2025-10-13'); // Monday
const OCT_CYCLE_WEEKS = 6;
const OCT_WEEK_TEMPLATE = {
  Monday:    { key: 'o_mon', name: 'Barbell Box Squat',            unit: 'lbs' },
  Tuesday:   { key: 'o_tue', name: 'Barbell Block Bench Press',    unit: 'lbs' },
  Wednesday: { key: 'o_wed', name: '.25 Assault Bike',             unit: 'time' }, // lower is better
  Thursday:  { key: 'o_thu', name: 'Kickstand Landmine RDL',       unit: 'lbs' },
  Friday:    { key: 'o_fri', name: 'Half Kneeling S/A DB Press',   unit: 'lbs' },
  Saturday:  { key: 'o_sat', name: '.25 Distance Run',             unit: 'time' }, // lower is better
  Sunday:    { key: 'o_sun', name: 'Kettlebell Complex',           unit: 'lbs' },
};

// Nov–Jan cycle: 6 weeks (Nov 24, 2025 – Jan 4, 2026)
const NOV_CYCLE_START = new Date('2025-11-24'); // Monday
const NOV_CYCLE_WEEKS = 6;
const NOV_WEEK_TEMPLATE = {
  Monday:    { key: 'n_mon', name: 'Keiser Belt Squat',         unit: 'watts' },
  Tuesday:   { key: 'n_tue', name: 'S/A Tempo DB Row',          unit: 'lbs' },
  Wednesday: { key: 'n_wed', name: 'Keiser Step Chop',          unit: 'watts' },
  Thursday:  { key: 'n_thu', name: 'Barbell Hip Thrust',        unit: 'lbs' },
  Friday:    { key: 'n_fri', name: 'S/A Kneeling Pull Down',    unit: 'kgs' },
  Saturday:  { key: 'n_sat', name: '200 Meter Ski',             unit: 'time' }, // lower is better
  Sunday:    { key: 'n_sun', name: 'Landmine Clean + Jerk',     unit: 'lbs' },
};

// NEW Jan–Feb cycle: 6 weeks (Jan 12, 2026 – Feb 22, 2026)
const JAN_CYCLE_START = new Date('2026-01-12'); // Monday
const JAN_CYCLE_WEEKS = 6;
const JAN_WEEK_TEMPLATE = {
  Monday:    { key: 'j_mon', name: 'Landmine kickstand squat 6 RM',          unit: 'lbs' },
  Tuesday:   { key: 'j_tue', name: 'Seated Cable Bench Row 6 RM',            unit: 'kgs' },
  Wednesday: { key: 'j_wed', name: 'Keiser Bar Chop Max Power',              unit: 'watts' },
  Thursday:  { key: 'j_thu', name: 'Smith Bulgarian Split Squat 6 RM',       unit: 'lbs' },
  Friday:    { key: 'j_fri', name: 'Smith Pin Press 6 RM',                   unit: 'lbs' },
  Saturday:  { key: 'j_sat', name: 'Treadmill 30 Sec Max Distance',          unit: 'miles' },
  Sunday:    { key: 'j_sun', name: 'S/A Kickstand KB Clean',                 unit: 'lbs' },
};

// Cycles in order (Prev → Sep → Oct → Nov/Jan → Jan/Feb)
const CYCLES = [
  { start: PREV_CYCLE_START, endOverride: PREV_CYCLE_END, weekTemplate: PREV_WEEK_TEMPLATE },
  { start: SEPT_CYCLE_START, weeks: SEPT_CYCLE_WEEKS,     weekTemplate: SEPT_WEEK_TEMPLATE },
  { start: OCT_CYCLE_START,  weeks: OCT_CYCLE_WEEKS,      weekTemplate: OCT_WEEK_TEMPLATE },
  { start: NOV_CYCLE_START,  weeks: NOV_CYCLE_WEEKS,      weekTemplate: NOV_WEEK_TEMPLATE },
  { start: JAN_CYCLE_START,  weeks: JAN_CYCLE_WEEKS,      weekTemplate: JAN_WEEK_TEMPLATE },
];

function getCycleBounds(cycle) {
  const start = startOfDay(cycle.start);
  if (cycle.endOverride) return { start, end: startOfDay(cycle.endOverride) };
  const end = new Date(start);
  end.setDate(end.getDate() + (cycle.weeks ?? 0) * 7 - 1);
  return { start, end };
}
function getCycleForDate(d) {
  const day = startOfDay(d);
  for (const c of CYCLES) {
    const { start, end } = getCycleBounds(c);
    if (day >= start && day <= end) return c;
  }
  return null;
}
function getCurrentCycleIndex(date = new Date()) {
  const day = startOfDay(date);
  for (let i = 0; i < CYCLES.length; i++) {
    const { start, end } = getCycleBounds(CYCLES[i]);
    if (day >= start && day <= end) return i;
  }
  return -1;
}
function isWithinISO(dateISO, start, end) {
  const d = new Date(dateISO + 'T00:00:00');
  return d >= start && d <= end;
}
const WEEKDAY_ORDER = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
function movementsFromTemplate(weekTemplate) {
  return WEEKDAY_ORDER.map(weekday => {
    const mov = weekTemplate[weekday];
    return mov ? { weekday, ...mov } : null;
  }).filter(Boolean);
}

/* ========== URL hash parser ========== */
function parseHash() {
  if (!window.location.hash || window.location.hash.length < 2) return {};
  return window.location.hash
    .substring(1)
    .split('&')
    .map((pair) => pair.split('='))
    .reduce((acc, [k, v]) => {
      acc[decodeURIComponent(k)] = decodeURIComponent(v || '');
      return acc;
    }, {});
}

/* ========== iOS-sticky numeric input ========== */
function NumberField({ value, onChange, placeholder, width = 160, allowDecimal = true }) {
  const ref = useRef(null);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    if (!editing) return;
    const el = ref.current;
    if (!el) return;
    if (document.activeElement !== el) {
      el.focus({ preventScroll: true });
      const len = el.value.length;
      try { el.setSelectionRange(len, len); } catch {}
    }
  }, [value, editing]);

  const sanitize = (raw) => {
    if (allowDecimal) {
      let next = raw.replace(/[^\d.]/g, '');
      const firstDot = next.indexOf('.');
      if (firstDot !== -1) {
        next = next.slice(0, firstDot + 1) + next.slice(firstDot + 1).replace(/\./g, '');
      }
      return next;
    }
    return raw.replace(/\D/g, '');
  };

  return (
    <input
      ref={ref}
      type="tel"
      inputMode={allowDecimal ? 'decimal' : 'numeric'}
      autoCorrect="off"
      autoCapitalize="none"
      enterKeyHint="done"
      placeholder={placeholder}
      value={value}
      onFocus={() => setEditing(true)}
      onBlur={() => setTimeout(() => setEditing(false), 50)}
      onChange={(e) => onChange(sanitize(e.target.value))}
      style={{
        padding: 10,
        border: '1px solid #ddd',
        borderRadius: 10,
        width,
        boxSizing: 'border-box',
      }}
    />
  );
}

/* ---- Movement for a date ---- */
function movementForDate(d) {
  const cycle = getCycleForDate(d);
  if (cycle) {
    const mov = cycle.weekTemplate[dayName(d)];
    if (mov) return mov;
  }
  return { key: 'tbd', name: 'TBD', unit: '' };
}

/* ---- Helper: lookup unit by movement name (for leaderboard dropdown) ---- */
function getMovementUnitByName(movementName) {
  if (!movementName) return '';
  for (const cy of CYCLES) {
    for (const [, m] of Object.entries(cy.weekTemplate)) {
      if (m?.name === movementName) return m.unit || '';
    }
  }
  for (const [, m] of Object.entries(LEGACY_MOVEMENTS)) {
    if (m?.name === movementName) return m.unit || '';
  }
  return '';
}

/* ================= App ================= */
export default function App() {
  // Auth
  const [session, setSession] = useState(null);

  // Login
  const [email, setEmail] = useState('');
  const [otp, setOtp] = useState('');

  // Profile
  const [profileOpen, setProfileOpen] = useState(false);
  const [name, setName] = useState(localStorage.getItem('mom3nt_name') || '');
  const [gender, setGender] = useState(localStorage.getItem('mom3nt_gender') || '');

  // UI
  const [tab, setTab] = useState('calendar'); // calendar | database | leaderboard
  const [monthDate, setMonthDate] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [inputVal, setInputVal] = useState('');
  const [inputNotes, setInputNotes] = useState('');
  const [dbView, setDbView] = useState('this'); // 'this' | 'prev' | 'all'
  const [isMobile, setIsMobile] = useState(false);

  // Leaderboard dropdown
  const [lbMovementName, setLbMovementName] = useState('');

  // Data
  const [entries, setEntries] = useState([]);

  /* ---- Auth flow ---- */
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
          window.history.replaceState({}, document.title, window.location.pathname + window.location.search);
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

  // Load entries & profile
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
        if (pData.name) setName(pData.name);
        if (pData.gender) setGender(pData.gender);
        localStorage.setItem('mom3nt_name', pData.name || '');
        localStorage.setItem('mom3nt_gender', pData.gender || '');
      }
    })();
  }, [session]);

  // Persist local mirror
  useEffect(() => {
    localStorage.setItem('mom3nt_name', name || '');
    localStorage.setItem('mom3nt_gender', gender || '');
  }, [name, gender]);

  // Mobile detection
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 768px)');
    const apply = () => setIsMobile(mq.matches);
    apply();
    mq.addEventListener ? mq.addEventListener('change', apply) : mq.addListener(apply);
    return () => {
      mq.removeEventListener ? mq.removeEventListener('change', apply) : mq.removeListener(apply);
    };
  }, []);

  /* ---- Prefill value/notes when selecting a day (carry forward notes for same movement) ---- */
  useEffect(() => {
    if (!session) return;

    const targetISO = isoLocal(selectedDate);
    const mine = entries.filter(e => e.user_id === session.user.id);

    // If there’s already an entry for the selected date, use it.
    const existing = mine.find(e => e.date === targetISO);
    if (existing) {
      setInputVal(existing.value != null ? String(existing.value) : '');
      setInputNotes(existing.notes || '');
      return;
    }

    // Otherwise, carry forward notes from the most recent prior entry for the same movement.
    const mov = movementForDate(selectedDate);
    const priorForMovement = mine
      .filter(e => e.movement === mov.name && e.date < targetISO)
      .sort((a, b) => a.date.localeCompare(b.date))
      .pop();

    setInputVal('');
    setInputNotes(priorForMovement?.notes || '');
  }, [selectedDate, session, entries]);

  /* ---- Save profile ---- */
  async function saveProfile() {
    if (!session) return;
    const trimmed = (name || '').trim();
    const g = gender || null;
    const { error } = await supabase.from('profiles').upsert({
      id: session.user.id,
      name: trimmed || null,
      gender: g,
    });
    if (error) return alert(error.message);
    alert('Profile saved!');
    setProfileOpen(false);
  }

  /* ---- Save entry (UPSERT on user_id+date) ---- */
  async function saveEntry() {
    if (!session) return alert('Please sign in first (use code).');
    if (!name.trim() || !gender) { setProfileOpen(true); return; }

    const mov = movementForDate(selectedDate);
    if (mov.name === 'TBD') {
      alert('This date is not in an active cycle yet. Entry is disabled.');
      return;
    }

    const v = parseFloat(inputVal);
    if (!v || v <= 0) return alert('Enter a positive number.');

    const notes = (inputNotes || '').trim();

    // Clear inputs after save click (keeps UI snappy)
    setInputVal('');
    setInputNotes('');

    const row = {
      user_id: session.user.id,
      date: isoLocal(selectedDate),
      movement: mov.name,
      value: v,
      unit: mov.unit,
      name: name.trim(),
      gender,
      notes: notes || null,
    };

    const { error } = await supabase
      .from('entries')
      .upsert(row, { onConflict: ['user_id', 'date'] }); // unique on (user_id,date)
    if (error) return alert(error.message);

    const { data } = await supabase.from('entries').select('*').order('date', { ascending: true });
    setEntries(data || []);
  }

  const myEntries = useMemo(() => {
    if (!session) return [];
    return entries.filter((e) => e.user_id === session.user.id);
  }, [entries, session]);

  /* ---- Leaderboard ---- */
  const todaysMovement = movementForDate(new Date());

  const leaderboardOptions = useMemo(() => {
    const idx = getCurrentCycleIndex(new Date());
    const currentCycle = idx >= 0 ? CYCLES[idx] : CYCLES[CYCLES.length - 1];
    if (!currentCycle) return [];
    return WEEKDAY_ORDER
      .map(wd => currentCycle.weekTemplate[wd])
      .filter(Boolean)
      .map(m => ({ name: m.name, unit: m.unit || '' }));
  }, []);

  useEffect(() => {
    const todayName =
      (todaysMovement && todaysMovement.name !== 'TBD')
        ? todaysMovement.name
        : (leaderboardOptions[0]?.name || '');
    setLbMovementName(prev => prev || todayName);
  }, [todaysMovement, leaderboardOptions]);

  const leaderboard = useMemo(() => {
    if (!lbMovementName) return { male: [], female: [], unit: '' };
    const movementUnit = getMovementUnitByName(lbMovementName);
    const LOWER_BETTER_MOVES = new Set(['.1 Distance Run', '.25 Assault Bike', '.25 Distance Run', '200 Meter Ski']);
    const lowerIsBetter = movementUnit === 'time' || LOWER_BETTER_MOVES.has(lbMovementName);
    const rows = entries.filter(
      (e) =>
        e.movement === lbMovementName &&
        (e.gender === 'male' || e.gender === 'female')
    );
    const bestMale = new Map();
    const bestFemale = new Map();
    const isBetter = (newVal, prevVal) =>
      lowerIsBetter ? Number(newVal) < Number(prevVal) : Number(newVal) > Number(prevVal);

    for (const r of rows) {
      const key = (r.name || 'Member').trim() || 'Member';
      const bucket = r.gender === 'male' ? bestMale : bestFemale;
      const prev = bucket.get(key);
      if (!prev || isBetter(r.value, prev.value)) bucket.set(key, r);
    }

    const sortFn = lowerIsBetter
      ? (a, b) => Number(a.value) - Number(b.value)
      : (a, b) => Number(b.value) - Number(a.value);

    const top5 = (m) => Array.from(m.values()).sort(sortFn).slice(0, 5);
    return { male: top5(bestMale), female: top5(bestFemale), unit: movementUnit };
  }, [entries, lbMovementName]);

  /* ---------- LOGIN UI ---------- */
  if (!session) {
    async function sendCode() {
      if (!email) return alert('Enter your email');
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: SITE_URL },
      });
      if (error) alert(error.message);
      else alert('Code sent! Check your email for the 6-digit code.');
    }
    async function verifySixDigitCode() {
      if (!email) return alert('Enter your email above first');
      if (!/^\d{6}$/.test((otp || '').trim()))
        return alert('Enter the 6-digit code from the email');
      const { data, error } = await supabase.auth.verifyOtp({
        email,
        token: otp.trim(),
        type: 'email',
      });
      if (error) return alert(error.message);
      setSession(data?.session || null);
    }

    return (
      <div style={{display:'grid',placeItems:'center',height:'100vh',background:'#000',color:'#fff',textAlign:'center',padding:16}}>
        <div style={{maxWidth:360, width:'100%', background:'#111', borderRadius:12, padding:16, border:'1px solid #333'}}>
          <h1 style={{marginBottom:8}}>MOM3NT DATA</h1>
          <p style={{marginBottom:12, opacity:.9}}>Sign in with the 6-digit code sent to your email.</p>
          <input
            type="email"
            placeholder="you@example.com"
            value={email}
            onChange={(e)=>setEmail(e.target.value)}
            style={{width:'100%',padding:'10px',borderRadius:10,border:'1px solid #444',marginBottom:8,background:'#111',color:'#fff'}}
          />
          <button
            onClick={sendCode}
            style={{width:'100%',padding:'10px',borderRadius:10,border:'1px solid #111',background:'#dca636',color:'#000',fontWeight:700,marginBottom:12}}
          >
            Send Code
          </button>
          <input
            type="tel"
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={6}
            placeholder="Enter 6-digit code"
            value={otp}
            onChange={(e)=>setOtp(e.target.value.replace(/\D/g,''))}
            style={{width:'100%',padding:'10px',borderRadius:10,border:'1px solid #444',marginBottom:8,background:'#111',color:'#fff',letterSpacing:2,textAlign:'center',fontWeight:700}}
          />
          <button
            onClick={verifySixDigitCode}
            style={{width:'100%',padding:'10px',borderRadius:10,border:'1px solid #333',background:'#fff',color:'#000',fontWeight:700}}
          >
            Verify & Sign In
          </button>
        </div>
      </div>
    );
  }

  /* ---------- Main UI ---------- */
  return (
    <div style={{fontFamily:'system-ui, -apple-system, Segoe UI, Arial', background:'#f6f7f9', minHeight:'100vh'}}>
      <header style={{
        position:'sticky',top:0,zIndex:10,display:'flex',alignItems:'center',justifyContent:'space-between',gap:8,
        padding:'12px 12px',background:'#000',color:'#fff'
      }}>
        <strong style={{whiteSpace:'nowrap'}}>MOM3NT DATA</strong>
        <div style={{display:'flex',gap:8,flexWrap:'wrap',justifyContent:'center'}}>
          <button onClick={()=>setTab('calendar')} style={{background:'transparent',color: tab==='calendar' ? '#dca636' : '#fff', border:'1px solid #333', borderRadius:10, padding:'6px 10px'}}>Calendar</button>
          <button onClick={()=>setTab('database')} style={{background:'transparent',color: tab==='database' ? '#dca636' : '#fff', border:'1px solid #333', borderRadius:10, padding:'6px 10px'}}>Database</button>
          <button onClick={()=>setTab('leaderboard')} style={{background:'transparent',color: tab==='leaderboard' ? '#dca636' : '#fff', border:'1px solid #333', borderRadius:10, padding:'6px 10px'}}>Leaderboard</button>
          <button onClick={()=>setProfileOpen(true)} style={{background:'#111',color:'#fff',border:'1px solid #333',borderRadius:10,padding:'6px 10px'}}>Profile</button>
          <button
            onClick={async ()=>{ await supabase.auth.signOut(); setSession(null); }}
            style={{background:'#dca636',color:'#000',border:'1px solid #333',borderRadius:10,padding:'6px 10px',fontWeight:700}}
          >
            Sign Out
          </button>
        </div>
      </header>

      <main style={{maxWidth:680, margin:'12px auto', padding:'0 12px 48px', color:'#000'}}>
        {tab === 'calendar' && (
          <section>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom: isMobile ? 6 : 8, color:'#000'}}>
              <button onClick={()=>setMonthDate(new Date(monthDate.getFullYear(), monthDate.getMonth()-1, 1))}>◀︎</button>
              <div style={{fontWeight:700, color:'#000'}}>{monthLabel(monthDate)}</div>
              <button onClick={()=>setMonthDate(new Date(monthDate.getFullYear(), monthDate.getMonth()+1, 1))}>▶︎</button>
            </div>

            <div style={{background:'#fff',borderRadius:12,padding: isMobile ? 8 : 12,boxShadow:'0 1px 2px rgba(0,0,0,.06)', color:'#000'}}>
              <CalendarGrid
                monthDate={monthDate}
                isMobile={isMobile}
                selectedDate={selectedDate}
                setSelectedDate={setSelectedDate}
                inputVal={inputVal}
                setInputVal={setInputVal}
                inputNotes={inputNotes}
                setInputNotes={setInputNotes}
                saveEntry={saveEntry}
              />
            </div>
          </section>
        )}

        {tab === 'database' && (
          <section>
            <DatabaseSection dbView={dbView} setDbView={setDbView} myEntries={myEntries} />
          </section>
        )}

        {tab === 'leaderboard' && (
          <section>
            <div style={{background:'#fff',borderRadius:12,padding:12,boxShadow:'0 1px 2px rgba(0,0,0,.06)', color:'#000'}}>

              <div style={{ display:'flex', flexWrap:'wrap', gap:8, alignItems:'center', marginBottom:8 }}>
                <div style={{ fontWeight:700 }}>Leaderboard</div>
                <span style={{ fontSize:12, opacity:.8 }}>Movement:</span>
                <select
                  value={lbMovementName}
                  onChange={(e)=>setLbMovementName(e.target.value)}
                  style={{ padding:'6px 8px', border:'1px solid #ddd', borderRadius:8 }}
                >
                  {lbMovementName && !leaderboardOptions.find(o => o.name === lbMovementName) && (
                    <option value={lbMovementName}>{lbMovementName}</option>
                  )}
                  {leaderboardOptions.map(opt => (
                    <option key={opt.name} value={opt.name}>{opt.name}</option>
                  ))}
                </select>
                {leaderboard.unit && (
                  <span style={{ fontSize:12, opacity:.7 }}>
                    &nbsp;• Units: {leaderboard.unit}
                  </span>
                )}
              </div>

              <div style={{fontSize:12,color:'#000'}}>Selected movement</div>
              <div style={{fontWeight:700,marginBottom:8,color:'#000'}}>
                {lbMovementName || '—'} {leaderboard.unit ? <span style={{fontSize:12}}>({leaderboard.unit})</span> : null}
              </div>

              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8}}>
                {['male','female'].map((g) => (
                  <div key={g} style={{background:'#f6f7f9',border:'1px solid #eee',borderRadius:12,padding:10, color:'#000'}}>
                    <div style={{fontWeight:700,textTransform:'capitalize', color:'#000'}}>Top 5 {g}</div>
                    <ol style={{marginTop:6,display:'grid',gap:6}}>
                      {leaderboard[g].length ? leaderboard[g].map((r,i)=>(
                        <li
                          key={r.id}
                          style={{
                            display: 'grid',
                            gridTemplateColumns: '1fr auto auto',
                            alignItems: 'center',
                            gap: 8,
                            background: '#fff',
                            border: '1px solid #eee',
                            borderRadius: 10,
                            padding: '8px 10px',
                            color: '#000',
                            whiteSpace: 'nowrap'
                          }}
                        >
                          <span style={{ fontSize: 14 }}>
                            {i + 1}. {(r.name || 'Member').split(' ')[0]}
                          </span>
                          <span style={{ fontSize: 14, fontWeight: 700, textAlign: 'right' }}>
                            {r.value}
                          </span>
                          <span style={{ fontSize: 12, opacity: 0.8, marginLeft: 6 }}>
                            {leaderboard.unit || ''}
                          </span>
                        </li>
                      )) : <div style={{fontSize:12,color:'#000'}}>No entries yet.</div>}
                    </ol>
                  </div>
                ))}
              </div>
            </div>
          </section>
        )}
      </main>

      {/* Profile modal */}
      {profileOpen && (
        <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,.5)',display:'grid',placeItems:'center',padding:16}}>
          <div style={{background:'#fff',borderRadius:12,padding:16,width:'min(92vw,420px)'}}>
            <div style={{fontWeight:700,marginBottom:8,color:'#000'}}>Profile</div>
            <div style={{display:'grid',gap:8,color:'#000'}}>
              <div>
                <div style={{fontSize:12,color:'#000'}}>Name</div>
                <input value={name} onChange={(e)=>setName(e.target.value)} placeholder="First Last" style={{width:'100%',padding:10,border:'1px solid #ddd',borderRadius:10}}/>
              </div>
              <div>
                <div style={{fontSize:12,color:'#000'}}>Gender</div>
                <select value={gender} onChange={(e)=>setGender(e.target.value)} style={{width:'100%',padding:10,border:'1px solid #ddd',borderRadius:10}}>
                  <option value="">Select</option>
                  <option value="male">Male</option>
                  <option value="female">Female</option>
                </select>
              </div>
              <div style={{display:'flex',justifyContent:'space-between',gap:8,marginTop:8}}>
                <button
                  onClick={()=>setProfileOpen(false)}
                  style={{padding:'8px 12px',border:'1px solid #ccc',borderRadius:10,background:'#f0f0f0',color:'#000',cursor:'pointer'}}
                >
                  Close
                </button>
                <button
                  onClick={saveProfile}
                  style={{padding:'8px 12px',border:'1px solid #111',borderRadius:10,background:'#000',color:'#fff',cursor:'pointer'}}
                >
                  Save Profile
                </button>
              </div>
              <div style={{fontSize:12,color:'#000'}}>Your name & gender are saved to your account and included with each entry for the leaderboard.</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ================= CalendarGrid ================= */
function CalendarGrid({ monthDate, isMobile, selectedDate, setSelectedDate, inputVal, setInputVal, inputNotes, setInputNotes, saveEntry }) {
  const y = monthDate.getFullYear();
  const m = monthDate.getMonth();
  const first = new Date(y, m, 1);
  const start = first.getDay();
  const days = new Date(y, m + 1, 0).getDate();
  const cells = [...range(start).map(() => null), ...range(days).map((d) => new Date(y, m, d + 1))];

  const gap = isMobile ? 2 : 6;
  const mov = movementForDate(selectedDate);
  const isTBD = mov.name === 'TBD';

  return (
    <>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(7, minmax(0, 1fr))',
          gap,
          width: '100%',
          boxSizing: 'border-box',
        }}
      >
        {['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map((d) => (
          <div key={d} style={{ fontSize: isMobile ? 10 : 12, color:'#666', textAlign:'center', paddingBottom: isMobile ? 2 : 4 }}>
            {d}
          </div>
        ))}
        {cells.map((d,i) => {
          if (!d) return <div key={`sp-${i}`} />;
          const sel = isoLocal(d) === isoLocal(selectedDate);
          const today = isoLocal(d) === isoLocal(new Date());
          return (
            <button
              key={d.toISOString()}
              onClick={() => setSelectedDate(d)}
              style={{
                aspectRatio: '1 / 1',
                width: '100%',
                borderRadius: 10,
                border: '1px solid #e5e5e5',
                background: sel ? '#000' : '#fff',
                color: sel ? '#fff' : '#111',
                outline: today ? '2px solid #dca636' : 'none',
                display: 'grid',
                placeItems: 'center',
                fontWeight: sel ? 800 : 600,
                fontSize: isMobile ? 14 : 16,
                boxSizing: 'border-box',
              }}
              title={movementForDate(d).name}
            >
              {d.getDate()}
            </button>
          );
        })}
      </div>

      <div style={{
        marginTop: isMobile ? 8 : 12,
        background:'#fff',
        borderRadius:12,
        padding: isMobile ? 8 : 12,
        boxShadow:'0 1px 2px rgba(0,0,0,.06)',
        color:'#000'
      }}>
        <div style={{
          display:'grid',
          gridTemplateColumns: '1fr',
          alignItems:'center',
          gap: 8
        }}>
          <div style={{minWidth: 0}}>
            <div style={{fontSize:12,color:'#000'}}>Selected: {isoLocal(selectedDate)}</div>
            <div style={{fontWeight:700,color:'#000', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis'}}>
              {mov.name}
            </div>
            <div style={{fontSize:12,color:'#000'}}>Units: {mov.unit || '—'}</div>
            {isTBD && (
              <div style={{fontSize:12,color:'#b45309', marginTop:4}}>
                TBD day — entries disabled outside the defined cycles.
              </div>
            )}
          </div>

          {/* Inputs */}
          <div style={{display:'flex',gap:8,flexWrap:'wrap', alignItems:'center'}}>
            <NumberField
              value={inputVal}
              onChange={setInputVal}
              placeholder={isTBD ? 'Unavailable' : `Enter ${mov.unit}`}
              width={isMobile ? 120 : 160}
              allowDecimal={true}
            />
            <button
              onClick={saveEntry}
              disabled={isTBD}
              style={{
                padding:'10px 12px',
                borderRadius:10,
                background: isTBD ? '#aaa' : '#000',
                color:'#fff',
                opacity: isTBD ? 0.7 : 1,
                cursor: isTBD ? 'not-allowed' : 'pointer'
              }}
            >
              Save
            </button>
          </div>

          {/* Notes */}
          <div>
            <label style={{ fontSize:12, display:'block', marginBottom:4, color:'#000' }}>Notes (optional)</label>
            <textarea
              value={inputNotes}
              onChange={(e)=>setInputNotes(e.target.value)}
              placeholder={isTBD ? 'Unavailable' : 'Add any context or notes…'}
              disabled={isTBD}
              rows={3}
              style={{
                width:'100%',
                padding:8,
                border:'1px solid #ddd',
                borderRadius:10,
                resize:'vertical',
                background: isTBD ? '#f5f5f5' : '#fff',
                color:'#000'
              }}
            />
          </div>
        </div>
      </div>
    </>
  );
}

/* ================= Database Section ================= */
function DatabaseSection({ dbView, setDbView, myEntries }) {
  const { currentCycle, previousCycle, currentBounds, previousBounds } = useMemo(() => {
    const idx = getCurrentCycleIndex(new Date());
    let curr = idx >= 0 ? CYCLES[idx] : null;
    let prev = idx > 0 ? CYCLES[idx - 1] : null;
    if (!curr && CYCLES.length) {
      curr = CYCLES[CYCLES.length - 1];
      prev = CYCLES.length > 1 ? CYCLES[CYCLES.length - 2] : null;
    }
    return {
      currentCycle: curr,
      previousCycle: prev,
      currentBounds: curr ? getCycleBounds(curr) : null,
      previousBounds: prev ? getCycleBounds(prev) : null,
    };
  }, []);

  return (
    <>
      <div style={{ display:'flex', gap:8, alignItems:'center', marginBottom:8 }}>
        <label style={{ fontSize:12 }}>View:</label>
        <select
          value={dbView}
          onChange={(e) => setDbView(e.target.value)}
          style={{ padding:'6px 8px', border:'1px solid #ddd', borderRadius:8 }}
        >
          <option value="this">Current Cycle</option>
          <option value="prev">Previous Cycle</option>
          <option value="all">All Cycles</option>
        </select>

        {dbView === 'this' && currentBounds && (
          <span style={{ fontSize:12, opacity:0.7, marginLeft:8 }}>
            {isoLocal(currentBounds.start)} → {isoLocal(currentBounds.end)}
          </span>
        )}
        {dbView === 'prev' && previousBounds && (
          <span style={{ fontSize:12, opacity:0.7, marginLeft:8 }}>
            {isoLocal(previousBounds.start)} → {isoLocal(previousBounds.end)}
          </span>
        )}
      </div>

      {/* Current Cycle */}
      {dbView === 'this' && (
        <>
          {!currentCycle ? (
            <div style={{ background:'#fff', borderRadius:12, padding:12, boxShadow:'0 1px 2px rgba(0,0,0,.06)' }}>
              <div style={{ fontSize:14 }}>No active cycle configured.</div>
            </div>
          ) : (
            movementsFromTemplate(currentCycle.weekTemplate).map(({ weekday, name: movementName, unit }) => {
              const rows = myEntries
                .filter((e) => currentBounds && isWithinISO(e.date, currentBounds.start, currentBounds.end) && e.movement === movementName)
                .map((e) => ({ date:e.date, value:Number(e.value) }))
                .sort((a,b)=>a.date.localeCompare(b.date));
              const data = rows.map((r)=>({ ...r, shortDate: r.date.slice(5) }));
              return <ChartCard key={`this-${weekday}`} title={`${weekday}: ${movementName}`} unit={unit} rows={rows} data={data} />;
            })
          )}
        </>
      )}

      {/* Previous Cycle */}
      {dbView === 'prev' && (
        <>
          {!previousCycle ? (
            <div style={{ background:'#fff', borderRadius:12, padding:12, boxShadow:'0 1px 2px rgba(0,0,0,.06)' }}>
              <div style={{ fontSize:14 }}>No previous cycle configured.</div>
            </div>
          ) : (
            movementsFromTemplate(previousCycle.weekTemplate).map(({ weekday, name: movementName, unit }) => {
              const rows = myEntries
                .filter((e) => previousBounds && isWithinISO(e.date, previousBounds.start, previousBounds.end) && e.movement === movementName)
                .map((e) => ({ date:e.date, value:Number(e.value) }))
                .sort((a,b)=>a.date.localeCompare(b.date));
              const data = rows.map((r)=>({ ...r, shortDate: r.date.slice(5) }));
              return <ChartCard key={`prev-${weekday}`} title={`${weekday}: ${movementName}`} unit={unit} rows={rows} data={data} />;
            })
          )}
        </>
      )}

      {/* All-time across all configured movements (no TBD) */}
      {dbView === 'all' && (
        <>
          {(() => {
            const movementMap = new Map();
            Object.values(LEGACY_MOVEMENTS).forEach((m)=> m?.name && movementMap.set(m.name, m.unit || ''));
            CYCLES.forEach((cy)=> {
              Object.values(cy.weekTemplate).forEach((m)=> {
                if (m?.name && m.name !== 'TBD' && !movementMap.has(m.name)) movementMap.set(m.name, m.unit || '');
              });
            });
            const movementList = Array.from(movementMap.entries()).map(([name, unit]) => ({ name, unit }));
            if (!movementList.length) {
              return (
                <div style={{ background:'#fff', borderRadius:12, padding:12, boxShadow:'0 1px 2px rgba(0,0,0,.06)' }}>
                  <div style={{ fontSize:14 }}>No movements configured.</div>
                </div>
              );
            }
            return movementList.map(({ name: movementName, unit }) => {
              const rows = myEntries
                .filter((e)=> e.movement === movementName)
                .map((e)=> ({ date:e.date, value:Number(e.value) }))
                .sort((a,b)=> a.date.localeCompare(b.date));
              const data = rows.map((r)=> ({ ...r, shortDate: r.date.slice(5) }));
              return <ChartCard key={`all-${movementName}`} title={movementName} unit={unit} rows={rows} data={data} />;
            });
          })()}
        </>
      )}
    </>
  );
}

function ChartCard({ title, unit, rows, data }) {
  const values = rows.map((r) => Number(r.value)).filter((v) => Number.isFinite(v));
  const dataMin = values.length ? Math.min(...values) : 0;
  const dataMax = values.length ? Math.max(...values) : 1;
  const span = Math.max(1, dataMax - dataMin);
  const pad = span * 0.1; // 10% padding
  const yLower = dataMin - pad < 0 && dataMin >= 0 ? 0 : dataMin - pad;
  const yUpper = dataMax + pad;

  return (
    <div style={{ marginBottom:12, background:'#fff', borderRadius:12, padding:12, boxShadow:'0 1px 2px rgba(0,0,0,.06)' }}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:6 }}>
        <div style={{ fontWeight:700, color:'#000' }}>{title}</div>
        <div style={{ fontSize:12, color:'#000' }}>{rows.length} entries • {unit || '—'}</div>
      </div>
      <div style={{ width:'100%', height:220 }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top:10, right:10, bottom:10, left:0 }}>
            <CartesianGrid stroke="#e5e7eb" />
            <XAxis dataKey="shortDate" tick={{ fill:'#000' }} />
            <YAxis tick={{ fill:'#000' }} domain={[() => yLower, () => yUpper]} tickFormatter={formatNiceNumber} />
            <Tooltip
              contentStyle={{ backgroundColor:'#fff', border:'1px solid #000', color:'#000' }}
              labelStyle={{ color:'#000' }}
              itemStyle={{ color:'#000' }}
              labelFormatter={(label, payload) => {
                const p = payload && payload[0] && payload[0].payload;
                return p?.date ? `Date: ${p.date}` : `Date: ${label}`;
              }}
              formatter={(val) => [`${formatExactValue(val)} ${unit || ''}`, 'Value']}
            />
            <Line type="monotone" dataKey="value" stroke="#000" strokeWidth={3} dot={{ r:4 }} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
