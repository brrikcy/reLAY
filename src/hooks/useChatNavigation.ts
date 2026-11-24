import { useLayoutEffect, useRef, useState } from 'react';

/** Instantly snap a scroll container to its bottom without any CSS animation. */
function snapToBottom(el: HTMLDivElement) {
  el.scrollTop = el.scrollHeight;
}

export function useChatNavigation(key: string, count: number) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const followingLatest = useRef(true);
  const previousKey = useRef<string | undefined>(undefined);
  const previousCount = useRef(0);
  const [showBottom, setShowBottom] = useState(false);
  const [unread, setUnread] = useState(0);

  useLayoutEffect(() => {
    const changed = previousKey.current !== key;
    const added = Math.max(0, count - previousCount.current);
    previousKey.current = key;
    // Reset to 0 on key change so the next load always scrolls,
    // even when the new bot has fewer messages than the old one.
    previousCount.current = changed ? 0 : count;

    if (changed) {
      followingLatest.current = true;
      setUnread(0);
      setShowBottom(false);
      if (scrollRef.current) snapToBottom(scrollRef.current);
      return;
    }

    if (added && followingLatest.current) {
      if (scrollRef.current) snapToBottom(scrollRef.current);
      return;
    }

    if (added) {
      setUnread((current) => current + added);
    }
  }, [key, count]);

  const onScroll = (element: HTMLDivElement) => {
    const nearBottom = element.scrollHeight - element.scrollTop - element.clientHeight < 100;
    followingLatest.current = nearBottom;
    setShowBottom(!nearBottom);
    if (nearBottom) setUnread(0);
  };

  const jumpToLatest = () => {
    followingLatest.current = true;
    // User-triggered: intentional smooth animation.
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
    setShowBottom(false);
    setUnread(0);
  };

  return { scrollRef, followingLatest, showBottom, unread, onScroll, jumpToLatest };
}
