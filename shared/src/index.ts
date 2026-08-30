export const SUITS = ["spades", "hearts", "clubs", "diamonds"] as const;
export const STANDARD_RANKS = ["A", "4", "6", "8", "9", "10", "J", "Q", "K", "3", "2", "5", "7"] as const;
export const JOKERS = ["small-joker", "big-joker"] as const;
export const RANK_ORDER = ["A", "4", "6", "8", "9", "10", "J", "Q", "K", "3", "2", "5", "JOKER", "7"] as const;
export const STRAIGHT_RANKS = ["A", "4", "6", "8", "9", "10", "J", "Q", "K"] as const;
export const HAND_TARGET_SIZE = 5;
export const ROOM_RECONNECT_MS = 90_000;

export type Suit = (typeof SUITS)[number];
export type StandardRank = (typeof STANDARD_RANKS)[number];
export type Joker = (typeof JOKERS)[number];
export type Rank = StandardRank | Joker;
export type RankValue = StandardRank | "JOKER";
export type PlayerId = "P1" | "P2";
export type RpsChoice = "rock" | "paper" | "scissors";
export type FirstMoveMode = "rps" | "dice";
export type DealMode = "standard" | "parking";
export type RoomPhase = "lobby" | "rps" | "drafting" | "playing" | "finished";
export type CardType = "single" | "pair" | "triple" | "straight" | "bomb";

export interface Card {
  id: string;
  rank: Rank;
  suit?: Suit;
}

export interface PlayedSet {
  type: CardType;
  rankValue: RankValue;
  length: number;
  cards: Card[];
}

export interface PublicPlayerState {
  id: PlayerId;
  name: string;
  hasCustomName: boolean;
  connected: boolean;
  handCount: number;
  hand?: Card[];
  rpsChoice?: RpsChoice;
}

export interface RpsState {
  choices: Partial<Record<PlayerId, RpsChoice>>;
  winner?: PlayerId;
  tieCount: number;
}

export interface FirstMoveState {
  mode: FirstMoveMode;
  rpsChoices: Partial<Record<PlayerId, RpsChoice>>;
  diceRolls: Partial<Record<PlayerId, number>>;
  winner?: PlayerId;
  tieCount: number;
}

export interface WinnerState {
  playerId: PlayerId;
  reason: "special" | "emptyHand" | "opponentLeft" | "surrender";
}

export interface ParkingDraftPlayerState {
  pileCount: number;
  selectedCount: number;
  finished: boolean;
  autoFinished: boolean;
  penaltyCards: number;
  finishedAt?: number;
  pile?: Card[];
  selectedIds?: string[];
}

export interface ParkingDraftState {
  firstPlayer: PlayerId;
  startedAt: number;
  deadlineAt: number;
  autoFinishAt: number;
  players: Record<PlayerId, ParkingDraftPlayerState>;
}

export type ScoreState = Record<PlayerId, number>;
export type RematchReadyState = Partial<Record<PlayerId, boolean>>;

export interface PublicRoomState {
  roomId: string;
  phase: RoomPhase;
  serverTime: number;
  you?: PlayerId;
  players: PublicPlayerState[];
  dealMode: DealMode;
  score: ScoreState;
  rematchReady: RematchReadyState;
  deckCount: number;
  discardCount: number;
  currentTurn?: PlayerId;
  currentTrick?: PlayedSet;
  lastAction: string;
  rps: RpsState;
  firstMove: FirstMoveState;
  parkingDraft?: ParkingDraftState;
  winner?: WinnerState;
  canDraw: boolean;
  reconnectUntil?: number;
}

export type ClientMessage =
  | { type: "createRoom"; name?: string }
  | { type: "joinRoom"; roomId: string; name?: string; playerId?: PlayerId; sessionToken?: string }
  | { type: "leaveRoom" }
  | { type: "setDealMode"; mode: DealMode }
  | { type: "setFirstMoveMode"; mode: FirstMoveMode }
  | { type: "chooseRps"; choice: RpsChoice }
  | { type: "rollDice" }
  | { type: "toggleParkingCard"; cardId: string }
  | { type: "finishParkingDraft" }
  | { type: "playCards"; cardIds: string[] }
  | { type: "pass" }
  | { type: "drawToFive" }
  | { type: "claimSpecialWin" }
  | { type: "surrender" }
  | { type: "readyForRematch" }
  | { type: "restartGame" };

export type ServerMessage =
  | { type: "roomState"; state: PublicRoomState }
  | { type: "roomCreated"; roomId: string; playerId: PlayerId; sessionToken: string }
  | { type: "joinedRoom"; roomId: string; playerId: PlayerId; sessionToken: string }
  | { type: "leftRoom" }
  | { type: "error"; message: string };

const rankScore = new Map<RankValue, number>(RANK_ORDER.map((rank, index) => [rank, index]));
const straightScore = new Map<StandardRank, number>(STRAIGHT_RANKS.map((rank, index) => [rank, index]));

export function createDeck(): Card[] {
  const cards: Card[] = [];

  for (const suit of SUITS) {
    for (const rank of STANDARD_RANKS) {
      cards.push({
        id: `${suit}-${rank}`,
        suit,
        rank
      });
    }
  }

  cards.push({ id: "joker-small", rank: "small-joker" });
  cards.push({ id: "joker-big", rank: "big-joker" });

  return cards;
}

export function rankValue(card: Card): RankValue {
  return card.rank === "small-joker" || card.rank === "big-joker" ? "JOKER" : card.rank;
}

export function rankLabel(cardOrRank: Card | RankValue): string {
  const value = typeof cardOrRank === "string" ? cardOrRank : rankValue(cardOrRank);
  return value === "JOKER" ? "王" : value;
}

export function cardLabel(card: Card): string {
  if (card.rank === "small-joker") {
    return "小王";
  }

  if (card.rank === "big-joker") {
    return "大王";
  }

  return card.rank;
}

export function sortCards(cards: Card[]): Card[] {
  return [...cards].sort((left, right) => {
    const rankDelta = getRankScore(rankValue(right)) - getRankScore(rankValue(left));
    if (rankDelta !== 0) {
      return rankDelta;
    }

    return left.id.localeCompare(right.id);
  });
}

export function analyzeCards(cards: Card[]): PlayedSet | null {
  if (cards.length === 0) {
    return null;
  }

  const values = cards.map(rankValue);
  const uniqueValues = new Set(values);

  if (cards.length === 1) {
    return {
      type: "single",
      rankValue: values[0],
      length: 1,
      cards: sortCards(cards)
    };
  }

  if (uniqueValues.size === 1) {
    const value = values[0];

    if (cards.length === 2) {
      return {
        type: "pair",
        rankValue: value,
        length: 2,
        cards: sortCards(cards)
      };
    }

    if (cards.length === 3) {
      return {
        type: "triple",
        rankValue: value,
        length: 3,
        cards: sortCards(cards)
      };
    }

    if (cards.length === 4 && value !== "JOKER") {
      return {
        type: "bomb",
        rankValue: value,
        length: 4,
        cards: sortCards(cards)
      };
    }
  }

  if (cards.length >= 3 && isStraight(values)) {
    const ordered = [...new Set(values)] as StandardRank[];
    ordered.sort((left, right) => getStraightScore(left) - getStraightScore(right));
    return {
      type: "straight",
      rankValue: ordered[ordered.length - 1],
      length: cards.length,
      cards: sortCards(cards)
    };
  }

  return null;
}

export function canBeat(candidate: PlayedSet, current?: PlayedSet): boolean {
  if (!current) {
    return true;
  }

  if (candidate.type === "bomb" && current.type !== "bomb") {
    return true;
  }

  if (candidate.type !== current.type || candidate.length !== current.length) {
    return false;
  }

  return getRankScore(candidate.rankValue) > getRankScore(current.rankValue);
}

export function hasSpecialWin(cards: Card[]): boolean {
  const values = new Set(cards.map(rankValue));
  return values.has("7") && values.has("JOKER") && values.has("5") && values.has("2") && values.has("3");
}

export function rpsWinner(left: RpsChoice, right: RpsChoice): 0 | 1 | 2 {
  if (left === right) {
    return 0;
  }

  if (
    (left === "rock" && right === "scissors") ||
    (left === "scissors" && right === "paper") ||
    (left === "paper" && right === "rock")
  ) {
    return 1;
  }

  return 2;
}

export function getRankScore(value: RankValue): number {
  const score = rankScore.get(value);
  if (score === undefined) {
    throw new Error(`Unknown rank value: ${value}`);
  }

  return score;
}

function getStraightScore(value: StandardRank): number {
  const score = straightScore.get(value);
  if (score === undefined) {
    throw new Error(`Rank cannot be used in straight: ${value}`);
  }

  return score;
}

function isStraight(values: RankValue[]): values is StandardRank[] {
  if (new Set(values).size !== values.length) {
    return false;
  }

  if (!values.every((value): value is StandardRank => straightScore.has(value as StandardRank))) {
    return false;
  }

  const scores = values.map((value) => getStraightScore(value)).sort((left, right) => left - right);
  return scores.every((score, index) => index === 0 || score === scores[index - 1] + 1);
}
