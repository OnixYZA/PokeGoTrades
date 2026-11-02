import { useCallback, useRef, useState } from 'react';

import type { AreaName } from '@/constants/locations';
import { toast } from '@/lib/toast';
import { getGeolocation, requestVicinity, VICINITY_FAILURE_MESSAGES } from '@/lib/vicinity';

/** Shared by the feed filter and the create-listing form. `locate` resolves to the area, or null after
 *  showing a toast explaining why not. `supported` is false on native, where callers hide the shortcut. */
export function useVicinity() {
  const [locating, setLocating] = useState(false);
  const busy = useRef(false);
  const supported = getGeolocation() !== null;

  const locate = useCallback(async (): Promise<AreaName | null> => {
    if (busy.current) return null;
    busy.current = true;
    setLocating(true);
    try {
      const result = await requestVicinity();
      if (result.ok) return result.area;
      toast(VICINITY_FAILURE_MESSAGES[result.reason]);
      return null;
    } finally {
      busy.current = false;
      setLocating(false);
    }
  }, []);

  return { supported, locating, locate };
}
