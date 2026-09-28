import { Redirect } from 'expo-router';
import React from 'react';

import { Loading } from '@/components/ui';
import { homeFor, useAuth } from '@/lib/auth';

export default function Index() {
  const { ready, user, role } = useAuth();
  if (!ready) return <Loading full />;
  if (!user) return <Redirect href="/login" />;
  return <Redirect href={homeFor(role) as never} />;
}
