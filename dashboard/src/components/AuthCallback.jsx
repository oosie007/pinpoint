import { useEffect, useState } from 'react';
import { supabase } from '../supabaseClient';

export default function AuthCallback() {
  const [status, setStatus] = useState('Completing sign-in…');

  useEffect(() => {
    async function finish() {
      const hash = window.location.hash.replace(/^#/, '');
      if (hash) {
        const params = new URLSearchParams(hash);
        const access_token = params.get('access_token');
        const refresh_token = params.get('refresh_token');
        if (access_token && refresh_token) {
          const { error } = await supabase.auth.setSession({
            access_token,
            refresh_token,
          });
          if (error) {
            setStatus(error.message);
            return;
          }
          window.location.replace('/');
          return;
        }
      }
      const { data, error } = await supabase.auth.getSession();
      if (error) setStatus(error.message);
      else if (data.session) window.location.replace('/');
      else setStatus('No session found. Request a new magic link.');
    }
    finish();
  }, []);

  return (
    <div className="auth-screen">
      <h1 className="wordmark">Pinpoint</h1>
      <p className="auth-msg">{status}</p>
    </div>
  );
}
