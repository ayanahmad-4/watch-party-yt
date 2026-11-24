import type { ControlAction } from '../types/room';

type RoomControlsProps = {
  allowedActions: ControlAction[];
  roleLabel: string;
  seekSeconds: string;
  videoIdInput: string;
  onSeekSecondsChange: (value: string) => void;
  onVideoIdChange: (value: string) => void;
  onPlay: () => void;
  onPause: () => void;
  onSeek: () => void;
  onChangeVideo: () => void;
  onSync: () => void;
};

export function RoomControls({
  allowedActions,
  roleLabel,
  seekSeconds,
  videoIdInput,
  onSeekSecondsChange,
  onVideoIdChange,
  onPlay,
  onPause,
  onSeek,
  onChangeVideo,
  onSync,
}: RoomControlsProps) {
  const canPlay = allowedActions.includes('play');
  const canPause = allowedActions.includes('pause');
  const canSeek = allowedActions.includes('seek');
  const canChangeVideo = allowedActions.includes('changeVideo');

  return (
    <div className="room-controls-panel">
      <h3>Controls ({roleLabel})</h3>

      <div className="room-controls-row">
        <button type="button" disabled={!canPlay} onClick={onPlay}>
          Play
        </button>

        <button type="button" disabled={!canPause} onClick={onPause}>
          Pause
        </button>

        <label className="room-control-label">
          Seek (s)
          <input
            type="number"
            min={0}
            step={1}
            value={seekSeconds}
            disabled={!canSeek}
            onChange={(event) => onSeekSecondsChange(event.target.value)}
          />
        </label>

        <button type="button" disabled={!canSeek} onClick={onSeek}>
          Seek
        </button>

        <label className="room-control-label">
          YouTube URL
          <input
            className="room-video-input"
            type="text"
            value={videoIdInput}
            disabled={!canChangeVideo}
            onChange={(event) => onVideoIdChange(event.target.value)}
            placeholder="Paste YouTube video link here"
          />
        </label>

        <button
          type="button"
          disabled={!canChangeVideo}
          onClick={onChangeVideo}
        >
          Open Video
        </button>

        <button type="button" onClick={onSync}>
          Sync
        </button>
      </div>
    </div>
  );
}
