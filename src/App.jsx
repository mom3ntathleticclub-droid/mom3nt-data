
import { useEffect, useMemo, useState } from 'react';
import { supabase } from './lib/supabase';
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
const iso = (d) => d.toISOString().slice(0,10);
const dayName = (d) => d.toLocaleDateString('en-US', { weekday: 'long' });
const monthLabel = (d) => d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
const range = (n) => Array.from({length: n}, (_,i) => i);

export default function App() {
  // Auth/session
  const [session, setSession] = useState(null);

  // Profile (sync with Supabase; also mirrored locally)
  const [profileOpen, setProfileOpen] = useState(false);
  const [name, setName] = useState(localStorage.getItem('mom3nt_name') || '');
  const [gender, setGender] = useState(localStorage.getItem('mom3nt_gender') || '');

  // UI
  const [tab, setTab] = useState('calendar'); // calendar | database | leaderboard
  const [monthDate, setMonthDate] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [inputVal, setInputVal] = useState('');

  // Data
  const [entries, setEntries] = useState([]);

  // --- Auth lifecycle ---
  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getSession();
      setSession(data.session ?? null);
    })();
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  // Load entries + profile once logged in
  useEffect(() => {
    if (!session) return;
    (async () => {
      // entries
      const { data: eData } = await supabase
        .from('entries')
        .select('*')
        .order('date', { ascending: true });
      setEntries(eData || []);

      // profile
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
      gender: g
    });
    if (error) return alert(error.message);
    alert('Profile saved!');
    setProfileOpen(false);
  }

  function movementForDate(d) {
    return MOVEMENTS[dayName(d)];
  }

  async function saveEntry() {
    if (!session) return alert('Please sign in first (use magic link).');
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

  const myEntries = useMemo(() => {
    if (!session) return [];
    return entries.filter(e => e.user_id === session.user.id);
  }, [entries, session]);

  // Build series per movement (my data only) for charts
  const seriesByMovement = useMemo(() => {
    const map = {};
    Object.values(MOVEMENTS).forEach(m => { map[m.name] = []; });
    for (const e of myEntries) {
      map[e.movement]?.push({ date: e.date, value: Number(e.value) });
    }
    Object.keys(map).forEach(k => map[k].sort((a,b)=>a.date.localeCompare(b.date)));
    return map;
  }, [myEntries]);

  // Leaderboard for TODAY’S movement — Top 5 per gender, one record per person (best)
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

  // Calendar grid (mobile friendly)
  function CalendarGrid() {
    const y = monthDate.getFullYear();
    const m = monthDate.getMonth();
    const first = new Date(y, m, 1);
    const start = first.getDay(); // 0 Sun
    const days = new Date(y, m+1, 0).getDate();
    const cells = [...range(start).map(() => null), ...range(days).map(d => new Date(y, m, d+1))];

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
                display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center'
              }}
              title={mov.name}
            >
              <div style={{fontWeight:600,fontSize:14}}>{d.getDate()}</div>
              <div style={{fontSize:10,opacity:.7,maxWidth:'9ch',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{mov.name}</div>
            </button>
          );
        })}
      </div>
    );
  }

  // ---------- LOGGED-OUT SCREEN WITH REAL LOGIN ----------
  if (!session) {
    const [email, setEmail] = useState('');
    async function sendMagicLink() {
      if (!email) return alert('Enter your email');
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: window.location.origin } // returns to this site
      });
      if (error) alert(error.message);
      else alert('Magic link sent! Check your email.');
    }

    return (
      <div style={{display:'grid',placeItems:'center',height:'100vh',background:'#000',color:'#fff',textAlign:'center',padding:16}}>
        <div style={{maxWidth:340, width:'100%'}}>
          <h1 style={{marginBottom:12}}>MOM3NT DATA</h1>
          <p style={{marginBottom:12, opacity:.9}}>Sign in with a magic link.</p>
          <input
            type="email"
            placeholder="you@example.com"
            value={email}
            onChange={(e)=>setEmail(e.target.value)}
            style={{width:'100%', padding:'10px', borderRadius:10, border:'1px solid #444', marginBottom:8, color:'#000'}}
          />
          <button
            onClick={sendMagicLink}
            style={{width:'100%', padding:'10px', borderRadius:10, border:'1px solid #111', background:'#dca636', color:'#000', fontWeight:700}}
          >
            Send Magic Link
          </button>
        </div>
      </div>
    );
  }
  // -------------------------------------------------------

  return (
    <div style={{fontFamily:'system-ui, -apple-system, Segoe UI, Arial', background:'#f6f7f9', minHeight:'100vh'}}>
      {/* Header with top tabs + profile */}
      <header style={{position:'sticky',top:0,zIndex:10,display:'flex',alignItems:'center',justifyContent:'space-between',gap:8,padding:'12px 12px',background:'#000',color:'#fff'}}>
        <strong style={{whiteSpace:'nowrap'}}>MOM3NT DATA</strong>
        <div style={{display:'flex',gap:8,flexWrap:'wrap',justifyContent:'center'}}>
          <button onClick={()=>setTab('calendar')}    style={{background:'transparent',color: tab==='calendar' ? '#dca636' : '#fff', border:'1px solid #333', borderRadius:10, padding:'6px 10px'}}>Calendar</button>
          <button onClick={()=>setTab('database')}    style={{background:'transparent',color: tab==='database' ? '#dca636' : '#fff', border:'1px solid #333', borderRadius:10, padding:'6px 10px'}}>Database</button>
          <button onClick={()=>setTab('leaderboard')} style={{background:'transparent',color: tab==='leaderboard' ? '#dca636' : '#fff', border:'1px solid #333', borderRadius:10, padding:'6px 10px'}}>Leaderboard</button>
          <button onClick={()=>setProfileOpen(true)}  style={{background:'#111',color:'#fff',border:'1px solid #333',borderRadius:10,padding:'6px 10px'}}>Profile</button>
        </div>
      </header>

      {/* Content */}
      <main style={{maxWidth:680, margin:'12px auto', padding:'0 12px 48px', color:'#000'}}>
        {tab === 'calendar' && (
          <section>
            {/* Month switcher */}
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:8, color:'#000'}}>
              <button onClick={()=>setMonthDate(new Date(monthDate.getFullYear(), monthDate.getMonth()-1, 1))}>◀︎</button>
              <div style={{fontWeight:700, color:'#000'}}>{monthLabel(monthDate)}</div>
              <button onClick={()=>setMonthDate(new Date(monthDate.getFullYear(), monthDate.getMonth()+1, 1))}>▶︎</button>
            </div>

            <div style={{background:'#fff',borderRadius:12,padding:12,boxShadow:'0 1px 2px rgba(0,0,0,.06)', color:'#000'}}>
              <CalendarGrid />
            </div>

            {/* Selected day movement + input */}
            <div style={{marginTop:12, background:'#fff', borderRadius:12, padding:12, boxShadow:'0 1px 2px rgba(0,0,0,.06)', color:'#000'}}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:8}}>
                <div>
                  <div style={{fontSize:12,color:'#000'}}>Selected: {iso(selectedDate)}</div>
                  <div style={{fontWeight:700,color:'#000'}}>{movementForDate(selectedDate).name}</div>
                  <div style={{fontSize:12,color:'#000'}}>Units: {movementForDate(selectedDate).unit}</div>
                </div>
                <div style={{display:'flex',gap:8}}>
                  <input
                    type="number"
                    inputMode="decimal"
                    placeholder={`Enter ${movementForDate(selectedDate).unit}`}
                    value={inputVal}
                    onChange={(e)=>setInputVal(e.target.value)}
                    style={{padding:10,border:'1px solid #ddd',borderRadius:10,width:140}}
                  />
                  <button onClick={saveEntry} style={{padding:'10px 12px',borderRadius:10,background:'#000',color:'#fff'}}>Save</button>
                </div>
              </div>
            </div>
          </section>
        )}

        {tab === 'database' && (
          <section>
            {Object.values(MOVEMENTS).map((m) => {
              const rows = (seriesByMovement[m.name] || []).slice(-20);
              const data = rows.map(r => ({ ...r, shortDate: r.date.slice(5) })); // "MM-DD"
              return (
                <div key={m.key} style={{marginBottom:12, background:'#fff', borderRadius:12, padding:12, boxShadow:'0 1px 2px rgba(0,0,0,.06)'}}>
                  <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:6}}>
                    <div style={{fontWeight:700, color:'#000'}}>{m.name}</div>
                    <div style={{fontSize:12,color:'#000'}}>{rows.length} entries • {m.unit}</div>
                  </div>
                  <div style={{width:'100%', height:220}}>
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
                          formatter={(val) => [`${val} ${m.unit}`, 'Value']}
                        />
                        <Line type="monotone" dataKey="value" stroke="#000" strokeWidth={3} dot={{ r: 4 }} />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              );
            })}
          </section>
        )}

        {tab === 'leaderboard' && (
          <section>
            <div style={{background:'#fff',borderRadius:12,padding:12,boxShadow:'0 1px 2px rgba(0,0,0,.06)', color:'#000'}}>
              <div style={{fontSize:12,color:'#000'}}>Today’s movement</div>
              <div style={{fontWeight:700,marginBottom:8,color:'#000'}}>{todaysMovement.name} <span style={{fontSize:12,color:'#000'}}>({todaysMovement.unit})</span></div>

              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8}}>
                {['male','female'].map((g) => (
                  <div key={g} style={{background:'#f6f7f9',border:'1px solid #eee',borderRadius:12,padding:10, color:'#000'}}>
                    <div style={{fontWeight:700,textTransform:'capitalize', color:'#000'}}>Top 5 {g}</div>
                    <ol style={{marginTop:6,display:'grid',gap:6}}>
                      {leaderboard[g].length ? leaderboard[g].map((r,i)=>(
                        <li key={r.id} style={{display:'flex',justifyContent:'space-between',background:'#fff',border:'1px solid #eee',borderRadius:10,padding:'8px 10px', color:'#000'}}>
                          <span style={{fontSize:14, color:'#000'}}>{i+1}. {(r.name||'Member').split(' ')[0]}</span>
                          <span style={{fontSize:14,fontWeight:700, color:'#000'}}>{r.value} {todaysMovement.unit}</span>
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
                  style={{
                    padding:'8px 12px',
                    border:'1px solid #ccc',
                    borderRadius:10,
                    background:'#f0f0f0',
                    color:'#000',
                    cursor:'pointer'
                  }}
                >
                  Close
                </button>
                <button
                  onClick={saveProfile}
                  style={{
                    padding:'8px 12px',
                    border:'1px solid #111',
                    borderRadius:10,
                    background:'#000',
                    color:'#fff',
                    cursor:'pointer'
                  }}
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
