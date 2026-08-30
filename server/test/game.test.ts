import { describe, expect, it } from "vitest";
import {
  GameStore,
  claimSpecialWin,
  chooseRps,
  drawToFive,
  pass,
  playCards,
  publicState,
  rollDice,
  finishParkingDraft,
  startParkingDraft,
  toggleParkingCard,
  type Room
} from "../src/game";
import type { Card } from "@seven-kings-523/shared";

function makeRoom(): Room {
  return {
    roomId: "ABC123",
    phase: "playing",
    players: {
      P1: {
        id: "P1",
        name: "P1",
        hasCustomName: true,
        sessionToken: "p1-token",
        connected: true,
        hand: cards(["7", "7", "4"])
      },
      P2: {
        id: "P2",
        name: "P2",
        hasCustomName: true,
        sessionToken: "p2-token",
        connected: true,
        hand: cards(["5", "5", "6"])
      }
    },
    dealMode: "standard",
    deck: cards(["A", "K", "Q", "J"]),
    discard: [],
    currentTurn: "P1",
    lastAction: "test",
    rps: { choices: {}, tieCount: 0 },
    firstMove: { mode: "rps", rpsChoices: {}, diceRolls: {}, tieCount: 0 },
    score: { P1: 0, P2: 0 },
    rematchReady: {}
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
    expect(joined.room?.players.P1?.hasCustomName).toBe(true);
    expect(joined.room?.players.P2?.hasCustomName).toBe(true);
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

  it("starts parking draft with the first player getting the odd extra pile card", () => {
    const room = makeRoom();
    room.phase = "rps";
    room.players.P1!.hand = [];
    room.players.P2!.hand = [];

    startParkingDraft(room, "P2", randomSequence([...Array.from({ length: 53 }, () => 0), 0.08, ...Array.from({ length: 45 }, () => 0)]), 1_000);

    expect(room.phase).toBe("drafting");
    expect(room.parkingDraft?.players.P2.pileCount).toBe(23);
    expect(room.parkingDraft?.players.P1.pileCount).toBe(22);
    expect(room.parkingDraft?.deadlineAt).toBe(13_000);
    expect(room.parkingDraft?.autoFinishAt).toBe(16_000);
  });

  it("finalizes parking draft by keeping first five selections and adding late penalty cards", () => {
    const room = makeRoom();
    const p1Pile = cards(["A", "4", "6", "8", "9", "10", "J", "Q"]);
    const p2Pile = cards(["5", "6", "7", "8", "9", "10", "J", "Q", "K", "A"]);

    room.phase = "drafting";
    room.currentTurn = undefined;
    room.deck = [];
    room.players.P1!.hand = [];
    room.players.P2!.hand = [];
    room.parkingDraft = {
      firstPlayer: "P1",
      startedAt: 1_000,
      deadlineAt: 8_000,
      autoFinishAt: 11_000,
      players: {
        P1: {
          pileCount: p1Pile.length,
          selectedCount: 6,
          finished: false,
          autoFinished: false,
          penaltyCards: 0,
          pile: p1Pile,
          selectedIds: p1Pile.slice(0, 6).map((card) => card.id)
        },
        P2: {
          pileCount: p2Pile.length,
          selectedCount: 2,
          finished: false,
          autoFinished: false,
          penaltyCards: 0,
          pile: p2Pile,
          selectedIds: p2Pile.slice(0, 2).map((card) => card.id)
        }
      }
    };

    finishParkingDraft(room, "P1", 8_500, () => 0);
    finishParkingDraft(room, "P2", 10_100, () => 0);

    expect(room.phase).toBe("playing");
    expect(room.currentTurn).toBe("P1");
    expect(room.players.P1?.hand.slice(0, 5).map((card) => card.id)).toEqual(p1Pile.slice(0, 5).map((card) => card.id));
    expect(room.players.P1?.hand).toHaveLength(6);
    expect(room.players.P2?.hand).toHaveLength(8);
    expect(room.parkingDraft?.players.P1.penaltyCards).toBe(1);
    expect(room.parkingDraft?.players.P2.penaltyCards).toBe(3);
  });

  it("blocks parking card changes after the draft deadline", () => {
    const room = makeRoom();
    const pile = cards(["A", "4", "6", "8", "9"]);

    room.phase = "drafting";
    room.players.P1!.hand = [];
    room.players.P2!.hand = [];
    room.parkingDraft = {
      firstPlayer: "P1",
      startedAt: 1_000,
      deadlineAt: 8_000,
      autoFinishAt: 11_000,
      players: {
        P1: {
          pileCount: pile.length,
          selectedCount: 0,
          finished: false,
          autoFinished: false,
          penaltyCards: 0,
          pile,
          selectedIds: []
        },
        P2: {
          pileCount: 0,
          selectedCount: 0,
          finished: false,
          autoFinished: false,
          penaltyCards: 0,
          pile: [],
          selectedIds: []
        }
      }
    };

    toggleParkingCard(room, "P1", pile[0].id, 7_999);

    expect(room.parkingDraft.players.P1.selectedIds).toEqual([pile[0].id]);
    expect(() => toggleParkingCard(room, "P1", pile[1].id, 8_001)).toThrow("选择时间已结束");
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
    expect(room.lastAction).toContain("摇骰胜出");
  });

  it("keeps your rps choice visible while hiding the opponent before reveal", () => {
    const store = new GameStore(() => 0.1);
    const created = store.handle(undefined, { type: "createRoom" });
    const joined = store.handle(undefined, { type: "joinRoom", roomId: created.room?.roomId ?? "" });
    const room = joined.room as Room;

    chooseRps(room, "P1", "scissors");

    const p1State = publicState(room, "P1");
    const p2State = publicState(room, "P2");

    expect(p1State.firstMove.rpsChoices.P1).toBe("scissors");
    expect(p2State.firstMove.rpsChoices.P1).toBe("rock");
  });

  it("tracks score and waits for both players before a rematch", () => {
    const store = new GameStore(() => 0.1);
    const created = store.handle(undefined, { type: "createRoom", name: "Alpha" });
    const joined = store.handle(undefined, { type: "joinRoom", roomId: created.room?.roomId ?? "", name: "Beta" });
    const room = joined.room as Room;

    room.phase = "playing";
    room.deck = [];
    room.currentTurn = "P1";
    room.players.P1!.hand = cards(["7"]);
    room.players.P2!.hand = cards(["5"]);

    playCards(room, "P1", [room.players.P1?.hand[0]?.id ?? ""]);

    expect(room.phase).toBe("finished");
    expect(room.score.P1).toBe(1);
    expect(room.score.P2).toBe(0);

    store.handle({ roomId: room.roomId, playerId: "P1" }, { type: "readyForRematch" });

    expect(room.phase).toBe("finished");
    expect(room.rematchReady.P1).toBe(true);
    expect(room.rematchReady.P2).toBeUndefined();

    store.handle({ roomId: room.roomId, playerId: "P2" }, { type: "readyForRematch" });

    expect(room.phase).toBe("rps");
    expect(room.score.P1).toBe(1);
    expect(room.rematchReady).toEqual({});
    expect(room.players.P1?.hand).toHaveLength(0);
    expect(room.players.P2?.hand).toHaveLength(0);
  });

  it("keeps the winning final play on the table and reveals remaining hands", () => {
    const room = makeRoom();
    room.deck = [];
    room.currentTurn = "P1";
    room.players.P1!.hand = cards(["7"]);
    room.players.P2!.hand = cards(["5", "6"]);

    const finalCardId = room.players.P1?.hand[0]?.id ?? "";

    playCards(room, "P1", [finalCardId]);

    expect(room.phase).toBe("finished");
    expect(room.currentTrick?.cards.map((card) => card.id)).toEqual([finalCardId]);
    expect(room.discard).toHaveLength(0);

    const p1State = publicState(room, "P1");
    const p2State = publicState(room, "P2");

    expect(p1State.players.find((player) => player.id === "P2")?.hand).toHaveLength(2);
    expect(p2State.players.find((player) => player.id === "P1")?.hand).toHaveLength(0);
    expect(p2State.currentTrick?.cards.map((card) => card.id)).toEqual([finalCardId]);
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

  it("only lets the current turn player draw to five", () => {
    const room = makeRoom();

    expect(() => drawToFive(room, "P2")).toThrow("还没轮到你");
  });

  it("waits for the player to claim a special win", () => {
    const room = makeRoom();
    room.players.P1!.hand = cards(["7", "small-joker", "5", "2"]);
    room.players.P2!.hand = cards(["A", "4", "6", "8"]);
    room.deck = cards(["3"]);

    drawToFive(room, "P1");

    expect(room.phase).toBe("playing");

    claimSpecialWin(room, "P1");

    expect(room.phase).toBe("finished");
    expect(room.winner?.reason).toBe("special");
    expect(room.score.P1).toBe(1);
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
