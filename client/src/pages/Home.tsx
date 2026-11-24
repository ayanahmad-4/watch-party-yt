
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSocket } from '../context/SocketContext';

type SocketAck = {
  ok: boolean;
  pending?: boolean;
  message?: string;
  roomId?: string;
  username?: string;
};

type JoinApproved = {
  roomId: string;
  username: string;
};

type JoinRejected = {
  message?: string;
};

function makeDisplayName(prefix: 'Host' | 'Guest') {
  return `${prefix}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
}

function waitForConnection(
  socket: ReturnType<typeof useSocket>,
  timeoutMs = 12000
): Promise<void> {
  if (socket.connected) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    let settled = false;

    const cleanup = () => {
      window.clearTimeout(timer);
      socket.off('connect', onConnect);
      socket.off('connect_error', onError);
    };

    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      cleanup();

      if (error) reject(error);
      else resolve();
    };

    const onConnect = () => finish();

    const onError = (error: Error) => {
      finish(new Error(`Server connection failed: ${error.message}`));
    };

    const timer = window.setTimeout(() => {
      finish(
        new Error(
          'Could not connect to the server within 12 seconds. Check whether the backend is running.'
        )
      );
    }, timeoutMs);

    socket.once('connect', onConnect);
    socket.once('connect_error', onError);

    socket.connect();

    if (socket.connected) finish();
  });
}

export function Home() {
  const [roomId, setRoomId] = useState('');
  const [password, setPassword] = useState('');
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [waiting, setWaiting] = useState(false);

  const socket = useSocket();
  const navigate = useNavigate();

  const pendingJoinRef = useRef<{ password: string } | null>(null);
  const actionRef = useRef(false);

  useEffect(() => {
    const onJoinApproved = ({
      roomId: approvedRoomId,
      username,
    }: JoinApproved) => {
      const pending = pendingJoinRef.current;

      if (!pending) return;

      pendingJoinRef.current = null;
      setWaiting(false);
      setBusy(false);
      actionRef.current = false;

      setStatus('Host approved your request. Entering room...');

      navigate(`/room/${encodeURIComponent(approvedRoomId)}`, {
        state: {
          username,
          roomPassword: pending.password,
          alreadyJoined: true,
        },
      });
    };

    const onJoinRejected = ({ message }: JoinRejected) => {
      pendingJoinRef.current = null;
      setWaiting(false);
      setBusy(false);
      actionRef.current = false;
      setStatus(message || 'The host rejected your request.');
    };

    const onConnectError = (error: Error) => {
      console.error('Socket connection error:', error.message);
    };

    socket.on('join-approved', onJoinApproved);
    socket.on('join-rejected', onJoinRejected);
    socket.on('connect_error', onConnectError);

    return () => {
      socket.off('join-approved', onJoinApproved);
      socket.off('join-rejected', onJoinRejected);
      socket.off('connect_error', onConnectError);
    };
  }, [socket, navigate]);

  const validateCredentials = () => {
    const id = roomId.trim();
    const pass = password;

    if (!id) {
      setStatus('Please enter a Room ID.');
      return null;
    }

    if (!/^[a-zA-Z0-9_-]{3,40}$/.test(id)) {
      setStatus('Room ID must be 3–40 characters using letters, numbers, - or _.');
      return null;
    }

    if (pass.length < 4 || pass.length > 128) {
      setStatus('Password must contain between 4 and 128 characters.');
      return null;
    }

    return { id, pass };
  };

  const createRoom = async () => {
    if (actionRef.current) return;

    const credentials = validateCredentials();
    if (!credentials) return;

    actionRef.current = true;

    const username = makeDisplayName('Host');

    setBusy(true);
    setStatus('Connecting to server...');

    try {
      await waitForConnection(socket);

      setStatus('Creating room...');

      socket.timeout(10000).emit(
        'create-room',
        {
          roomId: credentials.id,
          password: credentials.pass,
          username,
        },
        (
          error: Error | null,
          response: SocketAck
        ) => {
          setBusy(false);
          actionRef.current = false;

          if (error) {
            setStatus(
              'Server did not respond. Check the backend terminal and try again.'
            );
            console.error('Create room acknowledgement timeout:', error);
            return;
          }

          if (!response?.ok) {
            setStatus(
              response?.message || 'Could not create the room.'
            );
            return;
          }

          setStatus('Room created successfully!');

          navigate(`/room/${encodeURIComponent(credentials.id)}`, {
            state: {
              username,
              roomPassword: credentials.pass,
              alreadyJoined: true,
            },
          });
        }
      );
    } catch (error) {
      setBusy(false);
      actionRef.current = false;

      const message =
        error instanceof Error
          ? error.message
          : 'Unable to connect to the server.';

      setStatus(message);
      console.error('Create room error:', error);
    }
  };

  const requestToJoin = async () => {
    if (actionRef.current) return;

    const credentials = validateCredentials();
    if (!credentials) return;

    actionRef.current = true;

    const username = makeDisplayName('Guest');

    setBusy(true);
    setStatus('Connecting to server...');

    try {
      await waitForConnection(socket);

      setStatus('Checking room credentials...');

      socket.timeout(10000).emit(
        'request-join',
        {
          roomId: credentials.id,
          password: credentials.pass,
          username,
        },
        (
          error: Error | null,
          response: SocketAck
        ) => {
          setBusy(false);

          if (error) {
            actionRef.current = false;
            pendingJoinRef.current = null;

            setStatus(
              'Server did not respond. Please check your connection and try again.'
            );

            console.error('Join request acknowledgement timeout:', error);
            return;
          }

          if (!response?.ok) {
            actionRef.current = false;
            pendingJoinRef.current = null;
            setWaiting(false);

            setStatus(
              response?.message || 'Could not request to join.'
            );
            return;
          }

          pendingJoinRef.current = {
            password: credentials.pass,
          };

          setWaiting(true);
          setStatus(
            'Request sent successfully. Please wait for host approval.'
          );
        }
      );
    } catch (error) {
      setBusy(false);
      actionRef.current = false;

      const message =
        error instanceof Error
          ? error.message
          : 'Unable to connect to the server.';

      setStatus(message);
      console.error('Join room error:', error);
    }
  };

  const cancelWaiting = () => {
    pendingJoinRef.current = null;
    actionRef.current = false;

    setWaiting(false);
    setBusy(false);

    setStatus('Request cancelled.');

    // Disconnecting removes the pending request on the server.
    socket.disconnect();

    window.setTimeout(() => {
      socket.connect();
    }, 100);
  };

  return (
    <div className="home-page">
      <div className="home-menu">
        <h1>YouTube Watch Party</h1>

        <label className="home-field">
          Room ID
          <input
            type="text"
            value={roomId}
            onChange={(event) => setRoomId(event.target.value)}
            placeholder="Enter room ID"
            autoComplete="off"
            disabled={busy || waiting}
          />
        </label>

        <label className="home-field">
          Password
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="Enter room password"
            autoComplete="new-password"
            disabled={busy || waiting}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !busy && !waiting) {
                requestToJoin();
              }
            }}
          />
        </label>

        {!waiting ? (
          <div className="home-actions">
            <button
              type="button"
              onClick={createRoom}
              disabled={busy}
            >
              {busy ? 'Please wait...' : 'Create Room'}
            </button>

            <button
              type="button"
              onClick={requestToJoin}
              disabled={busy}
            >
              {busy ? 'Please wait...' : 'Request to Join'}
            </button>
          </div>
        ) : (
          <div className="join-waiting">
            <strong>Waiting for host approval...</strong>

            <button
              type="button"
              onClick={cancelWaiting}
            >
              Cancel Request
            </button>
          </div>
        )}

        {status && (
          <p className="home-status" role="status">
            {status}
          </p>
        )}
      </div>
    </div>
  );
}
