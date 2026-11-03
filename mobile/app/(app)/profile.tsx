import React, { useState } from 'react';
import { Alert, Pressable, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { usersApi } from '@/api';
import { errorMessage } from '@/api/client';
import { useAuthStore } from '@/stores/auth';
import { Avatar, Button, Card, H2, Input, Screen, Small } from '@/components/ui';

export default function ProfileScreen() {
  const { user, updateUser } = useAuthStore();
  const [bio, setBio] = useState(user?.bio || '');
  const [position, setPosition] = useState(user?.position || '');
  const [department, setDepartment] = useState(user?.department || '');
  const [company, setCompany] = useState(user?.company || '');
  const [telephone, setTelephone] = useState(user?.telephone || '');
  const [calendar, setCalendar] = useState(user?.calendar_link || '');
  const [cur, setCur] = useState(''); const [next, setNext] = useState(''); const [next2, setNext2] = useState('');
  const [busy, setBusy] = useState(false);

  async function save() {
    if (!user) return;
    setBusy(true);
    try {
      await usersApi.update(user.id, { bio, position, department, company, telephone, calendar_link: calendar });
      updateUser({ bio, position, department, company, telephone, calendar_link: calendar });
      Alert.alert('Saved');
    } catch (e) { Alert.alert('Could not save', errorMessage(e)); }
    finally { setBusy(false); }
  }

  async function changeAvatar() {
    if (!user) return;
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return;
    const res = await ImagePicker.launchImageLibraryAsync({ quality: 0.8, allowsEditing: true, aspect: [1, 1], mediaTypes: ['images'] });
    if (res.canceled || !res.assets?.[0]) return;
    const a = res.assets[0];
    const form = new FormData();
    form.append('avatar', { uri: a.uri, name: a.fileName || 'avatar.jpg', type: a.mimeType || 'image/jpeg' } as any);
    try { const r = await usersApi.uploadAvatar(user.id, form); updateUser({ avatar_url: r.avatar_url }); }
    catch (e) { Alert.alert('Upload failed', errorMessage(e)); }
  }

  async function changePassword() {
    if (!user) return;
    if (next.length < 8 || next !== next2) { Alert.alert('Passwords must match and be at least 8 characters'); return; }
    try { await usersApi.changePassword(user.id, cur, next); setCur(''); setNext(''); setNext2(''); Alert.alert('Password changed'); }
    catch (e) { Alert.alert('Could not change password', errorMessage(e)); }
  }

  return (
    <Screen>
      <View style={{ alignItems: 'center', marginBottom: 14 }}>
        <Pressable onPress={changeAvatar}><Avatar uri={user?.avatar_url} name={user?.name} size={92} /></Pressable>
        <Small style={{ marginTop: 6 }}>Tap to change photo</Small>
      </View>
      <Card>
        <Input label="Position" value={position} onChangeText={setPosition} />
        <Input label="Department" value={department} onChangeText={setDepartment} />
        <Input label="Company" value={company} onChangeText={setCompany} />
        <Input label="Phone" value={telephone} onChangeText={setTelephone} keyboardType="phone-pad" />
        <Input label="Calendar link" value={calendar} onChangeText={setCalendar} autoCapitalize="none" keyboardType="url" />
        <Input label="Bio" value={bio} onChangeText={setBio} multiline />
        <Button title="Save profile" onPress={save} loading={busy} />
      </Card>
      <Card>
        <H2 style={{ marginTop: 0 }}>Change password</H2>
        <Input label="Current password" value={cur} onChangeText={setCur} secureTextEntry />
        <Input label="New password" value={next} onChangeText={setNext} secureTextEntry />
        <Input label="Repeat new password" value={next2} onChangeText={setNext2} secureTextEntry />
        <Button title="Update password" variant="secondary" onPress={changePassword} />
      </Card>
    </Screen>
  );
}
