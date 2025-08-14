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
const iso = (d) => d.toISOString().slice(0,10);
const dayName = (d) => d.toLocaleDateString('en-US', { weekday: 'long' });
const monthLabel = (d) => d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
const range = (n) => Array.from({length: n}, (_,i) => i);

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

  // Login form (PWA-friendly)
  const [email, setEmail]   = useState('');
  const [pasted, setPasted] = useState(''); // paste the email link or code

  // Profile (sync with Supabase; also mirrored locally)
  const [profileOpen, setProfileOpen] = useState(false);
  const [name,   setName]   = useState(localStorage.getItem('mom3nt_name')   || '');
  const [gender, setGender] = useState(localStorage.getItem('mom3nt_gender') || '');

  // UI
  const [tab, setTab] = useState('calendar'); // calendar | database | leaderboard
  const [monthDate,    setMonthDate]    = useState(new Date());
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [inputVal,     setInputVal]     = useState('');

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
  const leaderboard = useMemo(() =>

