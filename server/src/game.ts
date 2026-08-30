import {
  HAND_TARGET_SIZE,
  ROOM_RECONNECT_MS,
  analyzeCards,
  canBeat,
  createDeck,
  hasSpecialWin,
  rpsWinner,
  sortCards,
  type Card,
  type ClientMessage,
  type DealMode,
  type FirstMoveMode,
  type FirstMoveState,
  type ParkingDraftState,
  type PlayedSet,
  type PlayerId,
  type PublicPlayerState,
  type PublicRoomState,
  type RankValue,
  type RematchReadyState,
  type RpsChoice,
  type RpsState,
  type ScoreState,
  type WinnerState
} from "@seven-kings-523/shared";

const PARKING_DRAFT_MS = 7_000;
const PARKING_AUTO_FINISH_MS = 10_000;
const PARKING_REVEAL_MS = 5_000;
const MAX_PARKING_PENALTY = 3;

export interface Player {
  id: PlayerId;
  name: string;
  hasCustomName: boolean;
  sessionToken: string;
  connected: boolean;
  hand: Card[];
  reconnectUntil?: number;
}

export interface Room {
  roomId: string;
  phase: PublicRoomState["phase"];
  players: Partial<Record<PlayerId, Player>>;
  dealMode: DealMode;
  deck: Card[];
  discard: Card[];
  currentTurn?: PlayerId;
  currentTrick?: PlayedSet;
  currentTrickOwner?: PlayerId;
  parkingDraft?: ParkingDraftState;
  lastAction: string;
  rps: RpsState;
  firstMove: FirstMoveState;
  score: ScoreState;
  rematchReady: RematchReadyState;
  winner?: WinnerState;
  closedAt?: number;
}

export type GameEvent =
  | { type: "created"; roomId: string; playerId: PlayerId }
  | { type: "joined"; roomId: string; playerId: PlayerId }
  | { type: "updated" };

export class GameError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GameError";
  }
}

export class GameStore {
  private readonly rooms = new Map<string, Room>();
  private readonly random: () => number;

  constructor(random: () => number = Math.random) {
    this.random = random;
  }

  handle(
    session: { roomId?: string; playerId?: PlayerId } | undefined,
    message: ClientMessage
  ): { playerId?: PlayerId; room?: Room; event: GameEvent } {
    switch (message.type) {
      case "createRoom":
        return this.createRoom(message.name);
      case "joinRoom":
        return this.joinRoom(message.roomId, message.name, message.playerId, message.sessionToken);
      case "leaveRoom":
        return this.withPlayer(session, (room, player) => {
          player.connected = false;
          player.reconnectUntil = Date.now() + ROOM_RECONNECT_MS;
          room.lastAction = `${player.name} 返回了大厅，房间会短时间保留。`;
          return room;
        });
      case "setDealMode":
        return this.withPlayer(session, (room, player) => {
          setDealMode(room, player.id, message.mode);
          return room;
        });
      case "setFirstMoveMode":
        return this.withPlayer(session, (room, player) => {
          setFirstMoveMode(room, player.id, message.mode);
          return room;
        });
      case "chooseRps":
        return this.withPlayer(session, (room, player) => {
          chooseRps(room, player.id, message.choice, this.random);
          return room;
        });
      case "rollDice":
        return this.withPlayer(session, (room, player) => {
          rollDice(room, player.id, this.random);
          return room;
        });
      case "toggleParkingCard":
        return this.withPlayer(session, (room, player) => {
          toggleParkingCard(room, player.id, message.cardId);
          return room;
        });
      case "finishParkingDraft":
        return this.withPlayer(session, (room, player) => {
          finishParkingDraft(room, player.id, Date.now(), this.random);
          return room;
        });
      case "playCards":
        return this.withPlayer(session, (room, player) => {
          playCards(room, player.id, message.cardIds);
          return room;
        });
      case "pass":
        return this.withPlayer(session, (room, player) => {
          pass(room, player.id);
          return room;
        });
      case "drawToFive":
        return this.withPlayer(session, (room, player) => {
          drawToFive(room, player.id);
          return room;
        });
      case "claimSpecialWin":
        return this.withPlayer(session, (room, player) => {
          claimSpecialWin(room, player.id);
          return room;
        });
      case "surrender":
        return this.withPlayer(session, (room, player) => {
          surrender(room, player.id);
          return room;
        });
      case "readyForRematch":
        return this.withPlayer(session, (room, player) => {
          readyForRematch(room, player.id);
          return room;
        });
      case "restartGame":
        return this.withPlayer(session, (room, player) => {
          restartGame(room, player.id, this.random);
          return room;
        });
      default:
        return assertNever(message);
    }
  }

  getRoom(roomId: string): Room | undefined {
    return this.rooms.get(roomId);
  }

  markDisconnected(roomId: string, playerId: PlayerId, now = Date.now()): Room | undefined {
    const room = this.rooms.get(roomId);
    const player = room?.players[playerId];

    if (!room || !player) {
      return undefined;
    }

    player.connected = false;
    player.reconnectUntil = now + ROOM_RECONNECT_MS;

    if (room.phase !== "finished") {
      room.lastAction = `${player.name} 断开了连接，房间会为他保留一小段时间。`;
    }

    return room;
  }

  expireDisconnected(now = Date.now()): Room[] {
    const changed: Room[] = [];

    for (const room of this.rooms.values()) {
      if (room.phase === "finished") {
        continue;
      }

      const expiredPlayer = orderedPlayers(room).find(
        (player) => !player.connected && player.reconnectUntil !== undefined && player.reconnectUntil <= now
      );

      if (!expiredPlayer) {
        continue;
      }

      const opponentId = opponentOf(expiredPlayer.id);
      room.phase = "finished";
      room.winner = {
        playerId: opponentId,
        reason: "opponentLeft"
      };
      room.score[opponentId] += 1;
      room.rematchReady = {};
      room.currentTurn = undefined;
      room.lastAction = `${expiredPlayer.name} 未能及时重连，对局结束。`;
      changed.push(room);
    }

    return changed;
  }

  autoFinishParkingDrafts(now = Date.now()): Room[] {
    const changed: Room[] = [];

    for (const room of this.rooms.values()) {
      if (autoFinishParkingDrafts(room, now, this.random)) {
        changed.push(room);
      }
    }

    return changed;
  }

  private createRoom(name?: string): { playerId: PlayerId; room: Room; event: GameEvent } {
    const roomId = createRoomId(this.random);
    const room: Room = {
      roomId,
      phase: "lobby",
      players: {
        P1: makePlayer("P1", name, this.random)
      },
      dealMode: "standard",
      deck: [],
      discard: [],
      lastAction: "房间已创建，等待第二位玩家加入。",
      rps: { choices: {}, tieCount: 0 },
      firstMove: makeFirstMoveState("rps"),
      score: makeScoreState(),
      rematchReady: {}
    };

    this.rooms.set(roomId, room);

    return {
      playerId: "P1",
      room,
      event: { type: "created", roomId, playerId: "P1" }
    };
  }

  private joinRoom(
    roomId: string,
    name?: string,
    reconnectPlayerId?: PlayerId,
    sessionToken?: string
  ): { playerId: PlayerId; room: Room; event: GameEvent } {
    const room = this.rooms.get(roomId.trim().toUpperCase());

    if (!room) {
      throw new GameError("没有找到这个房间。请检查链接是否完整。");
    }

    if (reconnectPlayerId && room.players[reconnectPlayerId]) {
      const player = room.players[reconnectPlayerId];
      if (!sessionToken || player.sessionToken !== sessionToken) {
        throw new GameError("重连身份不匹配。请使用自己的房间链接或重新加入。");
      }

      player.connected = true;
      player.reconnectUntil = undefined;
      if (name?.trim()) {
        player.name = sanitizeName(name, reconnectPlayerId);
        player.hasCustomName = true;
      }
      room.lastAction = `${player.name} 已重新连接。`;
      return {
        playerId: reconnectPlayerId,
        room,
        event: { type: "joined", roomId: room.roomId, playerId: reconnectPlayerId }
      };
    }

    if (room.players.P1 && !room.players.P2) {
      room.players.P2 = makePlayer("P2", name, this.random);
      room.phase = "rps";
      room.lastAction = "两位玩家已就位。请选择一种方式决定先手。";
      return {
        playerId: "P2",
        room,
        event: { type: "joined", roomId: room.roomId, playerId: "P2" }
      };
    }

    throw new GameError("房间已满。首版只支持两名玩家。");
  }

  private withPlayer(
    session: { roomId?: string; playerId?: PlayerId } | undefined,
    action: (room: Room, player: Player) => Room
  ): { playerId?: PlayerId; room?: Room; event: GameEvent } {
    const playerId = session?.playerId;
    const roomId = session?.roomId;

    if (!playerId) {
      throw new GameError("还没有加入房间。");
    }

    if (!roomId) {
      throw new GameError("当前连接没有有效的房间身份。");
    }

    const room = this.rooms.get(roomId);
    const player = room?.players[playerId];

    if (!room || !player) {
      throw new GameError("当前连接没有有效的房间身份。");
    }

    return {
      playerId,
      room: action(room, player),
      event: { type: "updated" }
    };
  }
}

export function publicState(room: Room, viewerId?: PlayerId): PublicRoomState {
  const players = orderedPlayers(room).map<PublicPlayerState>((player) => ({
    id: player.id,
    name: player.name,
    hasCustomName: player.hasCustomName,
    connected: player.connected,
    handCount: player.hand.length,
    hand: player.id === viewerId || room.phase === "finished" ? sortCards(player.hand) : undefined,
    rpsChoice: room.rps.choices[player.id]
  }));

  const reconnectUntil = players
    .map((player) => room.players[player.id]?.reconnectUntil)
    .find((value): value is number => value !== undefined);

  return {
    roomId: room.roomId,
    phase: room.phase,
    serverTime: Date.now(),
    you: viewerId,
    players,
    dealMode: room.dealMode,
    score: room.score,
    rematchReady: room.rematchReady,
    deckCount: room.deck.length,
    discardCount: room.discard.length,
    currentTurn: room.currentTurn,
    currentTrick: room.currentTrick,
    lastAction: room.lastAction,
    rps: sanitizedRps(room.rps, room.phase, viewerId),
    firstMove: sanitizedFirstMove(room.firstMove, room.phase, viewerId),
    parkingDraft: sanitizedParkingDraft(room.parkingDraft, viewerId),
    winner: room.winner,
    canDraw: canDrawNow(room),
    reconnectUntil
  };
}

export function chooseRps(room: Room, playerId: PlayerId, choice: RpsChoice, random: () => number = Math.random): void {
  assertPhase(room, "rps", "现在还不能猜拳。");
  assertPlayer(room, playerId);

  if (room.firstMove.mode !== "rps") {
    throw new GameError("当前先手方式不是猜拳。");
  }

  room.firstMove.rpsChoices[playerId] = choice;
  room.rps.choices[playerId] = choice;
  const opponent = opponentOf(playerId);

  if (!room.firstMove.rpsChoices[opponent]) {
    room.lastAction = `${room.players[playerId]?.name ?? playerId} 已亮出手势，等待对手。`;
    return;
  }

  const result = rpsWinner(room.firstMove.rpsChoices.P1 as RpsChoice, room.firstMove.rpsChoices.P2 as RpsChoice);
  if (result === 0) {
    const tieCount = room.firstMove.tieCount + 1;
    room.firstMove = { ...makeFirstMoveState("rps"), tieCount };
    room.rps = { choices: {}, tieCount };
    room.lastAction = "势均力敌，重新决定先手。";
    return;
  }

  const winner: PlayerId = result === 1 ? "P1" : "P2";
  room.firstMove.winner = winner;
  room.rps.winner = winner;
  startGameOrDraft(room, winner, random);
}

export function rollDice(room: Room, playerId: PlayerId, random: () => number = Math.random): void {
  assertPhase(room, "rps", "现在还不能摇骰。");
  assertPlayer(room, playerId);

  if (room.firstMove.mode !== "dice") {
    throw new GameError("当前先手方式不是摇骰。");
  }

  if (room.firstMove.diceRolls[playerId]) {
    throw new GameError("你已经摇过骰子了。");
  }

  room.firstMove.diceRolls[playerId] = 1 + Math.floor(random() * 6);
  const opponent = opponentOf(playerId);

  if (!room.firstMove.diceRolls[opponent]) {
    room.lastAction = `${room.players[playerId]?.name ?? playerId} 已掷出骰子，等待对手。`;
    return;
  }

  const p1Roll = room.firstMove.diceRolls.P1 as number;
  const p2Roll = room.firstMove.diceRolls.P2 as number;

  if (p1Roll === p2Roll) {
    room.firstMove = {
      ...makeFirstMoveState("dice"),
      tieCount: room.firstMove.tieCount + 1
    };
    room.lastAction = "骰子点数相同，再掷一次。";
    return;
  }

  const winner: PlayerId = p1Roll > p2Roll ? "P1" : "P2";
  room.firstMove.winner = winner;
  startGameOrDraft(room, winner, random);
}

export function toggleParkingCard(room: Room, playerId: PlayerId, cardId: string, now = Date.now()): void {
  assertPhase(room, "drafting", "现在还不能抢车位。");
  const draft = assertParkingDraft(room);
  if (now < draft.startedAt) {
    throw new GameError("揭晓过渡中，请稍候开始抢牌。");
  }
  const playerDraft = draft.players[playerId];

  if (playerDraft.finished) {
    throw new GameError("你已经完成选牌。");
  }

  if (now > draft.deadlineAt) {
    throw new GameError("抢车位选择时间已结束，只能点击完成。");
  }

  const card = playerDraft.pile?.find((candidate) => candidate.id === cardId);
  if (!card) {
    throw new GameError("这张牌不在你的车位里。");
  }

  const selectedIds = playerDraft.selectedIds ?? [];
  if (selectedIds.includes(cardId)) {
    playerDraft.selectedIds = selectedIds.filter((selectedId) => selectedId !== cardId);
  } else {
    playerDraft.selectedIds = [...selectedIds, cardId];
  }

  playerDraft.selectedCount = playerDraft.selectedIds.length;
  room.lastAction = `${room.players[playerId]?.name ?? playerId} 正在抢车位，已选 ${playerDraft.selectedCount} 张。`;
}

export function finishParkingDraft(
  room: Room,
  playerId: PlayerId,
  now = Date.now(),
  random: () => number = Math.random
): void {
  assertPhase(room, "drafting", "现在没有抢车位阶段。");
  assertPlayer(room, playerId);

  const draft = assertParkingDraft(room);
  if (now < draft.startedAt) {
    throw new GameError("揭晓过渡中，请稍候开始抢牌。");
  }
  finalizeParkingPlayer(room, playerId, now, false, random);

  const playerName = room.players[playerId]?.name ?? playerId;
  if (draft.players.P1.finished && draft.players.P2.finished) {
    enterPlayingAfterDraft(room);
    return;
  }

  room.lastAction = `${playerName} 已完成抢车位，等待对手。`;
}

export function autoFinishParkingDrafts(room: Room, now = Date.now(), random: () => number = Math.random): boolean {
  if (room.phase !== "drafting" || !room.parkingDraft || now < room.parkingDraft.autoFinishAt) {
    return false;
  }

  let changed = false;
  for (const player of orderedPlayers(room)) {
    if (room.parkingDraft.players[player.id].finished) {
      continue;
    }

    finalizeParkingPlayer(room, player.id, now, true, random);
    changed = true;
  }

  if (changed && room.parkingDraft.players.P1.finished && room.parkingDraft.players.P2.finished) {
    enterPlayingAfterDraft(room);
    return true;
  }

  if (changed) {
    room.lastAction = "超时玩家已由系统完成抢车位，等待另一位玩家。";
  }

  return changed;
}

export function playCards(room: Room, playerId: PlayerId, cardIds: string[]): void {
  assertPhase(room, "playing", "对局还没有开始。");
  assertTurn(room, playerId);

  const player = assertPlayer(room, playerId);
  const uniqueIds = [...new Set(cardIds)];

  if (uniqueIds.length !== cardIds.length) {
    throw new GameError("出牌里有重复牌。");
  }

  const selected = uniqueIds.map((cardId) => {
    const card = player.hand.find((candidate) => candidate.id === cardId);
    if (!card) {
      throw new GameError("你选择的牌不在当前手牌里。");
    }

    return card;
  });

  const playedSet = analyzeCards(selected);
  if (!playedSet) {
    throw new GameError("这个组合不能出。首版支持单张、对子、三张、三张及以上顺子、四张炸弹。");
  }

  if (!canBeat(playedSet, room.currentTrick)) {
    throw new GameError("这手牌管不上上一手。需要同牌型同张数，或用炸弹压非炸弹。");
  }

  player.hand = player.hand.filter((card) => !uniqueIds.includes(card.id));
  if (room.currentTrick) {
    room.discard.push(...room.currentTrick.cards);
  }

  room.currentTrick = playedSet;
  room.currentTrickOwner = playerId;
  room.currentTurn = opponentOf(playerId);
  room.lastAction = `${player.name} 出了 ${describePlayedSet(playedSet)}。`;

  if (room.deck.length === 0 && player.hand.length === 0) {
    finish(room, playerId, "emptyHand", `${player.name} 出完手牌，赢得本局。`);
  }
}

export function pass(room: Room, playerId: PlayerId): void {
  assertPhase(room, "playing", "对局还没有开始。");
  assertTurn(room, playerId);

  if (!room.currentTrick || !room.currentTrickOwner) {
    throw new GameError("你现在是主动出牌，不能 pass。");
  }

  const player = assertPlayer(room, playerId);
  const nextLeader = room.currentTrickOwner;
  const nextLeaderName = room.players[nextLeader]?.name ?? nextLeader;

  room.discard.push(...room.currentTrick.cards);
  room.currentTrick = undefined;
  room.currentTrickOwner = undefined;
  room.currentTurn = nextLeader;
  room.lastAction = `${player.name} pass。${nextLeaderName} 继续出牌。`;
}

export function drawToFive(room: Room, playerId: PlayerId): void {
  assertPhase(room, "playing", "对局还没有开始。");
  assertTurn(room, playerId);

  if (!canDrawNow(room)) {
    throw new GameError("现在不能补牌。需要你拥有出牌权、场上没有待管牌，且至少一方手牌不足 5。");
  }

  const actor = assertPlayer(room, playerId);
  const startId = room.currentTurn ?? playerId;
  let activeId: PlayerId = startId;
  let drewCards = 0;

  while (room.deck.length > 0 && orderedPlayers(room).some((player) => player.hand.length < HAND_TARGET_SIZE)) {
    const activePlayer = assertPlayer(room, activeId);
    if (activePlayer.hand.length < HAND_TARGET_SIZE) {
      const card = room.deck.shift();
      if (!card) {
        break;
      }
      activePlayer.hand.push(card);
      drewCards += 1;
    }
    activeId = opponentOf(activeId);
  }

  room.lastAction =
    drewCards > 0
      ? `${actor.name} 发起补牌，双方按回合顺序摸到 5 张或牌库见底。`
      : "牌库已经见底，不能再补牌。";
}

export function claimSpecialWin(room: Room, playerId: PlayerId): void {
  assertPhase(room, "playing", "对局还没有开始。");
  const player = assertPlayer(room, playerId);

  if (!hasSpecialWin(player.hand)) {
    throw new GameError("当前手牌还没有集齐 7、王、5、2、3。");
  }

  finish(room, playerId, "special", `${player.name} 集齐 7、王、5、2、3，赢得本局。`);
}

export function surrender(room: Room, playerId: PlayerId): void {
  assertPhase(room, "playing", "对局还没有开始。");
  const player = assertPlayer(room, playerId);
  const winner = opponentOf(playerId);
  const winnerName = room.players[winner]?.name ?? winner;
  finish(room, winner, "surrender", `${player.name} 认输，${winnerName} 赢得本局。`);
}

export function restartGame(room: Room, playerId: PlayerId, random: () => number): void {
  if (playerId !== "P1") {
    throw new GameError("只有房主可以重开。");
  }

  if (!room.players.P1 || !room.players.P2) {
    throw new GameError("需要两位玩家都在房间里才能重开。");
  }

  resetForFirstMove(room);

  void random;
}

export function readyForRematch(room: Room, playerId: PlayerId): void {
  assertPhase(room, "finished", "本局还没有结束。");
  assertPlayer(room, playerId);

  room.rematchReady[playerId] = true;

  if (room.rematchReady.P1 && room.rematchReady.P2) {
    resetForFirstMove(room);
    room.lastAction = "双方都选择再来一局。洗牌完成，重新决定先手。";
    return;
  }

  const playerName = room.players[playerId]?.name ?? playerId;
  room.lastAction = `${playerName} 已准备再来一局，等待对手。`;
}

export function startGame(room: Room, firstPlayer: PlayerId, random: () => number): void {
  room.deck = prepareDeck(random);
  room.discard = [];
  room.currentTurn = firstPlayer;
  room.currentTrick = undefined;
  room.currentTrickOwner = undefined;
  room.winner = undefined;
  room.parkingDraft = undefined;
  room.phase = "playing";

  for (const player of orderedPlayers(room)) {
    player.hand = [];
  }

  for (let count = 0; count < HAND_TARGET_SIZE; count += 1) {
    for (const player of orderedPlayers(room)) {
      const card = room.deck.shift();
      if (card) {
        player.hand.push(card);
      }
    }
  }

  const firstName = room.players[firstPlayer]?.name ?? firstPlayer;
  const firstMoveMethod = room.firstMove.mode === "dice" ? "摇骰胜出" : "猜拳胜出";
  room.lastAction = `${firstName} ${firstMoveMethod}，先手开始。`;
}

export function startParkingDraft(room: Room, firstPlayer: PlayerId, random: () => number, now = Date.now()): void {
  const deck = prepareDeck(random);
  const firstPileSize = Math.ceil(deck.length / 2);
  const firstPile = deck.slice(0, firstPileSize);
  const secondPile = deck.slice(firstPileSize);
  const secondPlayer = opponentOf(firstPlayer);

  room.deck = [];
  room.discard = [];
  room.currentTurn = undefined;
  room.currentTrick = undefined;
  room.currentTrickOwner = undefined;
  room.winner = undefined;
  room.phase = "drafting";

  for (const player of orderedPlayers(room)) {
    player.hand = [];
  }

  room.parkingDraft = {
    firstPlayer,
    startedAt: now + PARKING_REVEAL_MS,
    deadlineAt: now + PARKING_REVEAL_MS + PARKING_DRAFT_MS,
    autoFinishAt: now + PARKING_REVEAL_MS + PARKING_AUTO_FINISH_MS,
    players: {
      P1: makeParkingDraftPlayer(firstPlayer === "P1" ? firstPile : secondPile),
      P2: makeParkingDraftPlayer(firstPlayer === "P2" ? firstPile : secondPile)
    }
  };

  const firstName = room.players[firstPlayer]?.name ?? firstPlayer;
  const secondName = room.players[secondPlayer]?.name ?? secondPlayer;
  room.lastAction = `抢车位开始。${firstName} 先手，多看 1 张；${secondName} 同步选牌。`;
}

function prepareDeck(random: () => number): Card[] {
  const deck = shuffle(createDeck(), random);
  const removeCount = 8 + Math.floor(random() * 13);
  deck.splice(0, removeCount);
  return shuffle(deck, random);
}

function shuffle<T>(items: T[], random: () => number): T[] {
  const shuffled = [...items];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }
  return shuffled;
}

function canDrawNow(room: Room): boolean {
  return (
    room.phase === "playing" &&
    room.deck.length > 0 &&
    !room.currentTrick &&
    orderedPlayers(room).some((player) => player.hand.length < HAND_TARGET_SIZE)
  );
}

function startGameOrDraft(room: Room, firstPlayer: PlayerId, random: () => number): void {
  if (room.dealMode === "parking") {
    startParkingDraft(room, firstPlayer, random);
    return;
  }

  startGame(room, firstPlayer, random);
}

function makeParkingDraftPlayer(pile: Card[]): ParkingDraftState["players"][PlayerId] {
  return {
    pileCount: pile.length,
    selectedCount: 0,
    finished: false,
    autoFinished: false,
    penaltyCards: 0,
    pile,
    selectedIds: []
  };
}

function assertParkingDraft(room: Room): ParkingDraftState {
  if (!room.parkingDraft) {
    throw new GameError("抢车位阶段不存在。");
  }

  return room.parkingDraft;
}

function finalizeParkingPlayer(
  room: Room,
  playerId: PlayerId,
  now: number,
  autoFinished: boolean,
  random: () => number
): void {
  const draft = assertParkingDraft(room);
  const player = assertPlayer(room, playerId);
  const playerDraft = draft.players[playerId];

  if (playerDraft.finished) {
    return;
  }

  const pile = playerDraft.pile ?? [];
  const selectedIds = playerDraft.selectedIds ?? [];
  const keptIds = selectedIds.slice(0, HAND_TARGET_SIZE);
  const selectedCards = keptIds.map((cardId) => pile.find((card) => card.id === cardId)).filter((card): card is Card => Boolean(card));
  const selectedIdSet = new Set(selectedIds);
  const remainingCards = pile.filter((card) => !selectedIdSet.has(card.id));

  const penaltyCards = parkingPenaltyCards(now, draft.deadlineAt);
  const targetSize = HAND_TARGET_SIZE + penaltyCards;
  const neededCards = Math.max(0, targetSize - selectedCards.length);
  const extraCards = drawRandomCards(remainingCards, neededCards, random);

  player.hand = [...selectedCards, ...extraCards];
  playerDraft.pile = [];
  playerDraft.selectedIds = keptIds;
  playerDraft.pileCount = 0;
  playerDraft.selectedCount = keptIds.length;
  playerDraft.finished = true;
  playerDraft.autoFinished = autoFinished;
  playerDraft.penaltyCards = penaltyCards;
  playerDraft.finishedAt = now;
}

function parkingPenaltyCards(now: number, deadlineAt: number): number {
  const lateMs = Math.max(0, now - deadlineAt);
  if (lateMs <= 0) {
    return 0;
  }

  return Math.min(MAX_PARKING_PENALTY, Math.floor((lateMs - 1) / 1000) + 1);
}

function drawRandomCards(cards: Card[], count: number, random: () => number): Card[] {
  return shuffle(cards, random).slice(0, count);
}

function enterPlayingAfterDraft(room: Room): void {
  const draft = assertParkingDraft(room);
  const firstName = room.players[draft.firstPlayer]?.name ?? draft.firstPlayer;

  room.deck = [];
  room.discard = [];
  room.currentTurn = draft.firstPlayer;
  room.currentTrick = undefined;
  room.currentTrickOwner = undefined;
  room.phase = "playing";
  room.lastAction = `抢车位结束。${firstName} 先手开始。`;
}

function finish(room: Room, playerId: PlayerId, reason: WinnerState["reason"], lastAction: string): void {
  if (room.currentTrick && reason !== "emptyHand") {
    room.discard.push(...room.currentTrick.cards);
    room.currentTrick = undefined;
    room.currentTrickOwner = undefined;
  }

  room.score[playerId] += 1;
  room.rematchReady = {};
  room.phase = "finished";
  room.currentTurn = undefined;
  room.winner = { playerId, reason };
  room.lastAction = lastAction;
}

function assertPhase(room: Room, phase: Room["phase"], message: string): void {
  if (room.phase !== phase) {
    throw new GameError(message);
  }
}

function assertTurn(room: Room, playerId: PlayerId): void {
  if (room.currentTurn !== playerId) {
    throw new GameError("还没轮到你。");
  }
}

function assertPlayer(room: Room, playerId: PlayerId): Player {
  const player = room.players[playerId];
  if (!player) {
    throw new GameError("房间里没有这个玩家。");
  }

  return player;
}

function setDealMode(room: Room, playerId: PlayerId, mode: DealMode): void {
  assertPhase(room, "rps", "只有开局前可以切换玩法。");
  assertPlayer(room, playerId);

  if (playerId !== "P1") {
    throw new GameError("只有房主可以切换玩法。");
  }

  room.dealMode = mode;
  room.firstMove = makeFirstMoveState(room.firstMove.mode);
  room.rps = { choices: {}, tieCount: 0 };
  room.lastAction = mode === "parking" ? "玩法已切换为抢车位。重新决定先手后开始选牌。" : "玩法已切换为标准发牌。";
}

function setFirstMoveMode(room: Room, playerId: PlayerId, mode: FirstMoveMode): void {
  assertPhase(room, "rps", "对局开始后不能切换先手方式。");
  assertPlayer(room, playerId);

  room.firstMove = makeFirstMoveState(mode);
  room.rps = { choices: {}, tieCount: 0 };
  room.lastAction = mode === "rps" ? "先手方式已切换为猜拳。" : "先手方式已切换为摇骰。";
}

function makeFirstMoveState(mode: FirstMoveMode): FirstMoveState {
  return {
    mode,
    rpsChoices: {},
    diceRolls: {},
    tieCount: 0
  };
}

function makeScoreState(): ScoreState {
  return {
    P1: 0,
    P2: 0
  };
}

function resetForFirstMove(room: Room): void {
  const playerOne = assertPlayer(room, "P1");
  const playerTwo = assertPlayer(room, "P2");

  room.phase = "rps";
  room.deck = [];
  room.discard = [];
  playerOne.hand = [];
  playerTwo.hand = [];
  room.currentTurn = undefined;
  room.currentTrick = undefined;
  room.currentTrickOwner = undefined;
  room.parkingDraft = undefined;
  room.winner = undefined;
  room.rematchReady = {};
  room.rps = { choices: {}, tieCount: 0 };
  room.firstMove = makeFirstMoveState("rps");
  room.lastAction = "新一局已准备好。请选择一种方式决定先手。";
}

function orderedPlayers(room: Room): Player[] {
  return [room.players.P1, room.players.P2].filter((player): player is Player => Boolean(player));
}

function opponentOf(playerId: PlayerId): PlayerId {
  return playerId === "P1" ? "P2" : "P1";
}

function makePlayer(id: PlayerId, name: string | undefined, random: () => number): Player {
  const trimmedName = name?.trim();
  return {
    id,
    name: sanitizeName(trimmedName, id),
    hasCustomName: Boolean(trimmedName),
    sessionToken: createSessionToken(random),
    connected: true,
    hand: []
  };
}

function sanitizeName(name: string | undefined, fallback: PlayerId): string {
  const trimmed = name?.trim();
  if (!trimmed) {
    return fallback === "P1" ? "房主" : "对手";
  }

  return trimmed.slice(0, 18);
}

function createRoomId(random: () => number): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let roomId = "";

  for (let index = 0; index < 6; index += 1) {
    roomId += alphabet[Math.floor(random() * alphabet.length)];
  }

  return roomId;
}

function createSessionToken(random: () => number): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let token = "";

  for (let index = 0; index < 24; index += 1) {
    token += alphabet[Math.floor(random() * alphabet.length)];
  }

  return token;
}

function sanitizedRps(rps: RpsState, phase: Room["phase"], viewerId?: PlayerId): RpsState {
  if (phase !== "rps") {
    return rps;
  }

  return {
    choices: maskPendingRpsChoices(rps.choices, viewerId),
    winner: rps.winner,
    tieCount: rps.tieCount
  };
}

function sanitizedFirstMove(firstMove: FirstMoveState, phase: Room["phase"], viewerId?: PlayerId): FirstMoveState {
  if (phase !== "rps") {
    return firstMove;
  }

  return {
    mode: firstMove.mode,
    rpsChoices:
      firstMove.winner || Object.keys(firstMove.rpsChoices).length === 2
        ? firstMove.rpsChoices
        : maskPendingRpsChoices(firstMove.rpsChoices, viewerId),
    diceRolls: firstMove.diceRolls,
    winner: firstMove.winner,
    tieCount: firstMove.tieCount
  };
}

function sanitizedParkingDraft(draft: ParkingDraftState | undefined, viewerId?: PlayerId): ParkingDraftState | undefined {
  if (!draft) {
    return undefined;
  }

  return {
    firstPlayer: draft.firstPlayer,
    startedAt: draft.startedAt,
    deadlineAt: draft.deadlineAt,
    autoFinishAt: draft.autoFinishAt,
    players: {
      P1: sanitizedParkingDraftPlayer(draft.players.P1, viewerId === "P1"),
      P2: sanitizedParkingDraftPlayer(draft.players.P2, viewerId === "P2")
    }
  };
}

function sanitizedParkingDraftPlayer(
  playerDraft: ParkingDraftState["players"][PlayerId],
  isViewer: boolean
): ParkingDraftState["players"][PlayerId] {
  return {
    pileCount: playerDraft.pileCount,
    selectedCount: playerDraft.selectedCount,
    finished: playerDraft.finished,
    autoFinished: playerDraft.autoFinished,
    penaltyCards: playerDraft.penaltyCards,
    finishedAt: playerDraft.finishedAt,
    pile: isViewer && !playerDraft.finished ? playerDraft.pile : undefined,
    selectedIds: isViewer && !playerDraft.finished ? playerDraft.selectedIds : undefined
  };
}

function maskPendingRpsChoices(
  choices: Partial<Record<PlayerId, RpsChoice>>,
  viewerId?: PlayerId
): Partial<Record<PlayerId, RpsChoice>> {
  return Object.fromEntries(
    Object.entries(choices).map(([playerId, choice]) => [
      playerId,
      playerId === viewerId ? choice : choice ? "rock" : undefined
    ])
  ) as Partial<Record<PlayerId, RpsChoice>>;
}

function describePlayedSet(playedSet: PlayedSet): string {
  const labels: Record<PlayedSet["type"], string> = {
    single: "单张",
    pair: "对子",
    triple: "三张",
    straight: "顺子",
    bomb: "炸弹"
  };

  return `${labels[playedSet.type]} ${rankValueLabel(playedSet.rankValue)} x ${playedSet.length}`;
}

function rankValueLabel(value: RankValue): string {
  return value === "JOKER" ? "王" : value;
}

function assertNever(value: never): never {
  throw new GameError(`未知消息：${JSON.stringify(value)}`);
}
