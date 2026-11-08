import { useEffect } from 'react';
import { listenForTyping } from '../services/chatTyping';
import { applyTypingEvent, clearAllTyping } from '../utils/chatTyping';
import { useRealtimeEpoch } from '../utils/realtimeEpoch';

/**
 * Keeps the signed-in person's typing channel open for the chat list and every chat.
 * Renders nothing. Lives above the navigator, not in the chat list, because a chat can open
 * from a push before the Messages tab has ever mounted.
 */
export default function ChatTypingListener({ userId }: { userId: string }) {
  const realtimeEpoch = useRealtimeEpoch();

  useEffect(() => {
    const stop = listenForTyping(userId, applyTypingEvent);
    return () => {
      stop();
      clearAllTyping();
    };
  }, [userId, realtimeEpoch]);

  return null;
}
