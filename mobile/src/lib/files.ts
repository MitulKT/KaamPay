import { Directory, File, Paths } from 'expo-file-system';
import * as ImageManipulator from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { Platform } from 'react-native';

import { API_URL, api } from './api';
import { secure } from './storage';

/** Opens the camera, compresses to ~1024px JPEG (well under 300 KB), uploads, returns the server URL. */
export async function takeAndUploadPhoto(): Promise<string | null> {
  const perm = await ImagePicker.requestCameraPermissionsAsync();
  if (!perm.granted) throw new Error('Camera permission denied');
  const res = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.7 });
  if (res.canceled || !res.assets?.[0]) return null;
  return uploadImage(res.assets[0].uri);
}

export async function pickAndUploadPhoto(): Promise<string | null> {
  const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.7 });
  if (res.canceled || !res.assets?.[0]) return null;
  return uploadImage(res.assets[0].uri);
}

async function uploadImage(uri: string): Promise<string> {
  const ctx = ImageManipulator.ImageManipulator.manipulate(uri).resize({ width: 1024 });
  const img = await ctx.renderAsync();
  const out = await img.saveAsync({ compress: 0.55, format: ImageManipulator.SaveFormat.JPEG });
  const form = new FormData();
  if (Platform.OS === 'web') {
    const blob = await (await fetch(out.uri)).blob();
    form.append('file', blob, 'photo.jpg');
  } else {
    form.append('file', { uri: out.uri, name: 'photo.jpg', type: 'image/jpeg' } as unknown as Blob);
  }
  const d = await api<{ url: string }>('/uploads', { form });
  return d.url;
}

/** Fetches the HTML settlement slip, turns it into a PDF and opens the share sheet (WhatsApp etc.). */
export async function shareSlip(cycleId: string, workerId: string): Promise<void> {
  const html = await api<string>(`/payouts/cycles/${cycleId}/slip/${workerId}`);
  if (Platform.OS === 'web') {
    const w = window.open('', '_blank');
    w?.document.write(html);
    w?.document.close();
    w?.print();
    return;
  }
  const { uri } = await Print.printToFileAsync({ html });
  await Sharing.shareAsync(uri, { mimeType: 'application/pdf', dialogTitle: 'Share slip', UTI: 'com.adobe.pdf' });
}

/** Downloads an authenticated export (xlsx/csv) and opens share / save. */
export async function downloadExport(path: string, filename: string, params?: Record<string, string>): Promise<void> {
  const token = await secure.get('access');
  const q = params ? `?${new URLSearchParams(params).toString()}` : '';
  const url = `${API_URL}/api${path}${q}`;
  if (Platform.OS === 'web') {
    const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    const blob = await r.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    return;
  }
  const dir = new Directory(Paths.cache, 'exports');
  if (!dir.exists) dir.create();
  const file = await File.downloadFileAsync(url, new File(dir, filename), {
    headers: { Authorization: `Bearer ${token}` },
    idempotent: true,
  });
  await Sharing.shareAsync(file.uri);
}

/** Picks an .xlsx and uploads it to the import preview endpoint. */
export async function pickExcelAndPreview(): Promise<any | null> {
  const form = new FormData();
  if (Platform.OS === 'web') {
    const f = await new Promise<globalThis.File | null>((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.xlsx';
      input.onchange = () => resolve(input.files?.[0] ?? null);
      input.click();
    });
    if (!f) return null;
    form.append('file', f, f.name);
  } else {
    const res = await File.pickFileAsync({
      mimeTypes: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
    });
    if (res.canceled) return null;
    form.append('file', {
      uri: res.result.uri,
      name: res.result.name || 'data.xlsx',
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    } as unknown as Blob);
  }
  return api('/import/preview', { form });
}
