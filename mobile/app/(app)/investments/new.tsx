import React, { useState } from 'react';
import { Alert, View } from 'react-native';
import { useRouter } from 'expo-router';
import { deliverablesApi } from '@/api';
import { errorMessage } from '@/api/client';
import { useAuthStore } from '@/stores/auth';
import { Button, Card, Chip, Input, P, Screen, Small } from '@/components/ui';

const CATEGORIES = [['sweat_equity', 'Sweat equity'], ['cash', 'Cash'], ['property', 'Property'], ['referral', 'Referral']] as const;
const CURRENCIES = ['USD', 'CAD', 'EUR', 'GBP', 'JPY'];

export default function NewDeliverableScreen() {
  const router = useRouter();
  const branding = useAuthStore(s => s.branding);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState(branding?.baseCurrency || 'USD');
  const [category, setCategory] = useState<string>('sweat_equity');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [tags, setTags] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(is_draft: boolean) {
    if (!title.trim()) { Alert.alert('Title is required'); return; }
    setBusy(true);
    try {
      await deliverablesApi.create({
        title: title.trim(), content: content.trim() || undefined, original_amount: amount ? Number(amount) : undefined,
        original_currency: currency, investment_category: category, deliverable_date: date,
        tags: tags.split(',').map(x => x.trim()).filter(Boolean), is_draft,
      });
      router.back();
    } catch (e) { Alert.alert('Could not submit', errorMessage(e)); }
    finally { setBusy(false); }
  }

  return (
    <Screen>
      <Card>
        <Input label="Title" value={title} onChangeText={setTitle} placeholder="What did you deliver?" />
        <Input label="Details (markdown)" value={content} onChangeText={setContent} multiline placeholder="Scope, outcome, links…" />
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <View style={{ flex: 1 }}><Input label="Amount" value={amount} onChangeText={setAmount} keyboardType="decimal-pad" /></View>
          <View style={{ flex: 1 }}><Input label="Date" value={date} onChangeText={setDate} placeholder="YYYY-MM-DD" /></View>
        </View>
        <Small style={{ fontWeight: '600', marginBottom: 6 }}>Currency</Small>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginBottom: 8 }}>{CURRENCIES.map(c => <Chip key={c} label={c} active={currency === c} onPress={() => setCurrency(c)} />)}</View>
        <Small style={{ fontWeight: '600', marginBottom: 6 }}>Investment category</Small>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginBottom: 8 }}>{CATEGORIES.map(([k, l]) => <Chip key={k} label={l} active={category === k} onPress={() => setCategory(k)} />)}</View>
        <Input label="Tags (comma separated)" value={tags} onChangeText={setTags} autoCapitalize="none" />
        <Button title="Submit" onPress={() => submit(false)} loading={busy} />
        <Button title="Save as draft" variant="ghost" onPress={() => submit(true)} disabled={busy} style={{ marginTop: 6 }} />
      </Card>
      <P muted>Approved deliverables are valued with the instance's risk multiplier and appear in the investment ledger.</P>
    </Screen>
  );
}
