import React, { useState } from 'react';
import { supabase } from './lib/supabase';

export default function Login() {
  const [email, setEmail] = useState('');
  const [msg, setMsg] = useState('');

  async function handleLogin(e) {
    e.preventDefault();
    const { error } = await supabase.auth.signInWithOtp({ email });
    setMsg(error ? error.message : '✅ Magic link sent! Check your email.');
  }

  return (
    <div style={{ textAlign: 'center' }}>
      <h1>MOM3NT DATA Login</h1>
      <form onSubmit={handleLogin}>
        <input
          type="email"
          placeholder="you@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          style={{ padding: 10, width: 260 }}
          required
        />
        <br /><br />
        <button type="submit" style={{ padding: '10px 20px', background: '#dca636', border: 'none', cursor: 'pointer' }}>
          Send Magic Link
        </button>
      </form>
      <p>{msg}</p>
    </div>
  );
}
