// useCampRoom.js — join the backend camp room for the selected camp so
// camp-scoped Socket.io events (queue, checklist, service records) are received.
// The backend verifies permission before accepting the join.
//
// Several workflow cards on one screen can watch the same camp. The registry
// keeps a single socket room membership with reference counting, so unmounting
// one card cannot silently remove another card's live updates.
import { useEffect, useState } from 'react';
import { useApp } from '../store.jsx';

const roomsBySocket = new WeakMap();

function getRoom(socket, campId) {
  let byCamp = roomsBySocket.get(socket);
  if (!byCamp) {
    byCamp = new Map();
    roomsBySocket.set(socket, byCamp);
  }

  let room = byCamp.get(campId);
  if (!room) {
    room = {
      subscribers: new Set(),
      joined: false,
      setJoined(value) {
        room.joined = Boolean(value);
        room.subscribers.forEach((notify) => notify(room.joined));
      },
      join() {
        socket.emit('camp:join', campId, (result) => room.setJoined(result?.ok));
      },
      onDisconnect() {
        room.setJoined(false);
      },
    };
    socket.on('connect', room.join);
    socket.on('disconnect', room.onDisconnect);
    byCamp.set(campId, room);
    if (socket.connected) room.join();
  }
  return room;
}

export function useCampRoom(campId) {
  const { socket } = useApp();
  const [joined, setJoined] = useState(false);

  useEffect(() => {
    const id = campId === null || campId === undefined || campId === '' ? null : Number(campId);
    if (!socket || !id || Number.isNaN(id)) {
      setJoined(false);
      return undefined;
    }

    const room = getRoom(socket, id);
    room.subscribers.add(setJoined);
    setJoined(room.joined);

    return () => {
      room.subscribers.delete(setJoined);
      if (room.subscribers.size) return;
      socket.off('connect', room.join);
      socket.off('disconnect', room.onDisconnect);
      if (socket.connected) socket.emit('camp:leave', id);
      const byCamp = roomsBySocket.get(socket);
      byCamp?.delete(id);
      room.setJoined(false);
    };
  }, [socket, campId]);

  return joined;
}
