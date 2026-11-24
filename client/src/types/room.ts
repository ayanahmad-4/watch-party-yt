
export type ParticipantRole = 'host' | 'moderator' | 'participant';

export type ControlAction = 'play' | 'pause' | 'seek' | 'changeVideo';

export const CONTROL_ACTIONS: ControlAction[] = [
  'play',
  'pause',
  'seek',
  'changeVideo',
];

export const CONTROL_ACTION_LABELS: Record<ControlAction, string> = {
  play: 'Play',
  pause: 'Pause',
  seek: 'Seek',
  changeVideo: 'Open another YouTube video',
};

export interface Participant {
  id: string;
  username: string;
  role: ParticipantRole;
}

export interface JoinRequest {
  requestId: string;
  username: string;
  createdAt?: number;
}

export interface ControlRequest {
  requestId: string;
  userId: string;
  username: string;
  role: ParticipantRole;
  permissions: ControlAction[];
  createdAt?: number;
}

export interface RoomState {
  roomId: string;
  hostId: string;
  videoId: string;
  currentTime: number;
  isPlaying: boolean;
  lastPlayTimestamp?: number | null;

  participants: Participant[];

  // Pending room join requests
  joinRequests: JoinRequest[];

  // Pending playback permission requests
  controlRequests: ControlRequest[];

  // Approved playback permissions per user
  controlGrants: Record<string, ControlAction[]>;
}
