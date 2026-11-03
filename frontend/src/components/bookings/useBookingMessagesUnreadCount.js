import { useEffect, useState } from 'react';
import client from '../../api/client';

export default function useBookingMessagesUnreadCount(enabled = true) {
  const [count, setCount] = useState(0);
  useEffect(() => {
    if (!enabled) return undefined;
    let active = true;
    const refresh = async () => {
      try {
        const response = await client.get('/api/bookings/conversations/inbox/');
        if (active) setCount(Number(response.data?.unread_count || 0));
      } catch {
        if (active) setCount(0);
      }
    };
    void refresh();
    const timer = window.setInterval(refresh, 30000);
    return () => { active = false; window.clearInterval(timer); };
  }, [enabled]);
  return count;
}
