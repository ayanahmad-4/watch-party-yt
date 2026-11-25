# YouTube Watch Party System

## Project Overview

YouTube Watch Party System is a real-time web application that allows multiple participants to watch YouTube videos together in a shared virtual room. The application synchronizes video playback across participants, enabling everyone to watch, pause, and resume videos together.

Users can create private rooms, join existing rooms, and interact with other participants while watching videos. The system also supports host and moderator roles, participant management, and synchronized playback controls to provide an interactive group viewing experience.

## Features

- **Create and Join Rooms** – Create private watch rooms or join existing rooms using a Room ID and password.
- **YouTube Video Integration** – Play YouTube videos directly within the application using the YouTube IFrame Player API.
- **Real-Time Playback Synchronization** – Synchronize play, pause, seek, and video change events across participants.
- **Host and Moderator Roles** – Support role-based permissions for managing rooms and participants.
- **Participant Management** – Manage participants, assign roles, and control access to room activities.
- **Control Access Management** – Allow participants to request playback control permissions.
- **Real-Time Communication** – Use Socket.IO for real-time events and synchronization between users.
- **Private Rooms** – Protect watch rooms with passwords.
- **Interactive Experience** – Enable participants to communicate and interact during shared viewing sessions.

## Tech Stack

### Frontend
- React
- TypeScript
- Vite
- CSS

### Backend
- Node.js
- Express.js
- Socket.IO

### Video Integration
- YouTube IFrame Player API

### Tools
- Git
- GitHub
- Visual Studio Code

## Installation and Setup

### Prerequisites

Ensure the following are installed on your system:

- Node.js (v18 or later recommended)
- npm
- Git

### Clone the Repository

```bash
git clone https://github.com/ayanahmad-4/watch-party-yt.git
```

Navigate to the project directory:

```bash
cd watch-party-yt
```

## Environment Variables

### Backend Configuration

Navigate to the server directory:

```bash
cd server
```

Create a `.env` file in the server directory:

```env
PORT=5000
```

If additional environment variables are required by your project configuration, configure them accordingly.

## How to Run Locally

### 1. Start the Backend

Open a terminal and navigate to the server directory:

```bash
cd server
```

Install the dependencies:

```bash
npm install
```

Start the backend server:

```bash
npm start
```

The backend server will run on:

```text
http://localhost:5000
```

### 2. Start the Frontend

Open another terminal and navigate to the client directory:

```bash
cd client
```

Install the dependencies:

```bash
npm install
```

Start the development server:

```bash
npm run dev
```

The frontend will be accessible at the local URL provided by Vite, usually:

```text
http://localhost:5173
```

## Architecture Overview

The application follows a client-server architecture.

- **Frontend:** The React application provides the user interface for creating rooms, joining sessions, watching YouTube videos, and managing participants.
- **Backend:** The Node.js and Express server handles room-related operations and manages communication between connected users.
- **Real-Time Communication:** Socket.IO enables real-time exchange of playback events, room updates, participant activities, and control requests.
- **YouTube Integration:** The YouTube IFrame Player API embeds YouTube videos into the application and enables playback controls.
- **Synchronization:** Playback events such as play, pause, seek, and video changes are broadcast to participants in the same room to maintain a synchronized viewing experience.

## Live Application URL

https://youtube-watch-party-umwn.onrender.com/

## GitHub Repository

https://github.com/ayanahmad-4/watch-party-yt.git
