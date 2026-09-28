import { router } from 'expo-router';
import React, { useState } from 'react';

import { Btn, ErrorText, Field, Muted, Screen } from '@/components/ui';
import { useAuth } from '@/lib/auth';

/** Owner registers the company. Becomes Admin + Supervisor. */
export default function Signup() {
  const auth = useAuth();
  const [company, setCompany] = useState('');
  const [owner, setOwner] = useState('');
  const [mobile, setMobile] = useState('');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const run = async (fn: () => Promise<void>) => {
    setErr(null);
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <ErrorText error={err} />
      <Field label="Company name" value={company} onChangeText={setCompany} placeholder="e.g. Shree Garments" />
      <Field label="Your name" value={owner} onChangeText={setOwner} />
      <Field label="Mobile (+91)" value={mobile} onChangeText={(v) => setMobile(v.replace(/\D/g, '').slice(0, 10))} keyboardType="number-pad" />
      {!sent ? (
        <Btn title="Send OTP" disabled={!company || !owner || mobile.length !== 10} loading={busy} onPress={() => run(async () => { await auth.requestOtp(mobile); setSent(true); })} />
      ) : (
        <>
          <Field label="OTP" value={code} onChangeText={(v) => setCode(v.replace(/\D/g, '').slice(0, 6))} keyboardType="number-pad" />
          <Btn
            title="Create company"
            disabled={code.length !== 6}
            loading={busy}
            onPress={() =>
              run(async () => {
                await auth.signup({ company_name: company, owner_name: owner, mobile, code });
                router.replace('/role');
              })
            }
          />
        </>
      )}
      <Muted style={{ marginTop: 16 }}>You become Admin + Supervisor. Add workers and supervisors after this.</Muted>
    </Screen>
  );
}
