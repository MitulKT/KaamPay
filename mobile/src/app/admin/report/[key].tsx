import { useLocalSearchParams } from 'expo-router';
import React from 'react';

import { ReportView } from '@/components/Reports';

export default function AdminReport() {
  const { key } = useLocalSearchParams<{ key: string }>();
  return <ReportView reportKey={key} />;
}
