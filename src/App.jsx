// src/App.jsx
import { useEffect, useMemo, useState } from 'react';
import { supabase } from './lib/supabase';
import { SITE_URL } from './config';
import { LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, ResponsiveContainer } from 'recharts';

// ---------- Helpers ----------
const iso = (d) => d.toISOString().slice(0, 10);
const dayName = (d) => d.toLocaleDateString('en-US', { weekday: 'long' });
const monthLabel = (d) => d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
const range = (n) => Array.from({ length: n }, (_, i) => i);
const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

// ---------- Legacy static mapping (fallback outside cycles) ----------
const MOVEMENTS = {
  Sunday:    { key: 'sun', name: '3 Rep Max Landmine clean', unit: 'lbs' },
  Monday:    { key: 'mon', name: '6 Rep Reverse Lunge Max', unit: 'lbs' },
  Tuesday:   { key: 'tue', name: 'Max power Keiser Push/Pull', unit: 'watts' },
  Wednesday: { key: 'wed', name: 'Max Treadmill Speed', unit: 'mph' },
  Thursday:  { key: 'thu', name: '6 Rep Max Kickstand RDL', unit: 'lbs' },
  Friday:    { key: 'fri', name: '6 Rep Max S/A Pull Down', unit: 'lbs' },
  Saturday:  { key: 'sat', name: 'Max distance 30 sec assault bike', unit: 'miles' },
};

// ---------- New 8-week cycle starting Sept 1, 2025 (Monday) ----------
const SEPT_CYCLE_START = new Date('2025-09-01'); // local date
const SEPT_CYCLE_WEEKS = 8;

// Weekly template (repeats each of the 8 weeks)
const SEPT_WEEK_TEMPLATE = {
  Monday:    { key: 'w_mon', name: '6 Rep Bulgarian Split Squat', unit: 'lbs' },
  Tuesday:   { key: 'w_tue', name: '6 Rep DB Floor Press',        unit: 'lbs' },
  Wednesday: { key: 'w_wed', name: '.1 Distance Run',              unit: 'time' },
  Thursday:  { key: 'w_thu', name: '6 Rep Smith RDL',              unit: 'lbs' },
  Friday:    { key: 'w_fri', name: 'Pull Up + Push Press EDT',     unit: 'rounds' },
  Saturday:  { key: 'w_sat', name: 'Ski/Curl/Squat METCON',        unit: 'time' },
  Sunday:    { key: 'w_sun', name: 'Keiser Rotate to Press',       unit: 'watts' },
};

// You can add future cycles by appending here.
const CYCLES = [
  {
    start: SEPT_CYCLE_START,
    weeks: SEPT_CYCLE_WEEKS,
    weekTemplate: SEPT_WEEK_TEMPLATE,
  },
];

// ---------- Cycle utilities ----------
function getCycleBounds(cycle) {
  const start = startOfDay(cycle.start);
  const end = new Date(start);
  end.setDate(end.getDate() + cycle.weeks * 7 - 1); // inclusive
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

// Weekday order for rendering 7 movements consistently
const WEEKDAY_ORDER = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
function movementsFromTemplate(weekTemplate) {
  return WEEKDAY_ORDER.map(weekday => {
    const mov = weekTemplate[weekday];
    return mov ? { weekday, ...mov } : null;
  }).filter(Boolean);
}

// Parse #hash params like access_token, refresh_token, etc.
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

export default function App() {
  // Auth/session
  const [session, setSession] = useState(null);

  // Login form state
  const [email, setEmail] = useState('');
  const [otp, setOtp] = useState(''); // 6-digit code

  // Profile (sync with Supabase; also mirrored locally)
  const [profileOpen, setProfileOpen] = useState(false);
  const [name, setName] = useState(localStorage.getItem('mom3nt_name') || '');
  const [gender, setGender] = useState(localStorage.getItem('mom3nt_gender') || '');

  // UI
  const [tab, setTab] = useState('calendar'); // calendar | database | leaderboard
  const [monthDate, setMonthDate] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [inputVal, setInputVal] = useState('');

  // Database view: Current Cycle | Previous Cycle | All Cycles
  const [dbView, setDbView] = useState('this'); // 'this' | 'prev' | 'all'

  // Data
  const [entries, setEntries] = useState([]);

  // --- Handle magic link in URL + subscribe to auth changes ---
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
    return () => {
      if (sub) sub.unsubscribe();
    };
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
        if (pData.name) setName(pData.name);
        if (pData.gender) setGender(pData.gender);
        localStorage.setItem('mom3nt_name', pData.name || '');
        localStorage.setItem('mom3nt_gender', pData.gender || '');
      }
    })();
  }, [session]);

  // Keep local mirror updated
  useEffect(() => {
    localStorage.setItem('mom3nt_name', name || '');
    localStorage.setItem('mom3nt_gender', gender || '');
  }, [name, gender]);

  // Save name/gender to Supabase (Upsert)
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

  // Movement picker honoring cycles
  function movementForDate(d) {
    const cycle = getCycleForDate(d);
    if (cycle) {
      const mov = cycle.weekTemplate[dayName(d)];
      if (mov) return mov;
    }
    // Fallback to legacy mapping
    return MOVEMENTS[dayName(d)];
  }

  async function saveEntry() {
    if (!session) return alert('Please sign in first (use code).');
    if (!name.trim() || !gender) {
      setProfileOpen(true);
      return;
    }
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
      gender,
    };

    // Upsert ensures single entry per (user_id, date, movement)
    const { error } = await supabase
      .from('entries')
      .upsert(row, { onConflict: 'user_id,date,movement' });
    if (error) return alert(error.message);
    setInputVal('');

    const { data } = await supabase.from('entries').select('*').order('date', { ascending: true });
    setEntries(data || []);
  }

  const myEntries = useMemo(() => {
    if (!session) return [];
    return entries.filter((e) => e.user_id === session.user.id);
  }, [entries, session]);

  // ---------- Database tab (Current/Previous/All Cycles) ----------
  // Determine current/previous cycle and date bounds
  const cycleContext = useMemo(() => {
    const idx = getCurrentCycleIndex(new Date());
    let currentCycle = idx >= 0 ? CYCLES[idx] : null;
    let previousCycle = idx > 0 ? CYCLES[idx - 1] : null;

    // If not inside any active cycle but cycles exist, treat the latest as "current"
    if (!currentCycle && CYCLES.length) {
      currentCycle = CYCLES[CYCLES.length - 1];
      previousCycle = CYCLES.length > 1 ? CYCLES[CYCLES.length - 2] : null;
    }

    const currentBounds = currentCycle ? getCycleBounds(currentCycle) : null;
    const previousBounds = previousCycle ? getCycleBounds(previousCycle) : null;

    return { currentCycle, previousCycle, currentBounds, previousBounds };
  }, []);

  // ---------- LOGIN UI: email + 6-digit code ----------
  if (!session) {
    // Send email that contains a 6-digit code (and a magic link you can ignore)
    async function sendCode() {
      if (!email) return alert('Enter your email');
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: SITE_URL }, // we’re using the code in-app
      });
      if (error) alert(error.message);
      else alert('Code sent! Check your email for the 6-digit code.');
    }

    // Verify the 6-digit code (PWA/iPhone friendly)
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
      <div style={{ display: 'grid', placeItems: 'center', height: '100vh', background: '#000', color: '#fff', textAlign: 'center', padding: 16 }}>
        <div style={{ maxWidth: 360, width: '100%', background: '#111', borderRadius: 12, padding: 16, border: '1px solid #333' }}>
          <h1 style={{ marginBottom: 8 }}>MOM3NT DATA</h1>
          <p style={{ marginBottom: 12, opacity: 0.9 }}>Sign in with the 6-digit code sent to your email.</p>

          {/* Email */}
          <input
            type="email"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            style={{
              width: '100%',
              padding: '10px',
              borderRadius: 10,
              border: '1px solid #444',
              marginBottom: 8,
              background: '#111',
              color: '#fff',
            }}
          />

          {/* Send code */}
          <button
            onClick={sendCode}
            style={{
              width: '100%',
              padding: '10px',
              borderRadius: 10,
              border: '1px solid #111',
              background: '#dca636',
              color: '#000',
              fontWeight: 700,
              marginBottom: 12,
            }}
          >
            Send Code
          </button>

          {/* Enter 6-digit code */}
          <input
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={6}
            placeholder="Enter 6-digit code"
            value={otp}
            onChange={(e) => setOtp(e.target.value)}
            style={{
              width: '100%',
              padding: '10px',
              borderRadius: 10,
              border: '1px solid #444',
              marginBottom: 8,
              background: '#111',
              color: '#fff',
              letterSpacing: 2,
              textAlign: 'center',
              fontWeight: 700,
            }}
          />
          <button
            onClick={verifySixDigitCode}
            style={{
              width: '100%',
              padding: '10px',
              borderRadius: 10,
              border: '1px solid #333',
              background: '#fff',
              color: '#000',
              fontWeight: 700,
            }}
          >
            Verify & Sign In
          </button>
        </div>
      </div>
    );
  }
  // ---------------------------------------------

  // Calendar grid (mobile friendly)
  function CalendarGrid() {
  const y = monthDate.getFullYear();
  const m = monthDate.getMonth();
  const first = new Date(y, m, 1);
  const start = first.getDay(); // 0 Sun
  const days = new Date(y, m + 1, 0).getDate();  // ✅ fixed
  const cells = [...range(start).map(() => null), ...range(days).map((d) => new Date(y, m, d + 1))];


    return (
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 6 }}>
        {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => (
          <div key={d} style={{ fontSize: 12, color: '#666', textAlign: 'center' }}>
            {d}
          </div>
        ))}
        {cells.map((d, i) => {
          if (!d) return <div key={`sp-${i}`} />;
          const sel = iso(d) === iso(selectedDate);
          const today = iso(d) === iso(new Date());
          const mov = movementForDate(d);
          return (
            <button
              key={d.toISOString()}
              onClick={() => setSelectedDate(d)}
              style={{
                height: 64,
                borderRadius: 12,
                border: '1px solid #eee',
                background: sel ? '#000' : '#fff',
                color: sel ? '#fff' : '#111',
                outline: today ? '2px solid #dca636' : 'none',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
              }}
              title={mov.name}
            >
              <div style={{ fontWeight: 600, fontSize: 14 }}>{d.getDate()}</div>
              <div
                style={{
                  fontSize: 10,
                  opacity: 0.7,
                  maxWidth: '9ch',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {mov.name}
              </div>
            </button>
          );
        })}
      </div>
    );
  }

  return (
    <div style={{ fontFamily: 'system-ui, -apple-system, Segoe UI, Arial', background: '#f6f7f9', minHeight: '100vh' }}>
      {/* Header with top tabs + profile + sign out */}
      <header
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 10,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
          padding: '12px 12px',
          background: '#000',
          color: '#fff',
        }}
      >
        <strong style={{ whiteSpace: 'nowrap' }}>MOM3NT DATA</strong>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
          <button
            onClick={() => setTab('calendar')}
            style={{
              background: 'transparent',
              color: tab === 'calendar' ? '#dca636' : '#fff',
              border: '1px solid #333',
              borderRadius: 10,
              padding: '6px 10px',
            }}
          >
            Calendar
          </button>
          <button
            onClick={() => setTab('database')}
            style={{
              background: 'transparent',
              color: tab === 'database' ? '#dca636' : '#fff',
              border: '1px solid #333',
              borderRadius: 10,
              padding: '6px 10px',
            }}
          >
            Database
          </button>
          <button
            onClick={() => setTab('leaderboard')}
            style={{
              background: 'transparent',
              color: tab === 'leaderboard' ? '#dca636' : '#fff',
              border: '1px solid #333',
              borderRadius: 10,
              padding: '6px 10px',
            }}
          >
            Leaderboard
          </button>
          <button
            onClick={() => setProfileOpen(true)}
            style={{
              background: '#111',
              color: '#fff',
              border: '1px solid #333',
              borderRadius: 10,
              padding: '6px 10px',
            }}
          >
            Profile
          </button>
          <button
            onClick={async () => {
              await supabase.auth.signOut();
              setSession(null);
            }}
            style={{
              background: '#dca636',
              color: '#000',
              border: '1px solid #333',
              borderRadius: 10,
              padding: '6px 10px',
              fontWeight: 700,
            }}
          >
            Sign Out
          </button>
        </div>
      </header>

      {/* Content */}
      <main style={{ maxWidth: 680, margin: '12px auto', padding: '0 12px 48px', color: '#000' }}>
        {tab === 'calendar' && (
          <section>
            {/* Month switcher */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, color: '#000' }}>
              <button onClick={() => setMonthDate(new Date(monthDate.getFullYear(), monthDate.getMonth() - 1, 1))}>◀︎</button>
              <div style={{ fontWeight: 700, color: '#000' }}>{monthLabel(monthDate)}</div>
              <button onClick={() => setMonthDate(new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 1))}>▶︎</button>
            </div>

            <div style={{ background: '#fff', borderRadius: 12, padding: 12, boxShadow: '0 1px 2px rgba(0,0,0,.06)', color: '#000' }}>
              <CalendarGrid />
            </div>

            {/* Selected day movement + input */}
            <div style={{ marginTop: 12, background: '#fff', borderRadius: 12, padding: 12, boxShadow: '0 1px 2px rgba(0,0,0,.06)', color: '#000' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                <div>
                  <div style={{ fontSize: 12, color: '#000' }}>Selected: {iso(selectedDate)}</div>
                  <div style={{ fontWeight: 700, color: '#000' }}>{movementForDate(selectedDate).name}</div>
                  <div style={{ fontSize: 12, color: '#000' }}>Units: {movementForDate(selectedDate).unit}</div>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <input
                    type="number"
                    inputMode="decimal"
                    placeholder={`Enter ${movementForDate(selectedDate).unit}`}
                    value={inputVal}
                    onChange={(e) => setInputVal(e.target.value)}
                    style={{ padding: 10, border: '1px solid #ddd', borderRadius: 10, width: 140 }}
                  />
                  <button onClick={saveEntry} style={{ padding: '10px 12px', borderRadius: 10, background: '#000', color: '#fff' }}>
                    Save
                  </button>
                </div>
              </div>
            </div>
          </section>
        )}

        {tab === 'database' && (
          <section>
            {/* View selector */}
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
              <label style={{ fontSize: 12 }}>View:</label>
              <select
                value={dbView}
                onChange={(e) => setDbView(e.target.value)}
                style={{ padding: '6px 8px', border: '1px solid #ddd', borderRadius: 8 }}
              >
                <option value="this">Current Cycle</option>
                <option value="prev">Previous Cycle</option>
                <option value="all">All Cycles</option>
              </select>

              {/* Date badges for cycle views */}
              {dbView === 'this' && cycleContext.currentBounds && (
                <span style={{ fontSize: 12, opacity: 0.7, marginLeft: 8 }}>
                  {iso(cycleContext.currentBounds.start)} → {iso(cycleContext.currentBounds.end)}
                </span>
              )}
              {dbView === 'prev' && cycleContext.previousBounds && (
                <span style={{ fontSize: 12, opacity: 0.7, marginLeft: 8 }}>
                  {iso(cycleContext.previousBounds.start)} → {iso(cycleContext.previousBounds.end)}
                </span>
              )}
            </div>

            {/* ========== CURRENT CYCLE ========== */}
            {dbView === 'this' && (
              <>
                {!cycleContext.currentCycle ? (
                  <div style={{ background: '#fff', borderRadius: 12, padding: 12, boxShadow: '0 1px 2px rgba(0,0,0,.06)' }}>
                    <div style={{ fontSize: 14 }}>No active cycle configured.</div>
                  </div>
                ) : (
                  movementsFromTemplate(cycleContext.currentCycle.weekTemplate).map(({ weekday, name: movementName, unit }) => {
                    const rows = myEntries
                      .filter(e =>
                        cycleContext.currentBounds &&
                        isWithinISO(e.date, cycleContext.currentBounds.start, cycleContext.currentBounds.end) &&
                        e.movement === movementName
                      )
                      .map(e => ({ date: e.date, value: Number(e.value) }))
                      .sort((a, b) => a.date.localeCompare(b.date));

                    const data = rows.map(r => ({ ...r, shortDate: r.date.slice(5) }));
                    return (
                      <div key={`this-${weekday}`} style={{ marginBottom: 12, background: '#fff', borderRadius: 12, padding: 12, boxShadow: '0 1px 2px rgba(0,0,0,.06)' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                          <div style={{ fontWeight: 700, color: '#000' }}>{weekday}: {movementName}</div>
                          <div style={{ fontSize: 12, color: '#000' }}>{rows.length} entries • {unit}</div>
                        </div>
                        <div style={{ width: '100%', height: 220 }}>
                          <ResponsiveContainer width="100%" height="100%">
                            <LineChart data={data} margin={{ top: 10, right: 10, bottom: 10, left: 0 }}>
                              <CartesianGrid stroke="#e5e7eb" />
                              <XAxis dataKey="shortDate" tick={{ fill: '#000' }} />
                              <YAxis tick={{ fill: '#000' }} />
                              <Tooltip
                                contentStyle={{ backgroundColor: '#fff', border: '1px solid #000', color: '#000' }}
                                labelStyle={{ color: '#000' }}
                                itemStyle={{ color: '#000' }}
                                labelFormatter={(label, payload) => {
                                  const p = payload && payload[0] && payload[0].payload;
                                  return p?.date ? `Date: ${p.date}` : `Date: ${label}`;
                                }}
                                formatter={(val) => [`${val} ${unit}`, 'Value']}
                              />
                              <Line type="monotone" dataKey="value" stroke="#000" strokeWidth={3} dot={{ r: 4 }} />
                            </LineChart>
                          </ResponsiveContainer>
                        </div>
                      </div>
                    );
                  })
                )}
              </>
            )}

            {/* ========== PREVIOUS CYCLE ========== */}
            {dbView === 'prev' && (
              <>
                {!cycleContext.previousCycle ? (
                  <div style={{ background: '#fff', borderRadius: 12, padding: 12, boxShadow: '0 1px 2px rgba(0,0,0,.06)' }}>
                    <div style={{ fontSize: 14 }}>No previous cycle configured.</div>
                  </div>
                ) : (
                  movementsFromTemplate(cycleContext.previousCycle.weekTemplate).map(({ weekday, name: movementName, unit }) => {
                    const rows = myEntries
                      .filter(e =>
                        cycleContext.previousBounds &&
                        isWithinISO(e.date, cycleContext.previousBounds.start, cycleContext.previousBounds.end) &&
                        e.movement === movementName
                      )
                      .map(e => ({ date: e.date, value: Number(e.value) }))
                      .sort((a, b) => a.date.localeCompare(b.date));

                    const data = rows.map(r => ({ ...r, shortDate: r.date.slice(5) }));
                    return (
                      <div key={`prev-${weekday}`} style={{ marginBottom: 12, background: '#fff', borderRadius: 12, padding: 12, boxShadow: '0 1px 2px rgba(0,0,0,.06)' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                          <div style={{ fontWeight: 700, color: '#000' }}>{weekday}: {movementName}</div>
                          <div style={{ fontSize: 12, color: '#000' }}>{rows.length} entries • {unit}</div>
                        </div>
                        <div style={{ width: '100%', height: 220 }}>
                          <ResponsiveContainer width="100%" height="100%">
                            <LineChart data={data} margin={{ top: 10, right: 10, bottom: 10, left: 0 }}>
                              <CartesianGrid stroke="#e5e7eb" />
                              <XAxis dataKey="shortDate" tick={{ fill: '#000' }} />
                              <YAxis tick={{ fill: '#000' }} />
                              <Tooltip
                                contentStyle={{ backgroundColor: '#fff', border: '1px solid #000', color: '#000' }}
                                labelStyle={{ color: '#000' }}
                                itemStyle={{ color: '#000' }}
                                labelFormatter={(label, payload) => {
                                  const p = payload && payload[0] && payload[0].payload;
                                  return p?.date ? `Date: ${p.date}` : `Date: ${label}`;
                                }}
                                formatter={(val) => [`${val} ${unit}`, 'Value']}
                              />
                              <Line type="monotone" dataKey="value" stroke="#000" strokeWidth={3} dot={{ r: 4 }} />
                            </LineChart>
                          </ResponsiveContainer>
                        </div>
                      </div>
                    );
                  })
                )}
              </>
            )}

            {/* ========== ALL CYCLES (All Time; ALWAYS show 14 movements) ========== */}
            {dbView === 'all' && (
              <>
                {(() => {
                  // Build the canonical list of movement names & units from:
                  // - legacy MOVEMENTS (7)
                  // - every cycle's weekTemplate (7 per cycle)
                  const movementMap = new Map(); // name -> unit
                  // Legacy
                  Object.values(MOVEMENTS).forEach(m => {
                    if (m?.name) movementMap.set(m.name, m.unit || '');
                  });
                  // Cycles
                  CYCLES.forEach(cy => {
                    Object.values(cy.weekTemplate).forEach(m => {
                      if (m?.name && !movementMap.has(m.name)) {
                        movementMap.set(m.name, m.unit || '');
                      }
                    });
                  });

                  const movementList = Array.from(movementMap.entries()).map(([name, unit]) => ({ name, unit }));

                  if (!movementList.length) {
                    return (
                      <div style={{ background: '#fff', borderRadius: 12, padding: 12, boxShadow: '0 1px 2px rgba(0,0,0,.06)' }}>
                        <div style={{ fontSize: 14 }}>No movements configured.</div>
                      </div>
                    );
                  }

                  return movementList.map(({ name: movementName, unit }) => {
                    // Pull ALL entries ever recorded for this movement
                    const rows = myEntries
                      .filter(e => e.movement === movementName)
                      .map(e => ({ date: e.date, value: Number(e.value) }))
                      .sort((a, b) => a.date.localeCompare(b.date));

                    const data = rows.map(r => ({ ...r, shortDate: r.date.slice(5) }));
                    return (
                      <div key={`all-${movementName}`} style={{ marginBottom: 12, background: '#fff', borderRadius: 12, padding: 12, boxShadow: '0 1px 2px rgba(0,0,0,.06)' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                          <div style={{ fontWeight: 700, color: '#000' }}>{movementName}</div>
                          <div style={{ fontSize: 12, color: '#000' }}>{rows.length} entries • {unit}</div>
                        </div>
                        <div style={{ width: '100%', height: 220 }}>
                          <ResponsiveContainer width="100%" height="100%">
                            <LineChart data={data} margin={{ top: 10, right: 10, bottom: 10, left: 0 }}>
                              <CartesianGrid stroke="#e5e7eb" />
                              <XAxis dataKey="shortDate" tick={{ fill: '#000' }} />
                              <YAxis tick={{ fill: '#000' }} />
                              <Tooltip
                                contentStyle={{ backgroundColor: '#fff', border: '1px solid #000', color: '#000' }}
                                labelStyle={{ color: '#000' }}
                                itemStyle={{ color: '#000' }}
                                labelFormatter={(label, payload) => {
                                  const p = payload && payload[0] && payload[0].payload;
                                  return p?.date ? `Date: ${p.date}` : `Date: ${label}`;
                                }}
                                formatter={(val) => [`${val} ${unit}`, 'Value']}
                              />
                              <Line type="monotone" dataKey="value" stroke="#000" strokeWidth={3} dot={{ r: 4 }} />
                            </LineChart>
                          </ResponsiveContainer>
                        </div>
                      </div>
                    );
                  });
                })()}
              </>
            )}
          </section>
        )}

        {tab === 'leaderboard' && (
          <section>
            <div style={{ background: '#fff', borderRadius: 12, padding: 12, boxShadow: '0 1px 2px rgba(0,0,0,.06)', color: '#000' }}>
              <div style={{ fontSize: 12, color: '#000' }}>Today’s movement</div>
              <div style={{ fontWeight: 700, marginBottom: 8, color: '#000' }}>
                {todaysMovement.name} <span style={{ fontSize: 12, color: '#000' }}>({todaysMovement.unit})</span>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                {['male', 'female'].map((g) => (
                  <div key={g} style={{ background: '#f6f7f9', border: '1px solid #eee', borderRadius: 12, padding: 10, color: '#000' }}>
                    <div style={{ fontWeight: 700, textTransform: 'capitalize', color: '#000' }}>Top 5 {g}</div>
                    <ol style={{ marginTop: 6, display: 'grid', gap: 6 }}>
                      {leaderboard[g].length ? (
                        leaderboard[g].map((r, i) => (
                          <li
                            key={r.id}
                            style={{ display: 'flex', justifyContent: 'space-between', background: '#fff', border: '1px solid #eee', borderRadius: 10, padding: '8px 10px', color: '#000' }}
                          >
                            <span style={{ fontSize: 14, color: '#000' }}>{i + 1}. {(r.name || 'Member').split(' ')[0]}</span>
                            <span style={{ fontSize: 14, fontWeight: 700, color: '#000' }}>
                              {r.value} {todaysMovement.unit}
                            </span>
                          </li>
                        ))
                      ) : (
                        <div style={{ fontSize: 12, color: '#000' }}>No entries yet.</div>
                      )}
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
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)', display: 'grid', placeItems: 'center', padding: 16 }}>
          <div style={{ background: '#fff', borderRadius: 12, padding: 16, width: 'min(92vw,420px)' }}>
            <div style={{ fontWeight: 700, marginBottom: 8, color: '#000' }}>Profile</div>
            <div style={{ display: 'grid', gap: 8, color: '#000' }}>
              <div>
                <div style={{ fontSize: 12, color: '#000' }}>Name</div>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="First Last"
                  style={{ width: '100%', padding: 10, border: '1px solid #ddd', borderRadius: 10 }}
                />
              </div>
              <div>
                <div style={{ fontSize: 12, color: '#000' }}>Gender</div>
                <select value={gender} onChange={(e) => setGender(e.target.value)} style={{ width: '100%', padding: 10, border: '1px solid #ddd', borderRadius: 10 }}>
                  <option value="">Select</option>
                  <option value="male">Male</option>
                  <option value="female">Female</option>
                </select>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginTop: 8 }}>
                <button
                  onClick={() => setProfileOpen(false)}
                  style={{
                    padding: '8px 12px',
                    border: '1px solid #ccc',
                    borderRadius: 10,
                    background: '#f0f0f0',
                    color: '#000',
                    cursor: 'pointer',
                  }}
                >
                  Close
                </button>
                <button
                  onClick={saveProfile}
                  style={{
                    padding: '8px 12px',
                    border: '1px solid #111',
                    borderRadius: 10,
                    background: '#000',
                    color: '#fff',
                    cursor: 'pointer',
                  }}
                >
                  Save Profile
                </button>
              </div>
              <div style={{ fontSize: 12, color: '#000' }}>
                Your name & gender are saved to your account and included with each entry for the leaderboard.
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
