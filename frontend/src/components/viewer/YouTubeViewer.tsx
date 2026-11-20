'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Play, Video, Clock, AlertTriangle, X } from 'lucide-react';
import { SourceRead } from '@/types/api';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { parseYouTubeVideoId, formatTimestamp } from '@/utils/coordinateMath';

declare global {
  interface Window {
    YT?: {
      Player: new (
        elementId: string | HTMLElement,
        options: {
          videoId?: string;
          events?: {
            onReady?: (event: { target: YTPlayerInstance }) => void;
            onStateChange?: (event: { data: number }) => void;
          };
        }
      ) => YTPlayerInstance;
    };
    onYouTubeIframeAPIReady?: () => void;
  }
}

export interface YTPlayerInstance {
  seekTo: (seconds: number, allowSeekAhead: boolean) => void;
  playVideo?: () => void;
  pauseVideo?: () => void;
  getCurrentTime?: () => number;
  destroy?: () => void;
}

export interface YouTubeViewerProps {
  source: SourceRead;
  initialSeconds?: number;
  onStateChange?: (state: { timestamp: number }) => void;
  className?: string;
}

export function YouTubeViewer({
  source,
  initialSeconds = 0,
  onStateChange,
  className = '',
}: YouTubeViewerProps) {
  const { activeFocusTarget } = useWorkspaceStore();
  const playerRef = useRef<YTPlayerInstance | null>(null);
  const [currentSeconds, setCurrentSeconds] = useState<number>(initialSeconds);
  const [isPlayerReady, setIsPlayerReady] = useState<boolean>(false);

  const videoId = parseYouTubeVideoId(source.storage_key_or_url) || 'kYv_8fX30yA';

  const isNonEducational =
    source.status === 'error' &&
    source.error_code === 'ERR_NON_EDUCATIONAL_CONTENT';

  // 1. YouTube IFrame API Initialization
  useEffect(() => {
    if (isNonEducational) return;
    let isMounted = true;

    function initPlayer() {
      if (window.YT && window.YT.Player) {
        try {
          const player = new window.YT.Player('youtube-player-container', {
            videoId,
            events: {
              onReady: (event) => {
                if (!isMounted) return;
                playerRef.current = event.target;
                setIsPlayerReady(true);
                if (initialSeconds > 0) {
                  event.target.seekTo(initialSeconds, true);
                }
              },
            },
          });
          playerRef.current = player;
        } catch {
          // Guard for mock/JSDOM environments
        }
      }
    }

    if (window.YT && window.YT.Player) {
      initPlayer();
    } else {
      const prevCallback = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => {
        prevCallback?.();
        if (isMounted) initPlayer();
      };

      if (!document.querySelector('script[src*="youtube.com/iframe_api"]')) {
        const script = document.createElement('script');
        script.src = 'https://www.youtube.com/iframe_api';
        script.async = true;
        document.body.appendChild(script);
      }
    }

    return () => {
      isMounted = false;
      playerRef.current?.destroy?.();
    };
  }, [videoId, initialSeconds, isNonEducational]);

  // 2. Perform Deep Seek
  const seekToTimestamp = useCallback(
    (seconds: number) => {
      setCurrentSeconds(seconds);
      if (playerRef.current && typeof playerRef.current.seekTo === 'function') {
        playerRef.current.seekTo(seconds, true);
        playerRef.current.playVideo?.();
      }
      onStateChange?.({ timestamp: seconds });
    },
    [onStateChange]
  );

  // 3. Reactive Seek Listener on activeFocusTarget updates
  useEffect(() => {
    if (isNonEducational) return;
    if (
      activeFocusTarget &&
      activeFocusTarget.sourceId === source.id &&
      activeFocusTarget.startSeconds !== undefined &&
      activeFocusTarget.startSeconds !== null
    ) {
      seekToTimestamp(activeFocusTarget.startSeconds);
    }
  }, [activeFocusTarget, source.id, seekToTimestamp, isNonEducational]);

  // 4. Privacy Shield against Non-Educational Content
  if (isNonEducational) {
    return (
      <div
        data-testid="youtube-suppressed-view"
        className="flex flex-col items-center justify-center h-full p-8 text-center bg-card text-muted-foreground"
      >
        <div
          data-testid="youtube-shield-card"
          className="p-6 bg-amber-500/10 border border-amber-500/60 rounded-2xl max-w-md shadow-xl flex flex-col items-center gap-4"
        >
          <div className="w-12 h-12 rounded-full bg-amber-500/20 flex items-center justify-center text-amber-500">
            <AlertTriangle className="w-7 h-7 text-amber-500" />
          </div>

          <div
            role="alert"
            data-testid="educational-warning-banner"
            className="text-xs font-semibold text-amber-500 leading-relaxed text-center px-3 py-2 rounded-lg bg-amber-500/15 border border-amber-500/30 w-full"
          >
            ⚠️ Upload educational related video, this video does not have educational content please recheck the link
          </div>

          <div className="w-full text-center">
            <span className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold block mb-1">
              Source Title
            </span>
            <span
              data-testid="shield-suppressed-title"
              className="text-xs font-mono text-muted-foreground bg-muted/60 px-3 py-1 rounded inline-block"
            >
              [Suppressed: Non-Educational Content]
            </span>
          </div>

          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>Player and transcript locked by educational relevance barrier.</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      data-testid="youtube-viewer"
      role="region"
      aria-label={`YouTube Player: ${source.title}`}
      className={`flex flex-col h-full w-full bg-black overflow-hidden ${className}`}
    >
      {/* Player Header */}
      <div className="flex items-center justify-between px-4 py-2 bg-zinc-900 border-b border-zinc-800 shrink-0 text-zinc-100">
        <div className="flex items-center gap-2 min-w-0">
          <Video className="w-4 h-4 text-red-500 shrink-0" />
          <span className="text-xs font-medium truncate max-w-[240px]">
            {source.title}
          </span>
        </div>

        <div className="flex items-center gap-2">
          {/* Timestamp Indicator Badge */}
          <div
            data-testid="youtube-timestamp-badge"
            className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-amber-500/20 border border-amber-500/40 text-amber-400 font-mono text-xs font-semibold"
          >
            <Clock className="w-3.5 h-3.5" />
            <span>{formatTimestamp(currentSeconds)}</span>
          </div>

          {/* Close Player Button */}
          <button
            type="button"
            data-testid="close-youtube-player-btn"
            aria-label="Close YouTube Player"
            onClick={() => {
              useWorkspaceStore.getState().setActiveSourceId(null);
              useWorkspaceStore.getState().clearFocusTarget();
            }}
            className="p-1 rounded hover:bg-zinc-800 text-zinc-400 hover:text-zinc-100 transition-colors cursor-pointer"
            title="Close YouTube Player"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Video Viewport Container */}
      <div className="flex-1 relative flex items-center justify-center bg-black overflow-hidden">
        <div id="youtube-player-container" className="w-full h-full max-w-full max-h-full">
          <iframe
            id="youtube-player"
            data-testid="youtube-iframe"
            title={source.title}
            src={`https://www.youtube.com/embed/${videoId}?enablejsapi=1`}
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
            className="w-full h-full border-0 block"
          />
        </div>
      </div>

      {/* Quick Jump Controls */}
      <div className="p-3 bg-zinc-950 border-t border-zinc-900 flex items-center gap-2 shrink-0 overflow-x-auto text-xs text-zinc-400">
        <span className="text-[11px] font-medium text-zinc-500">Quick Jump:</span>
        <button
          type="button"
          onClick={() => seekToTimestamp(0)}
          className="px-2 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200 font-mono text-[11px]"
        >
          00:00
        </button>
        {source.duration_seconds && (
          <span className="text-[11px] text-zinc-600 ml-auto font-mono">
            Duration: {formatTimestamp(source.duration_seconds)}
          </span>
        )}
      </div>
    </div>
  );
}
