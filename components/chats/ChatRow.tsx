import { router } from 'expo-router';
import { Lock, Snowflake } from 'lucide-react-native';
import { Pressable, Text, View } from 'react-native';

import { Avatar } from '@/components/ui/Avatar';
import { PulseDot } from '@/components/ui/PulseDot';
import type { Chat } from '@/data/types';
import type { ChatPhase, Confirmation } from '@/store/trade-store';

interface ChatRowProps {
  chat: Chat;
  phase: ChatPhase;
  confirmation: Confirmation;
}

/** One line under the name that says where the trade stands, for every state but a plain open chat. */
function statusLine(chat: Chat, phase: ChatPhase, confirmation: Confirmation) {
  const live = chat.myRole !== undefined;
  if (phase === 'frozen') return { text: 'Chat Frozen: Trade Pending', color: '#4fb3ff', icon: 'snow' as const };
  if (!live) return null; // the mock only ever showed the preview (or the frozen line)
  if (phase === 'locked') {
    const text =
      confirmation === 'awaiting_partner'
        ? `Locked · waiting for ${chat.partner}`
        : confirmation === 'awaiting_me'
          ? `Locked · ${chat.partner} confirmed`
          : 'Trade locked';
    return { text, color: '#f5c518', icon: 'lock' as const };
  }
  if (phase === 'completed') return { text: 'Trade completed', color: '#7dffb3', icon: null };
  if (phase === 'bailed') return { text: 'Chat closed', color: '#7d87a0', icon: null };
  if (phase === 'closed') return { text: 'Listing closed', color: '#7d87a0', icon: null };
  return null;
}

export function ChatRow({ chat, phase, confirmation }: ChatRowProps) {
  const frozen = phase === 'frozen';
  // Everything but an open chat or the lock holder is dimmed: frozen siblings and finished chats.
  const dimmed = phase !== 'open' && phase !== 'locked';
  const serverStatus = chat.status ?? (chat.active ? 'open' : 'closed');
  const showActiveDot = serverStatus === 'open' && !dimmed;
  const line = statusLine(chat, phase, confirmation);
  const showUnread = !frozen && chat.unread > 0;

  return (
    <Pressable
      onPress={() => router.push(`/chats/${chat.id}`)}
      accessibilityRole="button"
      accessibilityLabel={`Chat with ${chat.partner}${
        frozen ? ', frozen — trade pending' : line ? `, ${line.text}` : chat.unread ? `, ${chat.unread} unread` : ''
      }`}
      className="flex-row items-center gap-3 rounded-2xl border p-3 active:opacity-90"
      style={{
        backgroundColor: dimmed ? '#0a0f1c' : '#0f1524',
        borderColor: phase === 'locked' && chat.myRole ? 'rgba(245,197,24,.3)' : !dimmed && chat.unread ? 'rgba(79,179,255,.35)' : '#1a2032',
        opacity: dimmed ? 0.55 : 1,
      }}
    >
      <Avatar name={chat.partner} />
      <View className="min-w-0 flex-1">
        <View className="flex-row items-center gap-1.5">
          <Text className="font-display-semi text-text-primary" style={{ fontSize: 14 }}>
            {chat.partner}
          </Text>
          {showActiveDot && <PulseDot />}
        </View>
        {line ? (
          <View className="mt-1 flex-row items-center gap-1">
            {line.icon === 'snow' ? <Snowflake size={11} color={line.color} /> : null}
            {line.icon === 'lock' ? <Lock size={11} color={line.color} /> : null}
            <Text numberOfLines={1} style={{ fontSize: 11, color: line.color }}>
              {line.text}
            </Text>
          </View>
        ) : (
          <Text
            numberOfLines={1}
            style={{ fontSize: 12, marginTop: 2, color: chat.unread ? '#e8ecf5' : '#7d87a0' }}
          >
            {chat.preview}
          </Text>
        )}
      </View>
      {showUnread && (
        <View
          className="items-center justify-center rounded-full bg-accent-blue px-1.5"
          style={{ minWidth: 20, height: 20, boxShadow: '0 0 10px rgba(79,179,255,.4)' }}
        >
          <Text className="font-display" style={{ fontSize: 11, color: '#04121f' }}>
            {chat.unread}
          </Text>
        </View>
      )}
    </Pressable>
  );
}
