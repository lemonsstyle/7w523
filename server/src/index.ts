import { createServer } from "node:http";
import { networkInterfaces } from "node:os";
import { WebSocketServer, type WebSocket } from "ws";
import { GameError, GameStore, publicState, type Room } from "./game.js";
import type { ClientMessage, PlayerId, ServerMessage } from "@seven-kings-523/shared";

interface ClientSession {
  roomId?: string;
  playerId?: PlayerId;
}

const port = Number(process.env.PORT ?? 8787);
const host = process.env.HOST ?? "0.0.0.0";
const store = new GameStore();
const sessions = new Map<WebSocket, ClientSession>();

const server = createServer((request, response) => {
  if (request.url === "/health") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ ok: true }));
    return;
  }

  response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
  response.end("Not found");
});

const wss = new WebSocketServer({ server });

wss.on("connection", (socket) => {
  sessions.set(socket, {});

  socket.on("message", (rawMessage) => {
    try {
      const message = parseClientMessage(rawMessage.toString());
      const session = sessions.get(socket);
      const result = store.handle(session, message);

      if (message.type === "leaveRoom") {
        sessions.set(socket, {});
        send(socket, { type: "leftRoom" });
      } else if (result.playerId && result.room) {
        sessions.set(socket, {
          roomId: result.room.roomId,
          playerId: result.playerId
        });
      }

      if (result.event.type === "created") {
        const player = result.room?.players[result.event.playerId];
        if (!player) {
          throw new GameError("房间创建后没有找到玩家身份。");
        }

        send(socket, {
          type: "roomCreated",
          roomId: result.event.roomId,
          playerId: result.event.playerId,
          sessionToken: player.sessionToken
        });
      }

      if (result.event.type === "joined") {
        const player = result.room?.players[result.event.playerId];
        if (!player) {
          throw new GameError("加入房间后没有找到玩家身份。");
        }

        send(socket, {
          type: "joinedRoom",
          roomId: result.event.roomId,
          playerId: result.event.playerId,
          sessionToken: player.sessionToken
        });
      }

      if (result.room) {
        broadcastRoom(result.room);
      }
    } catch (error) {
      send(socket, { type: "error", message: errorMessage(error) });
    }
  });

  socket.on("close", () => {
    const session = sessions.get(socket);
    sessions.delete(socket);

    if (!session?.roomId || !session.playerId) {
      return;
    }

    const room = store.markDisconnected(session.roomId, session.playerId);
    if (room) {
      broadcastRoom(room);
    }
  });
});

setInterval(() => {
  for (const room of store.expireDisconnected()) {
    broadcastRoom(room);
  }
}, 5_000).unref();

setInterval(() => {
  for (const room of store.autoFinishParkingDrafts()) {
    broadcastRoom(room);
  }
}, 250).unref();

server.listen(port, host, () => {
  console.log(`Seven Kings 523 server listening on ws://localhost:${port}`);
  for (const address of localNetworkAddresses()) {
    console.log(`LAN WebSocket: ws://${address}:${port}`);
  }
});

function broadcastRoom(room: Room): void {
  for (const [socket, session] of sessions.entries()) {
    if (session.roomId !== room.roomId || socket.readyState !== socket.OPEN) {
      continue;
    }

    send(socket, {
      type: "roomState",
      state: publicState(room, session.playerId)
    });
  }
}

function send(socket: WebSocket, message: ServerMessage): void {
  if (socket.readyState !== socket.OPEN) {
    return;
  }

  socket.send(JSON.stringify(message));
}

function parseClientMessage(rawMessage: string): ClientMessage {
  const parsed = JSON.parse(rawMessage) as unknown;

  if (!parsed || typeof parsed !== "object" || !("type" in parsed)) {
    throw new GameError("消息格式不正确。");
  }

  return parsed as ClientMessage;
}

function errorMessage(error: unknown): string {
  if (error instanceof GameError) {
    return error.message;
  }

  if (error instanceof SyntaxError) {
    return "消息不是合法 JSON。";
  }

  console.error(error);
  return "服务端遇到未预期错误。";
}

function localNetworkAddresses(): string[] {
  return Object.values(networkInterfaces())
    .flatMap((interfaces) => interfaces ?? [])
    .filter((networkInterface) => networkInterface.family === "IPv4" && !networkInterface.internal)
    .map((networkInterface) => networkInterface.address);
}
