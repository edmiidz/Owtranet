import React, { useState } from 'react';
import { Alert, Image, View } from 'react-native';
import { useRouter } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { deliverablesApi, ledgerApi } from '@/api';
import { errorMessage } from '@/api/client';
import { useAuthStore } from '@/stores/auth';
import { Button, Card, Chip, Input, P, Screen, Small } from '@/components/ui';

const CATEGORIES = ['office_supplies', 'travel', 'meals', 'software', 'hardware', 'professional_services', 'marketing', 'utilities', 'rent', 'insurance', 'maintenance', 'other'];
const CURRENCIES = ['USD', 'CAD', 'EUR', 'GBP', 'JPY'];

export default function NewExpenseScreen() {
  const router = useRouter();
  const branding = useAuthStore(s => s.branding);
  const [photo, setPhoto] = useState<string | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [title, setTitle] = useState('');
  const [vendor, setVendor] = useState('');
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState(branding?.baseCurrency || 'USD');
  const [category, setCategory] = useState('other');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [receiptNo, setReceiptNo] = useState('');
  const [project, setProject] = useState('');
  const [notes, setNotes] = useState('');
  const [reimbursable, setReimbursable] = useState(true);
  const [busy, setBusy] = useState(false);

  async function capture(fromCamera: boolean) {
    const perm = fromCamera ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) { Alert.alert('Permission needed'); return; }
    const res = fromCamera
      ? await ImagePicker.launchCameraAsync({ quality: 0.7 })
      : await ImagePicker.launchImageLibraryAsync({ quality: 0.7, mediaTypes: ['images'] });
    if (res.canceled || !res.assets?.[0]) return;
    const a = res.assets[0];
    setPhoto(a.uri);
    setAnalyzing(true);
    try {
      const form = new FormData();
      form.append('document', { uri: a.uri, name: a.fileName || 'receipt.jpg', type: a.mimeType || 'image/jpeg' } as any);
      const r = await deliverablesApi.analyzeDocument(form);
      const an = r.analysis || {};
      if (an.suggestedTitle && !title) setTitle(an.suggestedTitle);
      if (an.suggestedAmount != null) setAmount(String(an.suggestedAmount));
      if (an.currency && CURRENCIES.includes(an.currency)) setCurrency(an.currency);
      if (an.category && CATEGORIES.includes(an.category)) setCategory(an.category);
      if (an.vendor || an.vendorName) setVendor(an.vendor || an.vendorName);
      if (an.date && /^\d{4}-\d{2}-\d{2}/.test(an.date)) setDate(an.date.slice(0, 10));
      if (an.description) setNotes(an.description);
    } catch (e) { Alert.alert('Could not read the receipt', errorMessage(e) + '\nYou can still fill the form by hand.'); }
    finally { setAnalyzing(false); }
  }

  async function submit(asDraft: boolean) {
    if (!title.trim()) { Alert.alert('Title is required'); return; }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { Alert.alert('Date must be YYYY-MM-DD'); return; }
    setBusy(true);
    try {
      const amt = amount ? Number(amount) : undefined;
      await ledgerApi.create({
        title: title.trim(), vendor_name: vendor || undefined, expense_category: category, expense_date: date,
        original_amount: amt, original_currency: currency, amount: currency === (branding?.baseCurrency || 'USD') ? amt : undefined,
        total_with_tax: currency === (branding?.baseCurrency || 'USD') ? amt : undefined,
        receipt_number: receiptNo || undefined, project_code: project || undefined, description: notes || undefined,
        is_reimbursable: reimbursable, status: asDraft ? 'draft' : 'pending', is_draft: asDraft, source: 'manual',
      });
      router.back();
    } catch (e) { Alert.alert('Could not save', errorMessage(e)); }
    finally { setBusy(false); }
  }

  return (
    <Screen>
      <Card>
        <View style={{ flexDirection: 'row', gap: 10, marginBottom: 12 }}>
          <Button title="Snap receipt" icon="camera-outline" variant="secondary" onPress={() => capture(true)} loading={analyzing} style={{ flex: 1 }} />
          <Button title="Choose photo" icon="image-outline" variant="secondary" onPress={() => capture(false)} disabled={analyzing} style={{ flex: 1 }} />
        </View>
        {photo ? <Image source={{ uri: photo }} style={{ width: '100%', height: 160, borderRadius: 10, marginBottom: 12 }} resizeMode="cover" /> : null}
        {analyzing ? <Small style={{ marginBottom: 10 }}>Reading the receipt with AI…</Small> : null}
        <Input label="Title" value={title} onChangeText={setTitle} placeholder="Team lunch, SaaS renewal…" />
        <Input label="Vendor" value={vendor} onChangeText={setVendor} />
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <View style={{ flex: 1 }}><Input label="Amount (incl. tax)" value={amount} onChangeText={setAmount} keyboardType="decimal-pad" /></View>
          <View style={{ flex: 1 }}><Input label="Date" value={date} onChangeText={setDate} placeholder="YYYY-MM-DD" /></View>
        </View>
        <Small style={{ fontWeight: '600', marginBottom: 6 }}>Currency</Small>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginBottom: 8 }}>{CURRENCIES.map(c => <Chip key={c} label={c} active={currency === c} onPress={() => setCurrency(c)} />)}</View>
        <Small style={{ fontWeight: '600', marginBottom: 6 }}>Category</Small>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginBottom: 8 }}>{CATEGORIES.map(c => <Chip key={c} label={c.replace(/_/g, ' ')} active={category === c} onPress={() => setCategory(c)} />)}</View>
        <Input label="Receipt / invoice number" value={receiptNo} onChangeText={setReceiptNo} />
        <Input label="Project code" value={project} onChangeText={setProject} autoCapitalize="none" />
        <Input label="Notes" value={notes} onChangeText={setNotes} multiline />
        <Chip label={reimbursable ? '✓ Reimbursable to me' : 'Not reimbursable'} active={reimbursable} onPress={() => setReimbursable(v => !v)} />
        <View style={{ height: 12 }} />
        <Button title="Submit for approval" onPress={() => submit(false)} loading={busy} />
        <Button title="Save as draft" variant="ghost" onPress={() => submit(true)} disabled={busy} style={{ marginTop: 6 }} />
      </Card>
      <P muted>The receipt image is used for AI extraction. Attach the file to the entry on the web intranet if it needs to be stored.</P>
    </Screen>
  );
}
