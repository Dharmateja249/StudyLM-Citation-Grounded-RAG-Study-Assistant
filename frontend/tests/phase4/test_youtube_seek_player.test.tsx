import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import { YouTubeViewer } from '@/components/viewer/YouTubeViewer';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { parseYouTubeVideoId, formatTimestamp } from '@/utils/coordinateMath';
import { mockSources } from '../mocks/fixtures';

describe('Phase 4: YouTube Deep-Seek & Auto-Player Integration', () => {
  beforeEach(() => {
    useWorkspaceStore.getState().reset();
  });

  it('test_youtube_player_initialization_with_url', () => {
    // 1. URL Parsing Verification across formats
    expect(parseYouTubeVideoId('https://www.youtube.com/watch?v=kYv_8fX30yA')).toBe('kYv_8fX30yA');
    expect(parseYouTubeVideoId('https://youtu.be/kYv_8fX30yA')).toBe('kYv_8fX30yA');
    expect(parseYouTubeVideoId('https://www.youtube.com/embed/kYv_8fX30yA')).toBe('kYv_8fX30yA');
    expect(parseYouTubeVideoId('kYv_8fX30yA')).toBe('kYv_8fX30yA');

    // 2. Component Render embeds correct iframe
    const ytSource = mockSources[1]; // MIT 8.01x Lecture 3
    render(<YouTubeViewer source={ytSource} />);

    const iframe = screen.getByTestId('youtube-iframe');
    expect(iframe).toBeInTheDocument();
    expect(iframe).toHaveAttribute('src', expect.stringContaining('kYv_8fX30yA'));
  });

  it('test_citation_click_triggers_player_seek', async () => {
    const mockSeekTo = vi.fn();
    const mockPlayVideo = vi.fn();

    // Mock window.YT API
    window.YT = {
      Player: vi.fn().mockImplementation((elementId, options) => {
        const playerInstance = {
          seekTo: mockSeekTo,
          playVideo: mockPlayVideo,
          destroy: vi.fn(),
        };
        options.events?.onReady?.({ target: playerInstance });
        return playerInstance;
      }),
    };

    const ytSource = mockSources[1];
    render(<YouTubeViewer source={ytSource} />);

    // Trigger Citation event with start_seconds = 1394
    act(() => {
      useWorkspaceStore.getState().dispatchFocusTarget({
        sourceId: ytSource.id,
        startSeconds: 1394,
      });
    });

    await waitFor(() => {
      expect(mockSeekTo).toHaveBeenCalledWith(1394, true);
    });
  });

  it('test_timestamp_badge_formatting', () => {
    // Format tests
    expect(formatTimestamp(1394)).toBe('23:14');
    expect(formatTimestamp(45)).toBe('00:45');
    expect(formatTimestamp(3665)).toBe('01:01:05');

    const ytSource = mockSources[1];
    render(<YouTubeViewer source={ytSource} initialSeconds={1394} />);

    const badge = screen.getByTestId('youtube-timestamp-badge');
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveTextContent('23:14');
  });

  it('test_non_educational_video_suppression', () => {
    const rejectedSource = mockSources[2]; // ERR_NON_EDUCATIONAL_CONTENT
    render(<YouTubeViewer source={rejectedSource} />);

    expect(screen.queryByTestId('youtube-iframe')).not.toBeInTheDocument();
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent(
      'Upload educational related video, this video does not have educational content please recheck the link'
    );
  });
});
