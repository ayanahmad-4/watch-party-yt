import { useEffect, useRef } from 'react';
import type { YTPlayer } from '../youtube';
import type { ControlAction } from '../types/room';
import { useSocket } from '../context/SocketContext';

type YouTubePlayerProps = {
  videoId: string;
  currentTime: number;
  isPlaying: boolean;
  isHost: boolean;
  allowedActions: ControlAction[];
};

let apiPromise: Promise<void> | null = null;

function loadYouTubeApi(): Promise<void> {
  if (window.YT?.Player) return Promise.resolve();
  if (apiPromise) return apiPromise;

  apiPromise = new Promise((resolve) => {
    const previousCallback = window.onYouTubeIframeAPIReady;

    window.onYouTubeIframeAPIReady = () => {
      previousCallback?.();
      resolve();
    };

    const existingScript = document.querySelector<HTMLScriptElement>(
      'script[src="https://www.youtube.com/iframe_api"]'
    );

    if (!existingScript) {
      const script = document.createElement('script');
      script.src = 'https://www.youtube.com/iframe_api';
      document.head.appendChild(script);
    }
  });

  return apiPromise;
}

export function YouTubePlayer({
  videoId,
  currentTime,
  isPlaying,
  isHost,
  allowedActions,
}: YouTubePlayerProps) {
  const socket = useSocket();
  const containerRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<YTPlayer | null>(null);
  const readyRef = useRef(false);
  const remoteTimerRef = useRef<number | null>(null);
  const isRemoteUpdate = useRef(false);
  const lastVideoIdRef = useRef('');
  const lastObservedTimeRef = useRef(0);

  const effectiveVideoId = videoId.trim();
  const canPlay = allowedActions.includes('play');
  const canPause = allowedActions.includes('pause');
  const canSeek = allowedActions.includes('seek');

  useEffect(() => {
    let cancelled = false;

    loadYouTubeApi().then(() => {
      if (cancelled || !containerRef.current || playerRef.current) return;

      playerRef.current = new window.YT.Player(containerRef.current, {
        height: '400',
        width: '700',
        videoId: effectiveVideoId,
        playerVars: {
          rel: 0,
          enablejsapi: 1,
          controls: isHost ? 1 : 0,
          disablekb: isHost ? 0 : 1,
        },
        events: {
          onReady: () => {
            readyRef.current = true;
            lastVideoIdRef.current = effectiveVideoId;
            lastObservedTimeRef.current = currentTime;
          },
          onStateChange: (event) => {
            if (isRemoteUpdate.current) return;

            if (
              event.data === window.YT.PlayerState.PLAYING &&
              canPlay
            ) {
              socket.emit('play');
            }

            if (
              event.data === window.YT.PlayerState.PAUSED &&
              canPause
            ) {
              socket.emit('pause');
            }
          },
        },
      });
    });

    return () => {
      cancelled = true;

      if (remoteTimerRef.current !== null) {
        window.clearTimeout(remoteTimerRef.current);
      }

      playerRef.current?.destroy();
      playerRef.current = null;
      readyRef.current = false;
    };
    // Player is created once for this mounted video component.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Apply authoritative server updates to the YouTube player.
  useEffect(() => {
    const player = playerRef.current;
    if (!player || !readyRef.current) return;

    if (remoteTimerRef.current !== null) {
      window.clearTimeout(remoteTimerRef.current);
    }

    isRemoteUpdate.current = true;

    if (effectiveVideoId !== lastVideoIdRef.current) {
      player.loadVideoById(effectiveVideoId, currentTime);
      lastVideoIdRef.current = effectiveVideoId;
    } else {
      player.seekTo(currentTime, true);
    }

    lastObservedTimeRef.current = currentTime;

    if (isPlaying) player.playVideo();
    else player.pauseVideo();

    remoteTimerRef.current = window.setTimeout(() => {
      isRemoteUpdate.current = false;
    }, 500);
  }, [effectiveVideoId, currentTime, isPlaying]);

  // Only users with explicit seek permission can publish manual player seeks.
  useEffect(() => {
    const intervalId = window.setInterval(() => {
      const player = playerRef.current;

      if (!player || !readyRef.current || isRemoteUpdate.current) return;

      const time = player.getCurrentTime();
      const previousTime = lastObservedTimeRef.current;

      if (canSeek && Math.abs(time - previousTime) > 1.5) {
        socket.emit('seek', { time });
      }

      lastObservedTimeRef.current = time;
    }, 1000);

    return () => window.clearInterval(intervalId);
  }, [canSeek, socket]);

  return <div ref={containerRef} />;
}
