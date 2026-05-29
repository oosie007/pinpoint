import { useEffect, useState } from 'react';
import { supabase } from '../supabaseClient';

export default function InvitePage({ token }) {
  const [status, setStatus] = useState('Loading…');
  const [signedIn, setSignedIn] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSignedIn(!!data.session);
      if (!data.session) {
        setStatus('Sign in with the same email that received the invite, then return to this page.');
      }
    });
  }, []);

  useEffect(() => {
    if (!signedIn || !token) return;

    async function accept() {
      const { data: rows, error: fetchError } = await supabase
        .from('prototype_members')
        .select('id, email, accepted_at')
        .eq('invite_token', token)
        .limit(1);
      const members = rows?.[0];

      if (fetchError || !members) {
        setStatus('Invite not found or expired.');
        return;
      }

      if (members.accepted_at) {
        setStatus('Invite already accepted. Open the Pinpoint extension on your prototype.');
        return;
      }

      const { data: userData } = await supabase.auth.getUser();
      const userEmail = userData.user?.email?.toLowerCase();
      if (userEmail !== members.email?.toLowerCase()) {
        setStatus(`This invite was sent to ${members.email}. Sign in with that email.`);
        return;
      }

      const { error: updateError } = await supabase
        .from('prototype_members')
        .update({
          user_id: userData.user.id,
          accepted_at: new Date().toISOString(),
        })
        .eq('id', members.id);

      if (updateError) {
        setStatus(updateError.message);
        return;
      }

      setStatus('Invite accepted. Install or open the Pinpoint Chrome extension and visit your prototype URL.');
    }

    accept();
  }, [signedIn, token]);

  const extensionHint = token
    ? `chrome-extension://YOUR_EXTENSION_ID/popup.html?invite=${token}`
    : '';

  return (
    <div className="auth-screen">
      <h1 className="wordmark">Pinpoint invite</h1>
      <p className="auth-msg">{status}</p>
      {!signedIn && (
        <p className="auth-lead">
          <a href="/">Sign in on the dashboard</a> first, then reload this page.
        </p>
      )}
      {signedIn && token && (
        <p className="auth-hint">
          Or open the extension popup with invite token:{' '}
          <code>{extensionHint}</code>
        </p>
      )}
    </div>
  );
}
