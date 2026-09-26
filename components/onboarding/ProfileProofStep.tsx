import { Image } from 'expo-image';
import { Camera, X } from 'lucide-react-native';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';

import { ProfileForm } from '@/components/onboarding/ProfileForm';
import { TeamPicker } from '@/components/onboarding/TeamPicker';
import { PrimaryButton } from '@/components/ui/PrimaryButton';
import { SURFACE } from '@/constants/theme';
import {
  describeProofFailure,
  fetchLatestProfileProof,
  fetchMyProfile,
  isProfileReady,
  saveTeam,
  uploadProfileProof,
  type MyProfile,
  type ProfileProofFailure,
  type Team,
} from '@/lib/api/profile';
import { formatBytes, pickProofImage, ProofImageError, type PickedProof } from '@/lib/proof-image';

/** How long one round of polling waits for the Azure Function before offering to keep waiting. */
const POLL_TIMEOUT_MS = 90_000;
const POLL_INTERVAL_MS = 2_000;

type Phase =
  | { kind: 'checking' } // resuming: is there already a pending/processing proof from before?
  | { kind: 'picking' }
  | { kind: 'uploading' }
  | { kind: 'polling' }
  | { kind: 'timeout' }
  | { kind: 'problem'; reason: ProfileProofFailure | null }
  | { kind: 'manual' };

interface ProfileProofStepProps {
  /** The freshly-loaded profile that got us here, i.e. `isProfileReady` was false for it. */
  profile: MyProfile;
  /** Called once `private.profile_ready()` is true, whichever path (OCR or manual) got it there. */
  onReady: () => void;
}

/**
 * "Screenshot first, manual fallback": a trainer picks their team, uploads the Pokémon GO "My Trainer
 * Code" screen, and an Azure Function OCRs handle + friend code onto the profile through a service-role
 * RPC (invisible to this component — it only ever polls `fetchLatestProfileProof`). If that read fails
 * or nothing comes back within 90s, the trainer can try again or fall back to typing the details in,
 * prefilled with whatever the OCR pass managed to read.
 */
export function ProfileProofStep({ profile, onReady }: ProfileProofStepProps) {
  const [phase, setPhase] = useState<Phase>({ kind: 'checking' });
  const [team, setTeam] = useState<Team | null>(profile.team);
  const [teamError, setTeamError] = useState<string | null>(null);
  const [picked, setPicked] = useState<PickedProof | null>(null);
  const [pickError, setPickError] = useState<string | null>(null);
  const [manualPrefill, setManualPrefill] = useState<{ handle?: string; friendCode?: string } | undefined>(undefined);
  const [freshProfile, setFreshProfile] = useState<MyProfile>(profile);

  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollDeadline = useRef<ReturnType<typeof setTimeout> | null>(null);

  const stopPolling = () => {
    if (pollTimer.current) {
      clearInterval(pollTimer.current);
      pollTimer.current = null;
    }
    if (pollDeadline.current) {
      clearTimeout(pollDeadline.current);
      pollDeadline.current = null;
    }
  };

  const checkLatestProof = async () => {
    let latest;
    try {
      latest = await fetchLatestProfileProof();
    } catch {
      return; // A transient read failure just waits for the next tick rather than giving up early.
    }
    if (!latest || latest.status === 'pending' || latest.status === 'processing') return;

    stopPolling();
    if (latest.status === 'verified') {
      try {
        const loaded = await fetchMyProfile();
        setFreshProfile(loaded);
        if (isProfileReady(loaded)) {
          onReady();
          return;
        }
        // The screenshot was read fine, but something else (most likely the team, if this ever races
        // ahead of `selectTeam`) is still missing — the manual form is the honest way to finish that.
        setManualPrefill({ handle: loaded.handle, friendCode: loaded.friendCode ?? undefined });
      } catch (reason) {
        setPickError(reason instanceof Error ? reason.message : 'Could not load your profile.');
      }
      setPhase({ kind: 'manual' });
      return;
    }

    // 'failed' or 'rejected': same recovery either way, just different copy.
    setManualPrefill({ handle: latest.handle ?? undefined, friendCode: latest.friendCode ?? undefined });
    setPhase({ kind: 'problem', reason: latest.reason });
  };

  const beginPolling = () => {
    stopPolling();
    setPhase({ kind: 'polling' });
    void checkLatestProof();
    pollTimer.current = setInterval(() => void checkLatestProof(), POLL_INTERVAL_MS);
    pollDeadline.current = setTimeout(() => {
      stopPolling();
      setPhase({ kind: 'timeout' });
    }, POLL_TIMEOUT_MS);
  };

  // Resume: a trainer who backgrounded the app (or reopened onboarding) mid-read should land back on
  // the polling state, never a picker that would let them fire off a second screenshot for nothing.
  useEffect(() => {
    let active = true;
    fetchLatestProfileProof()
      .then((latest) => {
        if (!active) return;
        if (latest && (latest.status === 'pending' || latest.status === 'processing')) beginPolling();
        else setPhase({ kind: 'picking' });
      })
      .catch((reason: unknown) => {
        if (!active) return;
        setPickError(reason instanceof Error ? reason.message : 'Could not check your profile.');
        setPhase({ kind: 'picking' });
      });
    return () => {
      active = false;
      stopPolling();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selectTeam = async (next: Team) => {
    const previous = team;
    setTeam(next);
    setTeamError(null);
    try {
      await saveTeam(next);
    } catch (reason) {
      setTeam(previous);
      setTeamError(reason instanceof Error ? reason.message : 'Could not save your team. Try again.');
    }
  };

  const choosePhoto = async () => {
    setPickError(null);
    try {
      const image = await pickProofImage();
      if (image) setPicked(image);
    } catch (reason) {
      setPickError(reason instanceof ProofImageError ? reason.message : 'Could not open your photos.');
    }
  };

  const upload = async () => {
    if (!picked || !team) return;
    setPickError(null);
    setPhase({ kind: 'uploading' });
    try {
      await uploadProfileProof(picked);
      setPicked(null);
      beginPolling();
    } catch (reason) {
      setPickError(reason instanceof Error ? reason.message : 'Something went wrong. Try again.');
      setPhase({ kind: 'picking' });
    }
  };

  const retryScreenshot = () => {
    setPicked(null);
    setPickError(null);
    setPhase({ kind: 'picking' });
  };

  const enterManually = () => setPhase({ kind: 'manual' });

  if (phase.kind === 'manual') {
    return <ProfileForm initial={freshProfile} prefill={manualPrefill} onSaved={onReady} />;
  }

  if (phase.kind === 'checking') {
    return <ActivityIndicator color="#4fb3ff" style={{ marginTop: 32 }} />;
  }

  if (phase.kind === 'polling' || phase.kind === 'timeout') {
    return (
      <View className="mt-7 gap-4 items-center">
        {phase.kind === 'polling' ? (
          <>
            <ActivityIndicator color="#4fb3ff" />
            <Text className="font-display-med text-text-muted text-center" style={{ fontSize: 13 }}>
              Reading your screenshot… this can take up to 90 seconds.
            </Text>
          </>
        ) : (
          <>
            <Text className="font-display-med text-text-muted text-center" style={{ fontSize: 13 }}>
              This is taking longer than usual.
            </Text>
            <View className="w-full gap-3">
              <PrimaryButton label="Keep waiting" style={SURFACE.ctaBlue} textColor="#04121f" onPress={beginPolling} />
              <SecondaryLink label="Enter details manually" onPress={enterManually} />
            </View>
          </>
        )}
      </View>
    );
  }

  if (phase.kind === 'problem') {
    return (
      <View className="mt-7 gap-4">
        <ErrorText
          message={phase.reason ? describeProofFailure(phase.reason) : 'That screenshot could not be used.'}
        />
        <PrimaryButton label="Try another screenshot" style={SURFACE.ctaBlue} textColor="#04121f" onPress={retryScreenshot} />
        <SecondaryLink label="Enter details manually" onPress={enterManually} />
      </View>
    );
  }

  const busy = phase.kind === 'uploading';

  return (
    <View className="mt-7 gap-5">
      <View className="gap-2">
        <SectionLabel>Team</SectionLabel>
        <TeamPicker value={team} onChange={selectTeam} disabled={busy} />
        {teamError ? <ErrorText message={teamError} /> : null}
      </View>

      <View className="gap-2">
        <SectionLabel>Trainer code screenshot</SectionLabel>
        <Text className="font-display-med text-text-subtle" style={{ fontSize: 12, lineHeight: 17 }}>
          In Pokémon GO: Friends → Add Friend, then screenshot the "My Trainer Code" screen showing your
          trainer name and code.
        </Text>

        {picked ? (
          <View
            className="flex-row items-center gap-3 rounded-[14px] border border-border bg-bg-card px-3 py-3"
          >
            <View className="h-12 w-12 items-center justify-center overflow-hidden rounded-xl bg-bg-cardAlt">
              <Image source={{ uri: picked.uri }} style={{ width: 48, height: 48 }} contentFit="cover" accessibilityLabel="Trainer code screenshot" />
            </View>
            <View className="flex-1">
              <Text numberOfLines={1} className="font-display-semi text-text-primary" style={{ fontSize: 13 }}>
                {picked.filename}
              </Text>
              <Text className="font-mono text-text-subtle" style={{ fontSize: 11, marginTop: 2 }}>
                {picked.sizeBytes === null ? 'Ready to upload' : `${formatBytes(picked.sizeBytes)} · ready to upload`}
              </Text>
            </View>
            <Pressable
              onPress={choosePhoto}
              disabled={busy}
              accessibilityRole="button"
              accessibilityLabel="Choose a different screenshot"
              hitSlop={8}
              className="h-8 w-8 items-center justify-center rounded-[10px] border border-border active:opacity-70"
            >
              <X size={14} color="#8b93a7" strokeWidth={2.5} />
            </Pressable>
          </View>
        ) : (
          <Pressable
            onPress={choosePhoto}
            disabled={busy}
            accessibilityRole="button"
            accessibilityLabel="Choose trainer code screenshot"
            className={`flex-row items-center justify-center gap-2 rounded-[14px] border border-dashed border-border py-3.5 ${busy ? 'opacity-60' : 'active:opacity-70'}`}
          >
            <Camera size={16} color="#8b93a7" strokeWidth={2} />
            <Text className="font-display-med text-text-muted" style={{ fontSize: 13 }}>
              Choose screenshot
            </Text>
          </Pressable>
        )}
      </View>

      {pickError ? <ErrorText message={pickError} /> : null}

      <PrimaryButton
        label={busy ? 'Uploading…' : 'Upload & verify'}
        style={SURFACE.ctaBlue}
        textColor="#04121f"
        disabled={busy || !team || !picked}
        onPress={upload}
      />
      {busy ? <ActivityIndicator color="#4fb3ff" /> : null}

      <SecondaryLink label="Enter details manually instead" onPress={enterManually} disabled={busy} />
    </View>
  );
}

function SectionLabel({ children }: { children: string }) {
  return (
    <Text className="font-mono uppercase text-text-subtle" style={{ fontSize: 11, letterSpacing: 1.1 }}>
      {children}
    </Text>
  );
}

function SecondaryLink({ label, onPress, disabled }: { label: string; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable
      onPress={disabled ? undefined : onPress}
      disabled={disabled}
      accessibilityRole="button"
      hitSlop={8}
      className={`items-center py-1 ${disabled ? 'opacity-50' : 'active:opacity-70'}`}
    >
      <Text className="font-display-semi text-accent-blue" style={{ fontSize: 13 }}>
        {label}
      </Text>
    </Pressable>
  );
}

function ErrorText({ message }: { message: string }) {
  return (
    <Text accessibilityRole="alert" className="font-display-med text-accent-danger" style={{ fontSize: 13 }}>
      {message}
    </Text>
  );
}
