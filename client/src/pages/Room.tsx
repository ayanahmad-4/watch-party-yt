import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { useSocket } from '../context/SocketContext';
import type {
  ControlAction,
  ControlRequest,
  RoomState,
} from '../types/room';
import {
  CONTROL_ACTIONS,
  CONTROL_ACTION_LABELS,
} from '../types/room';
import { ParticipantsList } from '../components/ParticipantsList';
import { RoomControls } from '../components/RoomControls';
import { YouTubePlayer } from '../components/YouTubePlayer';
import { ChatBox } from '../components/ChatBox';

type LocationState = { username?: string; roomPassword?: string; alreadyJoined?: boolean };
type ChatMessage = {
  username: string;
  message: string;
  time: number;
};
type Reaction = {
  id: number;
  emoji: string;
};

type SocketAck = {
  ok: boolean;
  message?: string;
};

function extractYouTubeVideoId(input: string): string | null {
  const value = input.trim();

  if (/^[a-zA-Z0-9_-]{11}$/.test(value)) {
    return value;
  }

  try {
    const url = new URL(value);
    const host = url.hostname.replace(/^www\./, '').toLowerCase();

    let id = '';

    if (host === 'youtu.be') {
      id = url.pathname.split('/')[1] || '';
    } else if (
      [
        'youtube.com',
        'm.youtube.com',
        'music.youtube.com',
        'youtube-nocookie.com',
      ].includes(host)
    ) {
      if (url.pathname === '/watch') {
        id = url.searchParams.get('v') || '';
      } else {
        const match = url.pathname.match(
          /^\/(shorts|embed|live)\/([a-zA-Z0-9_-]{11})(?:\/|$)/
        );
        id = match?.[2] || '';
      }
    }

    return /^[a-zA-Z0-9_-]{11}$/.test(id) ? id : null;
  } catch {
    return null;
  }
}

export function Room() {
  const { roomId: roomIdParam } = useParams();
  const roomId = roomIdParam ?? '';
  const location = useLocation();
  const navigate = useNavigate();
  const socket = useSocket();

  const locationState = location.state as LocationState | null;
  const username = locationState?.username?.trim() ?? '';
  const roomPassword = locationState?.roomPassword ?? '';

  const [room, setRoom] = useState<RoomState | null>(null);
  const [seekInput, setSeekInput] = useState('0');
  const [videoInput, setVideoInput] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [reactions, setReactions] = useState<Reaction[]>([]);
  const [accessNotice, setAccessNotice] = useState('');
  const [requestFormOpen, setRequestFormOpen] = useState(false);
  const [requestSelection, setRequestSelection] = useState<ControlAction[]>([]);
  const [shareNotice, setShareNotice] = useState('');

  useEffect(() => {
    if (!username) {
      navigate('/', { replace: true });
    }
  }, [username, navigate]);

  // Realtime room events.
  useEffect(() => {
    const onRoomUpdate = (updatedRoom: RoomState | null) => {
      if (updatedRoom) {
        setSeekInput(String(Math.floor(updatedRoom.currentTime)));
        setVideoInput(updatedRoom.videoId);
      }
      setRoom(updatedRoom);
    };

    const onJoinRequest = () => {
      // The authoritative room-update event carries the full pending request list.
      socket.emit('get-room', { roomId });
    };

    const onControlRequest = (request: ControlRequest) => {
      setRoom((previousRoom) => {
        if (!previousRoom || previousRoom.hostId !== socket.id) {
          return previousRoom;
        }

        const currentRequests = previousRoom.controlRequests ?? [];
        if (currentRequests.some((item) => item.requestId === request.requestId)) {
          return previousRoom;
        }

        return {
          ...previousRoom,
          controlRequests: [...currentRequests, request],
        };
      });
    };

    const onVideoPlay = (payload: {
      isPlaying: boolean;
      currentTime: number;
    }) => {
      setRoom((previousRoom) =>
        previousRoom
          ? {
              ...previousRoom,
              isPlaying: payload.isPlaying,
              currentTime: payload.currentTime,
            }
          : previousRoom
      );
    };

    const onVideoPause = (payload: {
      isPlaying: boolean;
      currentTime: number;
    }) => {
      setRoom((previousRoom) =>
        previousRoom
          ? {
              ...previousRoom,
              isPlaying: payload.isPlaying,
              currentTime: payload.currentTime,
            }
          : previousRoom
      );
    };

    const onVideoSeek = (payload: { time: number }) => {
      setSeekInput(String(Math.floor(payload.time)));
      setRoom((previousRoom) =>
        previousRoom
          ? { ...previousRoom, currentTime: payload.time }
          : previousRoom
      );
    };

    const onVideoChange = (payload: { videoId: string }) => {
      setVideoInput(payload.videoId);
      setRoom((previousRoom) =>
        previousRoom
          ? { ...previousRoom, videoId: payload.videoId }
          : previousRoom
      );
    };

    const onRoleAssigned = (payload: {
      participants: RoomState['participants'];
    }) => {
      setRoom((previousRoom) =>
        previousRoom
          ? { ...previousRoom, participants: payload.participants }
          : previousRoom
      );
    };

    const onParticipantRemoved = (payload: {
      participants: RoomState['participants'];
    }) => {
      setRoom((previousRoom) =>
        previousRoom
          ? { ...previousRoom, participants: payload.participants }
          : previousRoom
      );
    };

    const onHostTransferred = (payload: {
      hostId: string;
      participants: RoomState['participants'];
    }) => {
      setRoom((previousRoom) =>
        previousRoom
          ? {
              ...previousRoom,
              hostId: payload.hostId,
              participants: payload.participants,
            }
          : previousRoom
      );
    };

    const onNewMessage = (message: ChatMessage) => {
      setMessages((previous) => [...previous, message]);
    };

    const onNewReaction = ({ emoji }: { emoji: string }) => {
      const reaction = { id: Date.now() + Math.random(), emoji };
      setReactions((previous) => [...previous, reaction]);

      window.setTimeout(() => {
        setReactions((previous) =>
          previous.filter((item) => item.id !== reaction.id)
        );
      }, 1500);
    };

    const onControlAccessResult = (payload: {
      approved: boolean;
      revoked: boolean;
      permissions?: ControlAction[];
    }) => {
      if (payload.revoked) {
        setAccessNotice(
          payload.permissions?.length
            ? `Some access was revoked. Remaining access: ${payload.permissions
                .map((action) => CONTROL_ACTION_LABELS[action])
                .join(', ')}.`
            : 'The host has revoked your control access.'
        );
      } else if (payload.approved) {
        setAccessNotice(
          `The host approved: ${(payload.permissions ?? [])
            .map((action) => CONTROL_ACTION_LABELS[action])
            .join(', ')}.`
        );
      } else {
        setAccessNotice('The host rejected your control request.');
      }
    };

    const onKicked = () => {
      window.alert('You were removed by host');
      navigate('/');
    };

    socket.on('room-update', onRoomUpdate);
    socket.on('join-request', onJoinRequest);
    socket.on('control-request', onControlRequest);
    socket.on('role-assigned', onRoleAssigned);
    socket.on('participant-removed', onParticipantRemoved);
    socket.on('host-transferred', onHostTransferred);
    socket.on('new-message', onNewMessage);
    socket.on('new-reaction', onNewReaction);
    socket.on('kicked', onKicked);
    socket.on('video-play', onVideoPlay);
    socket.on('video-pause', onVideoPause);
    socket.on('video-seek', onVideoSeek);
    socket.on('video-change', onVideoChange);
    socket.on('control-access-result', onControlAccessResult);

    const requestRoomState = () => socket.emit('get-room', { roomId });
    if (socket.connected) requestRoomState();
    else socket.once('connect', requestRoomState);

    return () => {
      socket.off('connect', requestRoomState);
      socket.off('room-update', onRoomUpdate);
      socket.off('join-request', onJoinRequest);
      socket.off('control-request', onControlRequest);
      socket.off('role-assigned', onRoleAssigned);
      socket.off('participant-removed', onParticipantRemoved);
      socket.off('host-transferred', onHostTransferred);
      socket.off('new-message', onNewMessage);
      socket.off('new-reaction', onNewReaction);
      socket.off('kicked', onKicked);
      socket.off('video-play', onVideoPlay);
      socket.off('video-pause', onVideoPause);
      socket.off('video-seek', onVideoSeek);
      socket.off('video-change', onVideoChange);
      socket.off('control-access-result', onControlAccessResult);
    };
  }, [socket, navigate, roomId]);

  const currentSocketId = socket.id;
  const me = room?.participants.find(
    (participant) => participant.id === currentSocketId
  );

  const role = me?.role ?? 'participant';
  const isHost = !!currentSocketId && room?.hostId === currentSocketId;

  const grantedActions: ControlAction[] = isHost
    ? CONTROL_ACTIONS
    : currentSocketId
      ? room?.controlGrants?.[currentSocketId] ?? []
      : [];

  const isControlPending = !!currentSocketId &&
    (room?.controlRequests ?? []).some(
      (request) => request.userId === currentSocketId
    );

  const availableRequestActions = CONTROL_ACTIONS.filter(
    (action) => !grantedActions.includes(action)
  );

  const canRequestAccess =
    !!room && !isHost && (role === 'participant' || role === 'moderator');

  const toggleRequestAction = (action: ControlAction) => {
    setRequestSelection((previous) =>
      previous.includes(action)
        ? previous.filter((item) => item !== action)
        : [...previous, action]
    );
  };

  const submitControlRequest = () => {
    if (requestSelection.length === 0) {
      setAccessNotice('Select at least one permission to request.');
      return;
    }

    setAccessNotice('');

    socket.emit(
      'request-control',
      { permissions: requestSelection },
      (response: SocketAck) => {
        if (response?.ok) {
          setRequestFormOpen(false);
          setRequestSelection([]);
          setAccessNotice('Your request has been sent to the host.');
        } else {
          setAccessNotice(response?.message || 'Could not send the request. Please try again.');
        }
      }
    );
  };

  const shareRoomCredentials = async () => {
    if (!roomPassword) {
      setShareNotice('Room password is unavailable. Return to the home page and create or join the room again.');
      return;
    }

    const credentials = `YouTube Watch Party\nRoom ID: ${roomId}\nPassword: ${roomPassword}`;

    try {
      await navigator.clipboard.writeText(credentials);
      setShareNotice('Room ID and password copied to clipboard.');
    } catch {
      const textArea = document.createElement('textarea');
      textArea.value = credentials;
      textArea.style.position = 'fixed';
      textArea.style.opacity = '0';
      document.body.appendChild(textArea);
      textArea.select();
      const copied = document.execCommand('copy');
      textArea.remove();
      setShareNotice(copied ? 'Room ID and password copied to clipboard.' : 'Could not copy credentials. Please copy them manually.');
    }
  };

  if (!username) return null;

  return (
    <div className="page-wrap">
      <div className="card room-card">
        <p>
          <Link to="/">← Home</Link>
        </p>

        <div className="room-heading-row">
          <h1>Room: {roomId}</h1>
          <div className="room-share-area">
            <button type="button" onClick={shareRoomCredentials}>
              Share Room
            </button>
            {shareNotice && <span className="share-notice" role="status">{shareNotice}</span>}
          </div>
        </div>

        <div className="room-layout">
          {/* LEFT PANEL */}
          {room && (
            <div className="side-panel">
              <ParticipantsList
                participants={room.participants}
                isHost={isHost}
                currentUserId={currentSocketId ?? ''}
              />

              {/* HOST: PENDING ROOM JOIN REQUESTS */}
              {isHost && (room.joinRequests?.length ?? 0) > 0 && (
                <div className="control-access-panel">
                  <h3>Requests to Join</h3>
                  {(room.joinRequests ?? []).map((request) => (
                    <div className="control-request" key={request.requestId}>
                      <strong>{request.username}</strong>
                      <div className="control-request-buttons">
                        <button
                          type="button"
                          onClick={() => socket.emit('respond-join-request', {
                            requestId: request.requestId,
                            approved: true,
                          })}
                        >
                          Approve
                        </button>
                        <button
                          type="button"
                          onClick={() => socket.emit('respond-join-request', {
                            requestId: request.requestId,
                            approved: false,
                          })}
                        >
                          Reject
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* HOST: PENDING ACCESS REQUESTS */}
              {isHost && (room.controlRequests?.length ?? 0) > 0 && (
                <div className="control-access-panel">
                  <h3>Control Access Requests</h3>

                  {(room.controlRequests ?? []).map((request) => (
                    <div className="control-request" key={request.requestId}>
                      <div>
                        <strong>{request.username}</strong>
                        <span className="control-request-role">
                          ({request.role})
                        </span>
                        <p>Requested permissions:</p>
                        <ul className="requested-permissions">
                          {request.permissions.map((action) => (
                            <li key={action}>
                              {CONTROL_ACTION_LABELS[action]}
                            </li>
                          ))}
                        </ul>
                      </div>

                      <div className="control-request-buttons">
                        <button
                          type="button"
                          onClick={() => {
                            socket.emit('respond-control-request', {
                              requestId: request.requestId,
                              approved: true,
                            });
                          }}
                        >
                          Approve
                        </button>

                        <button
                          type="button"
                          onClick={() => {
                            socket.emit('respond-control-request', {
                              requestId: request.requestId,
                              approved: false,
                            });
                          }}
                        >
                          Reject
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* HOST: GRANTED PERMISSIONS */}
              {isHost &&
                Object.entries(room.controlGrants ?? {}).some(
                  ([, actions]) => actions.length > 0
                ) && (
                  <div className="control-access-panel">
                    <h3>Granted Control Permissions</h3>

                    {Object.entries(room.controlGrants ?? {}).map(
                      ([userId, actions]) => {
                        const participant = room.participants.find(
                          (item) => item.id === userId
                        );

                        if (!participant || actions.length === 0) return null;

                        return (
                          <div className="control-grant" key={userId}>
                            <strong>{participant.username}</strong>

                            {actions.map((action) => (
                              <div className="control-grant-row" key={action}>
                                <span>{CONTROL_ACTION_LABELS[action]}</span>
                                <button
                                  type="button"
                                  onClick={() => {
                                    socket.emit('revoke-control-access', {
                                      userId,
                                      action,
                                    });
                                  }}
                                >
                                  Revoke
                                </button>
                              </div>
                            ))}

                            <button
                              type="button"
                              onClick={() => {
                                socket.emit('revoke-control-access', { userId });
                              }}
                            >
                              Revoke all
                            </button>
                          </div>
                        );
                      }
                    )}
                  </div>
                )}

              {/* CHAT */}
              <ChatBox
                messages={messages}
                onSend={(message) => {
                  socket.emit('send-message', { message });
                }}
              />
            </div>
          )}

          {/* RIGHT PANEL */}
          <div className="video-panel">
            {room && room.videoId?.trim() && (
              <YouTubePlayer
                key={isHost ? 'host-player' : 'non-host-player'}
                videoId={room.videoId}
                currentTime={room.currentTime}
                isPlaying={room.isPlaying}
                isHost={isHost}
                allowedActions={grantedActions}
              />
            )}

            <div className="reactions-layer">
              {reactions.map((reaction) => (
                <span key={reaction.id} className="reaction-float">
                  {reaction.emoji}
                </span>
              ))}
            </div>

            {!room && <p>Loading room…</p>}

            {/* PARTICIPANT OR MODERATOR: REQUEST SPECIFIC PERMISSIONS */}
            {canRequestAccess && availableRequestActions.length > 0 && (
              <div className="control-request-action">
                {isControlPending ? (
                  <p className="control-access-notice">
                    Your control access request is waiting for host approval.
                  </p>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={() => {
                        setAccessNotice('');
                        setRequestFormOpen((open) => !open);
                        setRequestSelection([]);
                      }}
                    >
                      {requestFormOpen
                        ? 'Cancel Request'
                        : grantedActions.length > 0
                          ? 'Request More Permissions'
                          : 'Request Control Access'}
                    </button>

                    {requestFormOpen && (
                      <div className="control-request-form">
                        <h3>Select permissions to request</h3>

                        {availableRequestActions.map((action) => (
                          <label
                            className="permission-option"
                            key={action}
                          >
                            <input
                              type="checkbox"
                              checked={requestSelection.includes(action)}
                              onChange={() => toggleRequestAction(action)}
                            />
                            <span>{CONTROL_ACTION_LABELS[action]}</span>
                          </label>
                        ))}

                        <button
                          type="button"
                          onClick={submitControlRequest}
                        >
                          Send Request
                        </button>
                      </div>
                    )}
                  </>
                )}
              </div>
            )}

            {canRequestAccess && availableRequestActions.length === 0 && (
              <p className="control-access-notice">
                You have been granted all available playback permissions.
              </p>
            )}

            {accessNotice && (
              <p className="control-access-notice" role="status">
                {accessNotice}
              </p>
            )}

            {/* PLAYBACK CONTROLS: EACH ACTION HAS ITS OWN PERMISSION */}
            {room && (
              <RoomControls
                allowedActions={grantedActions}
                roleLabel={role}
                seekSeconds={seekInput}
                videoIdInput={videoInput}
                onSeekSecondsChange={setSeekInput}
                onVideoIdChange={setVideoInput}
                onPlay={() => socket.emit('play')}
                onPause={() => socket.emit('pause')}
                onSeek={() => {
                  const time = Number(seekInput);

                  if (!Number.isFinite(time) || time < 0) {
                    window.alert('Invalid seek time');
                    return;
                  }

                  socket.emit('seek', { time });
                }}
                onChangeVideo={() => {
                  const videoId = extractYouTubeVideoId(videoInput);

                  if (!videoId) {
                    window.alert(
                      'Please enter a valid YouTube video URL or video ID'
                    );
                    return;
                  }

                  socket.emit('change-video', { videoId });
                }}
                onSync={() => socket.emit('sync-request')}
              />
            )}

            <div className="reactions-buttons">
              {['👍', '😂', '🔥', '❤️'].map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  onClick={() => socket.emit('send-reaction', { emoji })}
                >
                  {emoji}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
