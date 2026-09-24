import { useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';

import { PrimaryButton } from '@/components/ui/PrimaryButton';
import { SURFACE } from '@/constants/theme';
import {
  FRIEND_CODE_LENGTH,
  formatFriendCode,
  friendCodeDigits,
  ProfileError,
  saveProfile,
  TEAMS,
  type MyProfile,
  type Team,
} from '@/lib/api/profile';

const TEAM_COLORS: Record<Team, string> = {
  Mystic: '#4fb3ff',
  Valor: '#ff5c8a',
  Instinct: '#f5c518',
};

const INPUT_CLASS = 'rounded-[14px] border border-border bg-bg-card px-4 py-[14px]';

interface ProfileFormProps {
  /** Whatever the profile already holds, so a half-finished setup resumes where it stopped. */
  initial: MyProfile | null;
  /** Called after both updates succeeded, i.e. once `private.profile_ready()` is true. */
  onSaved: () => void;
}

/** Handle, team and friend code: the three things `profile_ready()` needs before RLS lets a trainer post. */
export function ProfileForm({ initial, onSaved }: ProfileFormProps) {
  const [handle, setHandle] = useState(initial && !initial.handleIsPlaceholder ? initial.handle : '');
  const [team, setTeam] = useState<Team | null>(initial?.team ?? null);
  const [friendCode, setFriendCode] = useState(initial?.friendCode ? formatFriendCode(initial.friendCode) : '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ProfileError | null>(null);

  const complete = handle.trim().length > 0 && team !== null && friendCodeDigits(friendCode).length === FRIEND_CODE_LENGTH;

  const submit = async () => {
    if (!team || busy) return;
    setBusy(true);
    setError(null);
    try {
      await saveProfile({ handle, team, friendCode });
      onSaved();
    } catch (reason) {
      setError(reason instanceof ProfileError ? reason : new ProfileError('form', 'Something went wrong. Try again.'));
    } finally {
      setBusy(false);
    }
  };

  const errorFor = (field: ProfileError['field']) => (error?.field === field ? error.message : null);

  return (
    <View className="mt-7 gap-5">
      <View className="gap-2">
        <Label>Trainer name</Label>
        <TextInput
          value={handle}
          onChangeText={(text) => setHandle(text.replace(/[^A-Za-z0-9]/g, '').slice(0, 15))}
          placeholder="DriftCoral"
          placeholderTextColor="#6d7690"
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="username"
          textContentType="username"
          maxLength={15}
          editable={!busy}
          accessibilityLabel="Trainer name"
          className={INPUT_CLASS}
          style={{ fontSize: 15, color: '#e8ecf5' }}
        />
        <Hint message={errorFor('handle')} fallback="3 to 15 letters or digits. Other trainers see this." />
      </View>

      <View className="gap-2">
        <Label>Team</Label>
        <View className="flex-row gap-2">
          {TEAMS.map((name) => {
            const selected = team === name;
            const color = TEAM_COLORS[name];
            return (
              <Pressable
                key={name}
                onPress={() => setTeam(name)}
                disabled={busy}
                accessibilityRole="radio"
                accessibilityLabel={`Team ${name}`}
                accessibilityState={{ selected }}
                className="flex-1 items-center rounded-[14px] border py-3 active:opacity-80"
                style={
                  selected
                    ? { borderColor: color, backgroundColor: `${color}1f` }
                    : { borderColor: '#1a2032', backgroundColor: '#0f1524' }
                }
              >
                <Text className="font-display-semi" style={{ fontSize: 13, color: selected ? color : '#8b93a7' }}>
                  {name}
                </Text>
              </Pressable>
            );
          })}
        </View>
        {errorFor('team') ? <Hint message={errorFor('team')} /> : null}
      </View>

      <View className="gap-2">
        <Label>Friend code</Label>
        <TextInput
          value={friendCode}
          onChangeText={(text) => setFriendCode(formatFriendCode(text))}
          placeholder="0000 0000 0000"
          placeholderTextColor="#4a5169"
          keyboardType="number-pad"
          maxLength={FRIEND_CODE_LENGTH + 2}
          editable={!busy}
          accessibilityLabel="Pokémon GO friend code"
          className={`${INPUT_CLASS} font-mono-semi`}
          style={{ fontSize: 17, letterSpacing: 2, color: '#e8ecf5' }}
        />
        <Hint
          message={errorFor('friendCode')}
          fallback="Shared only with the trainer whose trade you accept, never shown on your profile."
        />
      </View>

      {errorFor('form') ? <Hint message={errorFor('form')} /> : null}

      <PrimaryButton
        label={busy ? 'Saving…' : 'Finish setup'}
        style={SURFACE.ctaBlue}
        textColor="#04121f"
        disabled={busy || !complete}
        onPress={submit}
      />
    </View>
  );
}

function Label({ children }: { children: string }) {
  return (
    <Text className="font-mono uppercase text-text-subtle" style={{ fontSize: 11, letterSpacing: 1.1 }}>
      {children}
    </Text>
  );
}

/** Field help text; an error replaces it and turns red. */
function Hint({ message, fallback }: { message: string | null; fallback?: string }) {
  if (message) {
    return (
      <Text accessibilityRole="alert" className="font-display-med text-accent-danger" style={{ fontSize: 12 }}>
        {message}
      </Text>
    );
  }
  return fallback ? (
    <Text className="font-display-med text-text-subtle" style={{ fontSize: 12, lineHeight: 17 }}>
      {fallback}
    </Text>
  ) : null;
}
