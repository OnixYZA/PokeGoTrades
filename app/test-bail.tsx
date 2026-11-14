import { Pressable, View } from 'react-native';

import { BailBlockModal } from '@/components/modals/BailBlockModal';
import { goBack } from '@/lib/navigation';

export default function BailBlockTestScreen() {
  return (
    <View className="flex-1">
      <Pressable className="flex-1" onPress={() => goBack('/')} />
      <View style={{ position: 'absolute', bottom: 0, left: 0, right: 0, top: 0, pointerEvents: 'box-none' }}>
        <BailBlockModal />
      </View>
    </View>
  );
}
