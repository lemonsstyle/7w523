import { describe, expect, it } from "vitest";
import {
  GameStore,
  chooseRps,
  drawToFive,
  pass,
  playCards,
  publicState,
  rollDice,
  type Room
} from "../src/game";
import type { Card } from "@seven-kings-523/shared";

function makeRoom(): Room {
  return {
    roomId: "ABC123",
    phase: "playing",
    players: {
      P1: { id: "P1", name: "P1", sessionToken: "p1-token", connected: true, hand: cards(["7", "7", "4"]) },
      P2: { id: "P2", name: "P2", sessionToken: "p2-token", connected: true, hand: cards(["5", "5", "6"]) }
    },
    deck: cards(["A", "K", "Q", "J"]),
    discard: [],
    currentTurn: "P1",
    lastAction: "test",
    rps: { choices: {}, tieCount: 0 },
    firstMove: { mode: "rps", rpsChoices: {}, diceRolls: {}, tieCount: 0 }
  };
}

function cards(ranks: Card["rank"][]): Card[] {
  return ranks.map((rank, index) => ({ id: `${rank}-${index}-${Math.random()}`, rank }));
}

function randomSequence(values: number[]): () => number {
  let index = 0;
  return () => values[index++] ?? 0;
}

describe("game flow", () => {
  it("creates and joins a room", () => {
    const store = new GameStore(() => 0.1);
    const created = store.handle(undefined, { type: "createRoom", name: "Alpha" });
    const joined = store.handle(undefined, { type: "joinRoom", roomId: created.room?.roomId ?? "", name: "Beta" });

    expect(created.playerId).toBe("P1");
    expect(joined.playerId).toBe("P2");
    expect(joined.room?.phase).toBe("rps");
  });

  it("requires a matching token to reconnect as an existing player", () => {
    const store = new GameStore(() => 0.1);
    const created = store.handle(undefined, { type: "createRoom", name: "Alpha" });
    const roomId = created.room?.roomId ?? "";
    const sessionToken = created.room?.players.P1?.sessionToken ?? "";

    expect(() =>
      store.handle(undefined, { type: "joinRoom", roomId, playerId: "P1", sessionToken: "wrong" })
    ).toThrow("重连身份不匹配");

    const reconnected = store.handle(undefined, { type: "joinRoom", roomId, playerId: "P1", sessionToken });
    expect(reconnected.playerId).toBe("P1");
  });

  it("marks a player disconnected when returning to lobby", () => {
    const store = new GameStore(() => 0.1);
    const created = store.handle(undefined, { type: "createRoom", name: "Alpha" });
    const roomId = created.room?.roomId ?? "";
    const result = store.handle({ roomId, playerId: "P1" }, { type: "leaveRoom" });

    expect(result.room?.players.P1?.connected).toBe(false);
    expect(result.room?.lastAction).toContain("返回了大厅");
  });

  it("moves from rps into playing", () => {
    const store = new GameStore(() => 0.1);
    const created = store.handle(undefined, { type: "createRoom" });
    const joined = store.handle(undefined, { type: "joinRoom", roomId: created.room?.roomId ?? "" });
    const room = joined.room;

    expect(room).toBeDefined();
    chooseRps(room as Room, "P1", "rock");
    chooseRps(room as Room, "P2", "scissors");

    expect(room?.phase).toBe("playing");
    expect(room?.currentTurn).toBe("P1");
    expect(room?.players.P1?.hand).toHaveLength(5);
    expect(room?.players.P2?.hand).toHaveLength(5);
  });

  it("removes 8 to 20 cards before dealing", () => {
    const minimumRemovedRoom = startRoomWithRemovalRandom(0);
    const maximumRemovedRoom = startRoomWithRemovalRandom(0.999);

    expect(minimumRemovedRoom.deck.length).toBe(36);
    expect(maximumRemovedRoom.deck.length).toBe(24);
  });

  it("can use dice rolls to decide first player", () => {
    const store = new GameStore(() => 0.1);
    const created = store.handle(undefined, { type: "createRoom" });
    const joined = store.handle(undefined, { type: "joinRoom", roomId: created.room?.roomId ?? "" });
    const room = joined.room as Room;

    store.handle({ roomId: room.roomId, playerId: "P1" }, { type: "setFirstMoveMode", mode: "dice" });
    rollDice(room, "P1", () => 0.9);
    rollDice(room, "P2", () => 0.1);

    expect(room.phase).toBe("playing");
    expect(room.currentTurn).toBe("P1");
    expect(room.firstMove.diceRolls.P1).toBe(6);
    expect(room.firstMove.diceRolls.P2).toBe(1);
  });

  it("plays, passes, and lets previous player lead", () => {
    const room = makeRoom();

    playCards(room, "P1", [room.players.P1?.hand[0]?.id ?? ""]);
    expect(room.currentTurn).toBe("P2");
    pass(room, "P2");
    expect(room.currentTurn).toBe("P1");
    expect(room.currentTrick).toBeUndefined();
  });

  it("draws both players to five by turn order", () => {
    const room = makeRoom();

    drawToFive(room, "P1");

    expect(room.players.P1?.hand.length).toBe(5);
    expect(room.players.P2?.hand.length).toBe(5);
    expect(room.deck.length).toBe(0);
  });

  it("hides opponent hand in public state", () => {
    const room = makeRoom();
    const state = publicState(room, "P1");

    expect(state.players.find((player) => player.id === "P1")?.hand).toHaveLength(3);
    expect(state.players.find((player) => player.id === "P2")?.hand).toBeUndefined();
  });
});

function startRoomWithRemovalRandom(removalRandom: number): Room {
  const dealRandom = randomSequence([...Array.from({ length: 53 }, () => 0), removalRandom]);
  const store = new GameStore(() => 0.1);
  const created = store.handle(undefined, { type: "createRoom" });
  const joined = store.handle(undefined, { type: "joinRoom", roomId: created.room?.roomId ?? "" });
  const room = joined.room as Room;

  chooseRps(room, "P1", "rock", dealRandom);
  chooseRps(room, "P2", "scissors", dealRandom);

  return room;
}
