import React, { useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { Btn, Card, Empty, Field, Loading, Muted, Row, Screen, Sheet } from '@/components/ui';
import { get, post, put } from '@/lib/api';
import { notify, useData } from '@/lib/hooks';
import { C } from '@/lib/theme';
import type { WorkType } from '@/lib/types';

/** Work type master with EN/HI/GU names, sequence (↑↓) and activate/deactivate. */
export default function WorkTypes() {
  const { data, setData, loading, reload } = useData(() => get<WorkType[]>('/work-types', { include_inactive: true }), []);
  const [edit, setEdit] = useState<Partial<WorkType> | null>(null);

  const save = async () => {
    if (!edit) return;
    try {
      const body = { code: edit.code, name_en: edit.name_en || edit.code, name_hi: edit.name_hi || '', name_gu: edit.name_gu || '', icon: 'cut', sequence_no: edit.sequence_no ?? (data?.length || 0) + 1, is_active: edit.is_active ?? true };
      if (edit.id) await put(`/work-types/${edit.id}`, body);
      else await post('/work-types', body);
      setEdit(null);
      reload();
    } catch (e) {
      notify((e as Error).message);
    }
  };

  const move = async (i: number, d: -1 | 1) => {
    const list = [...(data || [])];
    const j = i + d;
    if (j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    setData(list);
    await post('/work-types/reorder', list.map((w) => w.id));
  };

  if (loading && !data) return <Loading />;
  return (
    <Screen footer={<Btn icon="add" title="Add work type" onPress={() => setEdit({ is_active: true })} />}>
      {!data?.length ? (
        <Empty
          text="No work types yet"
          action={<Btn title="Load 27 standard operations" onPress={async () => { await post('/work-types/seed-defaults'); reload(); }} />}
        />
      ) : null}
      {data?.map((w, i) => (
        <Card key={w.id} style={{ padding: 12, opacity: w.is_active ? 1 : 0.5 }} onPress={() => setEdit(w)}>
          <Row>
            <View style={{ flex: 1 }}>
              <Text style={{ fontWeight: '800' }}>{w.code}</Text>
              <Muted>
                {w.name_hi || '—'} · {w.name_gu || '—'} {w.is_active ? '' : '· inactive'}
              </Muted>
            </View>
            <Pressable onPress={() => move(i, -1)} hitSlop={8}>
              <Text style={{ fontSize: 20, color: C.primary }}>↑</Text>
            </Pressable>
            <Pressable onPress={() => move(i, 1)} hitSlop={8}>
              <Text style={{ fontSize: 20, color: C.primary }}>↓</Text>
            </Pressable>
          </Row>
        </Card>
      ))}
      <Sheet visible={!!edit} onClose={() => setEdit(null)}>
        <Field label="Code (English)" value={edit?.code || ''} onChangeText={(v) => setEdit((p) => ({ ...p, code: v.toUpperCase() }))} autoCapitalize="characters" />
        <Field label="Hindi name" value={edit?.name_hi || ''} onChangeText={(v) => setEdit((p) => ({ ...p, name_hi: v }))} />
        <Field label="Gujarati name" value={edit?.name_gu || ''} onChangeText={(v) => setEdit((p) => ({ ...p, name_gu: v }))} />
        <Row>
          {edit?.id ? <Btn outline color={C.muted} title={edit.is_active ? 'Deactivate' : 'Activate'} onPress={() => setEdit((p) => ({ ...p, is_active: !p?.is_active }))} /> : null}
          <Btn style={{ flex: 1 }} title="Save" disabled={!edit?.code} onPress={save} />
        </Row>
      </Sheet>
    </Screen>
  );
}
