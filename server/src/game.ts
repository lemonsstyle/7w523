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
  type FirstMoveMode,
  type FirstMoveState,
  type PlayedSet,
  type PlayerId,
  type PublicPlayerState,
  type PublicRoomState,
  type RankValue,
  type RpsChoice,
  type RpsState,
  type WinnerState
} from "@seven-kings-523/shared";

export interface Player {
  id: PlayerId;
  name: string;
  sessionToken: string;
  connected: boolean;
  hand: Card[];
  reconnectUntil?: number;
}

export interface Room {
  roomId: string;
  phase: PublicRoomState["phase"];
  players: Partial<Record<PlayerId, Player>>;
  deck: Card[];
  discard: Card[];
  currentTurn?: PlayerId;
  currentTrick?: PlayedSet;
  currentTrickOwner?: PlayerId;
  lastAction: string;
  rps: RpsState;
  firstMove: FirstMoveState;
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
      room.currentTurn = undefined;
      room.lastAction = `${expiredPlayer.name} 未能及时重连，对局结束。`;
      changed.push(room);
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
      deck: [],
      discard: [],
      lastAction: "房间已创建，等待第二位玩家加入。",
      rps: { choices: {}, tieCount: 0 },
      firstMove: makeFirstMoveState("rps")
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
    connected: player.connected,
    handCount: player.hand.length,
    hand: player.id === viewerId ? sortCards(player.hand) : undefined,
    rpsChoice: room.rps.choices[player.id]
  }));

  const reconnectUntil = players
    .map((player) => room.players[player.id]?.reconnectUntil)
    .find((value): value is number => value !== undefined);

  return {
    roomId: room.roomId,
    phase: room.phase,
    you: viewerId,
    players,
    deckCount: room.deck.length,
    discardCount: room.discard.length,
    currentTurn: room.currentTurn,
    currentTrick: room.currentTrick,
    lastAction: room.lastAction,
    rps: sanitizedRps(room.rps, room.phase, viewerId),
    firstMove: sanitizedFirstMove(room.firstMove, room.phase, viewerId),
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
  startGame(room, winner, random);
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
  startGame(room, winner, random);
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

  if (!canDrawNow(room)) {
    throw new GameError("现在不能补牌。需要场上没有待管牌，且至少一方手牌不足 5。");
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

  checkAutomaticSpecialWin(room);
}

export function claimSpecialWin(room: Room, playerId: PlayerId): void {
  assertPhase(room, "playing", "对局还没有开始。");
  const player = assertPlayer(room, playerId);

  if (!hasSpecialWin(player.hand)) {
    throw new GameError("当前手牌还没有集齐 7、王、5、2、3。");
  }

  finish(room, playerId, "special", `${player.name} 集齐 7、王、5、2、3，赢得本局。`);
}

export function restartGame(room: Room, playerId: PlayerId, random: () => number): void {
  if (playerId !== "P1") {
    throw new GameError("只有房主可以重开。");
  }

  if (!room.players.P1 || !room.players.P2) {
    throw new GameError("需要两位玩家都在房间里才能重开。");
  }

  room.phase = "rps";
  room.deck = [];
  room.discard = [];
  room.players.P1.hand = [];
  room.players.P2.hand = [];
  room.currentTurn = undefined;
  room.currentTrick = undefined;
  room.currentTrickOwner = undefined;
  room.winner = undefined;
  room.rps = { choices: {}, tieCount: 0 };
  room.firstMove = makeFirstMoveState("rps");
  room.lastAction = "新一局已准备好。请选择一种方式决定先手。";

  void random;
}

export function startGame(room: Room, firstPlayer: PlayerId, random: () => number): void {
  room.deck = prepareDeck(random);
  room.discard = [];
  room.currentTurn = firstPlayer;
  room.currentTrick = undefined;
  room.currentTrickOwner = undefined;
  room.winner = undefined;
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
  checkAutomaticSpecialWin(room);
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

function checkAutomaticSpecialWin(room: Room): void {
  for (const player of orderedPlayers(room)) {
    if (hasSpecialWin(player.hand)) {
      finish(room, player.id, "special", `${player.name} 集齐 7、王、5、2、3，赢得本局。`);
      return;
    }
  }
}

function finish(room: Room, playerId: PlayerId, reason: WinnerState["reason"], lastAction: string): void {
  if (room.currentTrick) {
    room.discard.push(...room.currentTrick.cards);
  }

  room.phase = "finished";
  room.currentTurn = undefined;
  room.currentTrick = undefined;
  room.currentTrickOwner = undefined;
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

function orderedPlayers(room: Room): Player[] {
  return [room.players.P1, room.players.P2].filter((player): player is Player => Boolean(player));
}

function opponentOf(playerId: PlayerId): PlayerId {
  return playerId === "P1" ? "P2" : "P1";
}

function makePlayer(id: PlayerId, name: string | undefined, random: () => number): Player {
  return {
    id,
    name: sanitizeName(name, id),
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
