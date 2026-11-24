
import { io } from 'socket.io-client';

const socketUrl =
  import.meta.env.VITE_SOCKET_URL ||
  (import.meta.env.DEV
    ? 'http://localhost:5000'
    : 'https://yt-watch-party-backend.onrender.com');

export const socket = io(socketUrl, {
  autoConnect: true,
  reconnection: true,
  reconnectionAttempts: Infinity,
  reconnectionDelay: 1000,
  timeout: 10000,
});

socket.on('connect', () => {
  console.log(
    'SOCKET CONNECTED:',
    socket.id,
    'SERVER:',
    socketUrl
  );
});

socket.on('connect_error', (error) => {
  console.error(
    'SOCKET CONNECTION ERROR:',
    error.message
  );
});

socket.on('disconnect', (reason) => {
  console.log('SOCKET DISCONNECTED:', reason);
});
