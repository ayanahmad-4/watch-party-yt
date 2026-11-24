const express = require('express');
const http = require('http');
const cors = require('cors');
const crypto = require('crypto');
const { Server } = require('socket.io');

const app = express();
app.use(cors());
app.use(express.json());

app.get('/', (_req, res) => res.send('YouTube Watch Party Backend Running'));

const httpServer = http.createServer(app);
const io = new Server(httpServer, { cors: { origin: '*' } });
const rooms = Object.create(null);

const CONTROL_ACTIONS = ['play', 'pause', 'seek', 'changeVideo'];

function acknowledge(callback, result) {
  if (typeof callback === 'function') callback(result);
}

function hashPassword(password, salt) {
  return crypto.scryptSync(password, salt, 64);
}

function passwordMatches(password, salt, storedHash) {
  if (typeof password !== 'string' || !salt || !storedHash) return false;
  const candidate = hashPassword(password, salt);
  return candidate.length === storedHash.length && crypto.timingSafeEqual(candidate, storedHash);
}

function normalizeActions(actions) {
  if (!Array.isArray(actions)) return [];
  return [...new Set(actions.filter((action) => CONTROL_ACTIONS.includes(action)))];
}

function getRoom(socket) {
  const roomId = socket.data.currentRoomId;
  return roomId && rooms[roomId] ? rooms[roomId] : null;
}

function getParticipant(room, socketId) {
  return room.participants.find((participant) => participant.id === socketId);
}

function getCurrentRoomTime(room) {
  if (room.isPlaying && room.lastPlayTimestamp) {
    return room.currentTime + (Date.now() - room.lastPlayTimestamp) / 1000;
  }
  return room.currentTime;
}

function roomSnapshot(room) {
  return {
    roomId: room.roomId,
    hostId: room.hostId,
    videoId: room.videoId,
    currentTime: getCurrentRoomTime(room),
    isPlaying: room.isPlaying,
    lastPlayTimestamp: room.lastPlayTimestamp,
    participants: room.participants.map((participant) => ({ ...participant })),
    joinRequests: room.joinRequests.map(({ requestId, username, createdAt }) => ({
      requestId,
      username,
      createdAt,
    })),
    controlRequests: room.controlRequests.map((request) => ({
      ...request,
      permissions: [...request.permissions],
    })),
    controlGrants: Object.fromEntries(
      Object.entries(room.controlGrants).map(([userId, actions]) => [userId, [...actions]])
    ),
  };
}

function broadcastRoom(roomId) {
  const room = rooms[roomId];
  if (room) io.to(roomId).emit('room-update', roomSnapshot(room));
}

function isHost(socket, room) {
  return socket.id === room.hostId;
}

function canControl(room, socket, action) {
  const participant = getParticipant(room, socket.id);
  if (!participant) return false;
  if (participant.role === 'host') return true;
  return (room.controlGrants[socket.id] || []).includes(action);
}

function createRoomState(roomId, hostId, username, password) {
  const passwordSalt = crypto.randomBytes(16);
  return {
    roomId,
    hostId,
    passwordSalt,
    passwordHash: hashPassword(password, passwordSalt),
    videoId: '',
    currentTime: 0,
    isPlaying: false,
    lastPlayTimestamp: null,
    participants: [{ id: hostId, username, role: 'host' }],
    joinRequests: [],
    controlRequests: [],
    controlGrants: {},
  };
}

function removeParticipant(room, userId) {
  room.participants = room.participants.filter((item) => item.id !== userId);
  delete room.controlGrants[userId];
  room.controlRequests = room.controlRequests.filter((request) => request.userId !== userId);
}

function leaveCurrentRoom(socket) {
  const previousRoomId = socket.data.currentRoomId;
  if (!previousRoomId || !rooms[previousRoomId]) {
    socket.data.currentRoomId = null;
    return;
  }

  const previousRoom = rooms[previousRoomId];
  const previousParticipant = getParticipant(previousRoom, socket.id);
  removeParticipant(previousRoom, socket.id);
  socket.leave(previousRoomId);
  socket.data.currentRoomId = null;

  if (previousRoom.participants.length === 0) {
    delete rooms[previousRoomId];
    return;
  }

  if (previousRoom.hostId === socket.id) {
    const nextHost = previousRoom.participants[0];
    previousRoom.hostId = nextHost.id;
    nextHost.role = 'host';
    delete previousRoom.controlGrants[nextHost.id];
  }

  console.log('User left room:', previousParticipant?.username || socket.id, previousRoomId);
  broadcastRoom(previousRoomId);
}

io.on('connection', (socket) => {
  console.log('Socket connected:', socket.id);

  // CREATE ROOM: this is the only event that creates a room.
  socket.on('create-room', (payload = {}, callback) => {
    const roomId = String(payload.roomId || '').trim();
    const password = String(payload.password || '');
    const username = String(payload.username || '').trim();

    if (!/^[a-zA-Z0-9_-]{3,40}$/.test(roomId)) {
      acknowledge(callback, { ok: false, message: 'Room ID must be 3–40 characters and use letters, numbers, - or _.' });
      return;
    }
    if (password.length < 4 || password.length > 128) {
      acknowledge(callback, { ok: false, message: 'Password must be between 4 and 128 characters.' });
      return;
    }
    if (!username) {
      acknowledge(callback, { ok: false, message: 'Could not create a display name. Please try again.' });
      return;
    }
    if (rooms[roomId]) {
      acknowledge(callback, { ok: false, message: 'That room ID is already in use. Choose another ID or request to join it.' });
      return;
    }

    leaveCurrentRoom(socket);

    const room = createRoomState(roomId, socket.id, username, password);
    rooms[roomId] = room;
    socket.join(roomId);
    socket.data.currentRoomId = roomId;
    socket.data.pendingJoin = null;

    console.log(`Room created: ${roomId} by ${username}`);
    broadcastRoom(roomId);
    acknowledge(callback, { ok: true, roomId, username });
  });

  // REQUEST TO JOIN: never creates a room. Password is checked before host approval.
  socket.on('request-join', (payload = {}, callback) => {
    const roomId = String(payload.roomId || '').trim();
    const password = String(payload.password || '');
    const username = String(payload.username || '').trim();
    const room = rooms[roomId];

    if (!room) {
      acknowledge(callback, { ok: false, message: 'Room not found. Check the Room ID.' });
      return;
    }
    if (!passwordMatches(password, room.passwordSalt, room.passwordHash)) {
      acknowledge(callback, { ok: false, message: 'Incorrect room password.' });
      return;
    }
    if (!username) {
      acknowledge(callback, { ok: false, message: 'Could not create a display name. Please try again.' });
      return;
    }
    if (getParticipant(room, socket.id)) {
      acknowledge(callback, { ok: false, message: 'You are already in this room.' });
      return;
    }

    const existingRequest = room.joinRequests.find((request) => request.socketId === socket.id);
    if (existingRequest) {
      acknowledge(callback, { ok: true, pending: true, message: 'Your request is already waiting for host approval.' });
      return;
    }

    const request = {
      requestId: `${socket.id}-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`,
      socketId: socket.id,
      username,
      createdAt: Date.now(),
    };

    room.joinRequests.push(request);
    socket.data.pendingJoin = { roomId, requestId: request.requestId, username };

    io.to(room.hostId).emit('join-request', {
      requestId: request.requestId,
      username: request.username,
      createdAt: request.createdAt,
    });
    broadcastRoom(roomId);

    console.log(`JOIN REQUEST: ${username} requested room ${roomId}`);
    acknowledge(callback, { ok: true, pending: true, message: 'Request sent. Waiting for host approval.' });
  });

  // HOST APPROVES OR REJECTS A ROOM JOIN REQUEST.
  socket.on('respond-join-request', (payload = {}, callback) => {
    const room = getRoom(socket);
    if (!room || !isHost(socket, room)) {
      acknowledge(callback, { ok: false, message: 'Only the host can approve join requests.' });
      return;
    }

    const requestId = String(payload.requestId || '');
    const approved = payload.approved;
    if (!requestId || typeof approved !== 'boolean') {
      acknowledge(callback, { ok: false, message: 'Invalid join request response.' });
      return;
    }

    const index = room.joinRequests.findIndex((request) => request.requestId === requestId);
    if (index < 0) {
      acknowledge(callback, { ok: false, message: 'This join request is no longer pending.' });
      return;
    }

    const [request] = room.joinRequests.splice(index, 1);
    const requesterSocket = io.sockets.sockets.get(request.socketId);

    if (!requesterSocket || !requesterSocket.connected) {
      broadcastRoom(room.roomId);
      acknowledge(callback, { ok: false, message: 'The requester has disconnected.' });
      return;
    }

    if (approved) {
      leaveCurrentRoom(requesterSocket);
      requesterSocket.join(room.roomId);
      requesterSocket.data.currentRoomId = room.roomId;
      requesterSocket.data.pendingJoin = null;
      room.participants.push({
        id: request.socketId,
        username: request.username,
        role: 'participant',
      });
      requesterSocket.emit('join-approved', {
        roomId: room.roomId,
        username: request.username,
      });
      console.log(`JOIN APPROVED: ${request.username} entered room ${room.roomId}`);
    } else {
      requesterSocket.data.pendingJoin = null;
      requesterSocket.emit('join-rejected', {
        message: 'The host did not approve your request to join.'
      });
      console.log(`JOIN REJECTED: ${request.username} for room ${room.roomId}`);
    }

    broadcastRoom(room.roomId);
    acknowledge(callback, { ok: true });
  });

  // GET ROOM: only an approved member can retrieve room state.
  socket.on('get-room', (payload = {}) => {
    const roomId = String(payload.roomId || '').trim();
    const room = rooms[roomId];
    if (!room || !getParticipant(room, socket.id) || socket.data.currentRoomId !== roomId) {
      socket.emit('room-update', null);
      return;
    }
    socket.emit('room-update', roomSnapshot(room));
  });

  // REQUEST ACCESS TO SPECIFIC PLAYBACK ACTIONS.
  socket.on('request-control', (payload = {}, callback) => {
    const room = getRoom(socket);
    if (!room) {
      acknowledge(callback, { ok: false, message: 'Room not found. Rejoin the room.' });
      return;
    }

    const participant = getParticipant(room, socket.id);
    if (!participant || participant.role === 'host') {
      acknowledge(callback, { ok: false, message: 'Only moderators and participants can request access.' });
      return;
    }

    const requestedActions = normalizeActions(payload.permissions);
    if (requestedActions.length === 0) {
      acknowledge(callback, { ok: false, message: 'Select at least one control permission.' });
      return;
    }

    const alreadyGranted = room.controlGrants[socket.id] || [];
    const missingActions = requestedActions.filter((action) => !alreadyGranted.includes(action));
    if (missingActions.length === 0) {
      acknowledge(callback, { ok: false, message: 'You already have these permissions.' });
      return;
    }
    if (room.controlRequests.some((request) => request.userId === socket.id)) {
      acknowledge(callback, { ok: false, message: 'You already have a pending request.' });
      return;
    }

    const request = {
      requestId: `${socket.id}-${Date.now()}`,
      userId: socket.id,
      username: participant.username,
      role: participant.role,
      permissions: missingActions,
      createdAt: Date.now(),
    };

    room.controlRequests.push(request);
    io.to(room.hostId).emit('control-request', request);
    broadcastRoom(room.roomId);
    console.log(`CONTROL REQUEST: ${participant.username} requested ${missingActions.join(', ')} in room ${room.roomId}`);
    acknowledge(callback, { ok: true, message: 'Request sent to the host.' });
  });

  // HOST APPROVES OR REJECTS A PLAYBACK PERMISSION REQUEST.
  socket.on('respond-control-request', (payload = {}, callback) => {
    const room = getRoom(socket);
    if (!room || !isHost(socket, room)) {
      acknowledge(callback, { ok: false, message: 'Only the host can respond to requests.' });
      return;
    }

    const requestId = String(payload.requestId || '');
    const approved = payload.approved;
    if (!requestId || typeof approved !== 'boolean') {
      acknowledge(callback, { ok: false, message: 'Invalid response.' });
      return;
    }

    const index = room.controlRequests.findIndex((item) => item.requestId === requestId);
    if (index < 0) {
      acknowledge(callback, { ok: false, message: 'This request is no longer pending.' });
      return;
    }

    const [request] = room.controlRequests.splice(index, 1);
    const target = getParticipant(room, request.userId);
    if (!target || target.role === 'host') {
      broadcastRoom(room.roomId);
      acknowledge(callback, { ok: false, message: 'The requester is no longer in the room.' });
      return;
    }

    if (approved) {
      const current = room.controlGrants[request.userId] || [];
      room.controlGrants[request.userId] = [...new Set([...current, ...normalizeActions(request.permissions)])];
    }

    io.to(request.userId).emit('control-access-result', {
      approved,
      revoked: false,
      permissions: approved ? room.controlGrants[request.userId] : [],
    });
    broadcastRoom(room.roomId);
    acknowledge(callback, { ok: true });
  });

  // HOST REVOKES ALL OR ONE SPECIFIC PLAYBACK PERMISSION.
  socket.on('revoke-control-access', (payload = {}, callback) => {
    const room = getRoom(socket);
    if (!room || !isHost(socket, room)) {
      acknowledge(callback, { ok: false, message: 'Only the host can revoke access.' });
      return;
    }

    const userId = String(payload.userId || '');
    if (!userId || !getParticipant(room, userId)) {
      acknowledge(callback, { ok: false, message: 'Participant not found.' });
      return;
    }

    const action = payload.action;
    const current = room.controlGrants[userId] || [];
    if (action && CONTROL_ACTIONS.includes(action)) {
      room.controlGrants[userId] = current.filter((item) => item !== action);
    } else {
      delete room.controlGrants[userId];
    }
    if (room.controlGrants[userId]?.length === 0) delete room.controlGrants[userId];

    io.to(userId).emit('control-access-result', {
      approved: false,
      revoked: true,
      permissions: room.controlGrants[userId] || [],
    });
    broadcastRoom(room.roomId);
    acknowledge(callback, { ok: true });
  });

  // HOST ASSIGNS PARTICIPANT OR MODERATOR ROLE.
  socket.on('assign-role', (payload = {}) => {
    const room = getRoom(socket);
    if (!room || !isHost(socket, room)) return;
    const userId = String(payload.userId || '');
    const role = payload.role;
    if (!['participant', 'moderator'].includes(role)) return;
    const participant = getParticipant(room, userId);
    if (!participant || userId === room.hostId) return;

    participant.role = role;
    room.controlRequests = room.controlRequests.filter((request) => request.userId !== userId);
    io.to(room.roomId).emit('role-assigned', { userId, role, participants: room.participants });
    broadcastRoom(room.roomId);
  });

  // HOST REMOVES A PARTICIPANT.
  socket.on('remove-participant', (payload = {}) => {
    const room = getRoom(socket);
    if (!room || !isHost(socket, room)) return;
    const userId = String(payload.userId || '');
    if (!userId || userId === room.hostId || !getParticipant(room, userId)) return;

    removeParticipant(room, userId);
    io.to(userId).emit('kicked');
    io.to(room.roomId).emit('participant-removed', { userId, participants: room.participants });
    broadcastRoom(room.roomId);
  });

  // PLAY.
  socket.on('play', (_payload, callback) => {
    const room = getRoom(socket);
    if (!room || !canControl(room, socket, 'play')) {
      acknowledge(callback, { ok: false, message: 'Play permission denied.' });
      return;
    }
    if (!room.isPlaying) {
      room.isPlaying = true;
      room.lastPlayTimestamp = Date.now();
    }
    io.to(room.roomId).emit('video-play', { isPlaying: true, currentTime: getCurrentRoomTime(room) });
    broadcastRoom(room.roomId);
    acknowledge(callback, { ok: true });
  });

  // PAUSE.
  socket.on('pause', (_payload, callback) => {
    const room = getRoom(socket);
    if (!room || !canControl(room, socket, 'pause')) {
      acknowledge(callback, { ok: false, message: 'Pause permission denied.' });
      return;
    }
    if (room.isPlaying && room.lastPlayTimestamp) room.currentTime = getCurrentRoomTime(room);
    room.isPlaying = false;
    room.lastPlayTimestamp = null;
    io.to(room.roomId).emit('video-pause', { isPlaying: false, currentTime: room.currentTime });
    broadcastRoom(room.roomId);
    acknowledge(callback, { ok: true });
  });

  // SEEK.
  socket.on('seek', (payload = {}, callback) => {
    const room = getRoom(socket);
    if (!room || !canControl(room, socket, 'seek')) {
      acknowledge(callback, { ok: false, message: 'Seek permission denied.' });
      return;
    }
    const time = Number(payload.time);
    if (!Number.isFinite(time) || time < 0) {
      acknowledge(callback, { ok: false, message: 'Invalid seek time.' });
      return;
    }
    room.currentTime = time;
    if (room.isPlaying) room.lastPlayTimestamp = Date.now();
    io.to(room.roomId).emit('video-seek', { time });
    broadcastRoom(room.roomId);
    acknowledge(callback, { ok: true });
  });

  // CHANGE YOUTUBE VIDEO.
  socket.on('change-video', (payload = {}, callback) => {
    const room = getRoom(socket);
    if (!room || !canControl(room, socket, 'changeVideo')) {
      acknowledge(callback, { ok: false, message: 'Open Video permission denied.' });
      return;
    }
    const videoId = String(payload.videoId || '').trim();
    if (!/^[a-zA-Z0-9_-]{11}$/.test(videoId)) {
      acknowledge(callback, { ok: false, message: 'Invalid YouTube video ID.' });
      return;
    }
    room.videoId = videoId;
    room.currentTime = 0;
    room.isPlaying = false;
    room.lastPlayTimestamp = null;
    io.to(room.roomId).emit('video-change', { videoId });
    broadcastRoom(room.roomId);
    acknowledge(callback, { ok: true });
  });

  // SYNC REQUEST.
  socket.on('sync-request', () => {
    const room = getRoom(socket);
    if (room && getParticipant(room, socket.id)) socket.emit('room-update', roomSnapshot(room));
  });

  // TRANSFER HOST.
  socket.on('transfer-host', (payload = {}) => {
    const room = getRoom(socket);
    if (!room || !isHost(socket, room)) return;
    const userId = String(payload.userId || '');
    const target = getParticipant(room, userId);
    if (!target || userId === room.hostId) return;

    const previousHostId = room.hostId;
    room.hostId = userId;
    room.participants.forEach((participant) => {
      if (participant.id === userId) participant.role = 'host';
      else if (participant.id === previousHostId) participant.role = 'participant';
    });
    delete room.controlGrants[userId];
    delete room.controlGrants[previousHostId];
    room.controlRequests = room.controlRequests.filter(
      (request) => request.userId !== userId && request.userId !== previousHostId
    );
    io.to(room.roomId).emit('host-transferred', { hostId: userId, participants: room.participants });
    broadcastRoom(room.roomId);
  });

  // CHAT.
  socket.on('send-message', (payload = {}) => {
    const room = getRoom(socket);
    if (!room || !getParticipant(room, socket.id)) return;
    const message = String(payload.message || '').trim();
    if (!message) return;
    const participant = getParticipant(room, socket.id);
    io.to(room.roomId).emit('new-message', { username: participant.username, message, time: Date.now() });
  });

  // REACTIONS.
  socket.on('send-reaction', (payload = {}) => {
    const room = getRoom(socket);
    if (!room || !getParticipant(room, socket.id)) return;
    const emoji = String(payload.emoji || '').trim();
    if (emoji) io.to(room.roomId).emit('new-reaction', { emoji });
  });

  // DISCONNECT: also clear any pending join requests from this socket.
  socket.on('disconnect', () => {
    for (const room of Object.values(rooms)) {
      const before = room.joinRequests.length;
      room.joinRequests = room.joinRequests.filter((request) => request.socketId !== socket.id);
      if (room.joinRequests.length !== before) broadcastRoom(room.roomId);
    }

    const roomId = socket.data.currentRoomId;
    if (!roomId || !rooms[roomId]) return;
    const room = rooms[roomId];
    const participant = getParticipant(room, socket.id);
    removeParticipant(room, socket.id);

    console.log('User disconnected:', participant?.username || socket.id, 'from room', roomId);

    if (room.participants.length === 0) {
      delete rooms[roomId];
      console.log('Room deleted:', roomId);
      return;
    }

    if (room.hostId === socket.id) {
      const newHost = room.participants[0];
      room.hostId = newHost.id;
      newHost.role = 'host';
      delete room.controlGrants[newHost.id];
      room.controlRequests = room.controlRequests.filter((request) => request.userId !== newHost.id);
      console.log('New host:', newHost.username, 'in room', roomId);
    }
    broadcastRoom(roomId);
  });
});

const PORT = process.env.PORT || 5000;
httpServer.listen(PORT, () => console.log(`YouTube Watch Party server running on port ${PORT}`));
