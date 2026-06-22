import { useEffect, useMemo, useRef, useState } from "react";
import {
  BadgeCheck,
  Clipboard,
  Copy,
  DoorOpen,
  Hand,
  Home,
  Play,
  RotateCcw,
  Scissors,
  ShieldAlert,
  Wifi,
  WifiOff
} from "lucide-react";
import {
  cardLabel,
  rankLabel,
  type Card,
  type ClientMessage,
  type PlayerId,
  type PublicRoomState,
  type RpsChoice,
  type ServerMessage
} from "@seven-kings-523/shared";

const PLAYER_KEY = "seven-kings-523-player";

export function App() {
  const [name, setName] = useState(() => localStorage.getItem("seven-kings-523-name") ?? "");
  const [roomIdInput, setRoomIdInput] = useState(() => new URLSearchParams(window.location.search).get("room") ?? "");
  const [state, setState] = useState<PublicRoomState | null>(null);
  const [playerId, setPlayerId] = useState<PlayerId | undefined>(() => readStoredPlayer().playerId);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [status, setStatus] = useState("正在连接服务端...");
  const [error, setError] = useState<string | null>(null);
  const [copyStatus, setCopyStatus] = useState("复制房间号");
  const [isConnected, setIsConnected] = useState(false);
  const socketRef = useRef<WebSocket | null>(null);

  const wsUrl = useMemo(() => websocketUrl(), []);

  useEffect(() => {
    const socket = new WebSocket(wsUrl);
    socketRef.current = socket;

    socket.addEventListener("open", () => {
      setIsConnected(true);
      setStatus("已连接。创建房间，或用链接加入已有房间。");

      const stored = readStoredPlayer();
      const roomFromUrl = new URLSearchParams(window.location.search).get("room");
      if (roomFromUrl && stored.playerId) {
        send(socket, {
          type: "joinRoom",
          roomId: roomFromUrl,
          playerId: stored.playerId,
          sessionToken: stored.sessionToken,
          name: name || undefined
        });
      }
    });

    socket.addEventListener("close", () => {
      setIsConnected(false);
      setStatus("连接已断开。刷新页面可以尝试重连。");
    });

    socket.addEventListener("error", () => {
      setError("无法连接服务端。请确认 server 已启动。");
    });

    socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data as string) as ServerMessage;

      if (message.type === "error") {
        setError(message.message);
        return;
      }

      if (message.type === "leftRoom") {
        localStorage.removeItem(PLAYER_KEY);
        setState(null);
        setPlayerId(undefined);
        setSelectedIds([]);
        setError(null);
        setRoomIdInput("");
        setCopyStatus("复制房间号");
        setStatus("已返回大厅。可以创建房间，或输入房间号加入。");
        window.history.replaceState(null, "", window.location.pathname);
        return;
      }

      if (message.type === "roomCreated" || message.type === "joinedRoom") {
        setPlayerId(message.playerId);
        localStorage.setItem(
          PLAYER_KEY,
          JSON.stringify({ roomId: message.roomId, playerId: message.playerId, sessionToken: message.sessionToken })
        );
        setRoomIdInput(message.roomId);
        window.history.replaceState(null, "", `?room=${message.roomId}`);
        return;
      }

      setError(null);
      setState(message.state);
      setSelectedIds([]);
    });

    return () => {
      socket.close();
    };
  }, [name, wsUrl]);

  const you = state?.players.find((player) => player.id === state.you);
  const opponent = state?.players.find((player) => player.id !== state.you);
  const selectedCards = you?.hand?.filter((card) => selectedIds.includes(card.id)) ?? [];
  const isYourTurn = state?.phase === "playing" && state.currentTurn === state.you;

  useEffect(() => {
    if (!copyStatus.startsWith("已复制")) {
      return;
    }

    const timeout = window.setTimeout(() => setCopyStatus("复制房间号"), 1400);
    return () => window.clearTimeout(timeout);
  }, [copyStatus]);

  function emit(message: ClientMessage) {
    if (!socketRef.current || socketRef.current.readyState !== WebSocket.OPEN) {
      setError("服务端没有连接上，操作没有发送。");
      return;
    }

    socketRef.current.send(JSON.stringify(message));
  }

  function createRoom() {
    persistName(name);
    emit({ type: "createRoom", name: name || undefined });
  }

  function joinRoom() {
    persistName(name);
    const normalizedRoomId = roomIdInput.trim().toUpperCase();
    const stored = readStoredPlayer();
    emit({
      type: "joinRoom",
      roomId: normalizedRoomId,
      name: name || undefined,
      playerId: stored.roomId === normalizedRoomId ? stored.playerId : undefined,
      sessionToken: stored.roomId === normalizedRoomId ? stored.sessionToken : undefined
    });
  }

  async function copyRoomId(roomId: string) {
    try {
      await navigator.clipboard.writeText(roomId);
      setCopyStatus(`已复制 ${roomId}`);
    } catch {
      setError("浏览器没有允许复制。房间号就在标题里，可以手动复制。");
    }
  }

  function leaveRoom() {
    emit({ type: "leaveRoom" });
  }

  function handleCardClick(cardId: string, isYourTurnNow: boolean) {
    if (!isYourTurnNow) {
      setError("还没轮到你。");
      return;
    }

    if (selectedIds.includes(cardId)) {
      emit({ type: "playCards", cardIds: selectedIds });
      return;
    }

    setSelectedIds((current) => [...current, cardId]);
  }

  return (
    <main className="app-shell">
      <section className="table-surface" aria-live="polite">
        <header className="topbar">
          <div>
            <p className="eyebrow">七王五二三</p>
            <h1>{state ? `房间 ${state.roomId}` : "双人在线对战"}</h1>
          </div>
          <ConnectionPill connected={isConnected} />
        </header>

        {!state ? (
          <EntryPanel
            name={name}
            roomId={roomIdInput}
            status={status}
            error={error}
            onNameChange={setName}
            onRoomIdChange={setRoomIdInput}
            onCreate={createRoom}
            onJoin={joinRoom}
          />
        ) : (
          <div className="game-grid">
            <aside className="side-panel">
              <RoomPanel
                state={state}
                playerId={playerId}
                error={error}
                copyStatus={copyStatus}
                onCopyRoomId={() => void copyRoomId(state.roomId)}
                onLeaveRoom={leaveRoom}
                onRestart={() => emit({ type: "restartGame" })}
              />
            </aside>

            <section className="play-area">
              <OpponentPanel state={state} opponent={opponent} />
              <TrickPanel state={state} />

              {state.phase === "rps" && (
                <RpsPanel
                  youReady={Boolean(state.you && state.rps.choices[state.you])}
                  onChoose={(choice) => emit({ type: "chooseRps", choice })}
                />
              )}

              {state.phase === "playing" && you?.hand && (
                <HandPanel
                  cards={you.hand}
                  selectedCards={selectedCards}
                  selectedIds={selectedIds}
                  isYourTurn={isYourTurn}
                  canPass={Boolean(state.currentTrick) && isYourTurn}
                  canDraw={state.canDraw}
                  onCardClick={(cardId) => handleCardClick(cardId, isYourTurn)}
                  onPlay={() => emit({ type: "playCards", cardIds: selectedIds })}
                  onPass={() => emit({ type: "pass" })}
                  onDraw={() => emit({ type: "drawToFive" })}
                  onClaim={() => emit({ type: "claimSpecialWin" })}
                />
              )}

              {state.phase === "finished" && (
                <ResultPanel state={state} onRestart={() => emit({ type: "restartGame" })} />
              )}
            </section>
          </div>
        )}
      </section>
    </main>
  );
}

interface EntryPanelProps {
  name: string;
  roomId: string;
  status: string;
  error: string | null;
  onNameChange: (value: string) => void;
  onRoomIdChange: (value: string) => void;
  onCreate: () => void;
  onJoin: () => void;
}

function EntryPanel(props: EntryPanelProps) {
  return (
    <div className="entry-layout">
      <div className="entry-copy">
        <p className="status-line">{props.status}</p>
        <p>创建房间后，把链接发给第二位玩家。两人到齐就猜拳开局。</p>
        {props.error && <p className="error-line">{props.error}</p>}
      </div>
      <form
        className="entry-form"
        onSubmit={(event) => {
          event.preventDefault();
          props.roomId.trim() ? props.onJoin() : props.onCreate();
        }}
      >
        <label>
          昵称
          <input
            value={props.name}
            maxLength={18}
            placeholder="可留空"
            onChange={(event) => props.onNameChange(event.target.value)}
          />
        </label>
        <label>
          房间号
          <input
            value={props.roomId}
            maxLength={6}
            placeholder="有链接会自动填入"
            onChange={(event) => props.onRoomIdChange(event.target.value.toUpperCase())}
          />
        </label>
        <div className="button-row">
          <button type="button" className="primary-action" onClick={props.onCreate}>
            <Play size={18} />
            创建房间
          </button>
          <button type="button" onClick={props.onJoin} disabled={!props.roomId.trim()}>
            <DoorOpen size={18} />
            加入房间
          </button>
        </div>
      </form>
    </div>
  );
}

function ConnectionPill({ connected }: { connected: boolean }) {
  return (
    <div className={`connection-pill ${connected ? "is-online" : "is-offline"}`}>
      {connected ? <Wifi size={16} /> : <WifiOff size={16} />}
      {connected ? "在线" : "离线"}
    </div>
  );
}

interface RoomPanelProps {
  state: PublicRoomState;
  playerId?: PlayerId;
  error: string | null;
  copyStatus: string;
  onCopyRoomId: () => void;
  onLeaveRoom: () => void;
  onRestart: () => void;
}

function RoomPanel({ state, playerId, error, copyStatus, onCopyRoomId, onLeaveRoom, onRestart }: RoomPanelProps) {
  const winner = state.winner ? state.players.find((player) => player.id === state.winner?.playerId) : undefined;

  return (
    <div className="panel-stack">
      <div className="info-panel">
        <p className="panel-label">状态</p>
        <p className="last-action">{state.lastAction}</p>
        {error && <p className="error-line">{error}</p>}
      </div>

      <div className="info-panel">
        <p className="panel-label">玩家</p>
        <div className="player-list">
          {state.players.map((player) => (
            <div key={player.id} className="player-row">
              <span>{player.name}</span>
              <span>{player.connected ? "在线" : "断线"}</span>
              <span>{player.handCount} 张</span>
            </div>
          ))}
        </div>
      </div>

      <div className="info-panel">
        <p className="panel-label">房间号</p>
        <button
          type="button"
          className="copy-button"
          onClick={onCopyRoomId}
        >
          <Copy size={16} />
          {copyStatus}
        </button>
        <p className="muted-text">你是 {playerId ?? state.you ?? "未知"}。牌库 {state.deckCount} 张，弃牌 {state.discardCount} 张。</p>
      </div>

      {winner && (
        <div className="info-panel result-mini">
          <BadgeCheck size={18} />
          <span>{winner.name} 已获胜</span>
        </div>
      )}

      <button type="button" onClick={onRestart} disabled={state.phase !== "finished" || state.you !== "P1"}>
        <RotateCcw size={18} />
        房主重开
      </button>
      <button type="button" onClick={onLeaveRoom}>
        <Home size={18} />
        返回大厅
      </button>
    </div>
  );
}

function OpponentPanel({
  state,
  opponent
}: {
  state: PublicRoomState;
  opponent?: PublicRoomState["players"][number];
}) {
  return (
    <div className="opponent-band">
      <div>
        <p className="panel-label">对手</p>
        <h2>{opponent?.name ?? "等待加入"}</h2>
      </div>
      <div className="card-back-row" aria-label={`对手手牌 ${opponent?.handCount ?? 0} 张`}>
        {Array.from({ length: opponent?.handCount ?? 0 }).map((_, index) => (
          <div key={index} className="card-back">
            523
          </div>
        ))}
      </div>
      <TurnBadge active={state.currentTurn === opponent?.id} />
    </div>
  );
}

function TrickPanel({ state }: { state: PublicRoomState }) {
  return (
    <div className="trick-zone">
      <div className="trick-header">
        <p className="panel-label">场上待管</p>
        <span>{state.currentTrick ? `${typeLabel(state.currentTrick.type)} ${rankLabel(state.currentTrick.rankValue)}` : "空场"}</span>
      </div>
      <div className="played-cards">
        {state.currentTrick ? (
          state.currentTrick.cards.map((card) => <PlayingCard key={card.id} card={card} selected={false} disabled />)
        ) : (
          <div className="empty-trick">
            <Clipboard size={24} />
            <span>主动出牌者可以自由开牌。</span>
          </div>
        )}
      </div>
    </div>
  );
}

function RpsPanel({
  youReady,
  onChoose
}: {
  youReady: boolean;
  onChoose: (choice: RpsChoice) => void;
}) {
  return (
    <div className="rps-panel">
      <p className="panel-label">猜拳</p>
      <div className="rps-actions">
        <button type="button" onClick={() => onChoose("rock")}>
          <ShieldAlert size={18} />
          石头
        </button>
        <button type="button" onClick={() => onChoose("scissors")}>
          <Scissors size={18} />
          剪刀
        </button>
        <button type="button" onClick={() => onChoose("paper")}>
          <Hand size={18} />
          布
        </button>
      </div>
      <p className="muted-text">{youReady ? "已选择，等待对手。" : "两人都选择后立即开局。"}</p>
    </div>
  );
}

interface HandPanelProps {
  cards: Card[];
  selectedCards: Card[];
  selectedIds: string[];
  isYourTurn: boolean;
  canPass: boolean;
  canDraw: boolean;
  onCardClick: (cardId: string) => void;
  onPlay: () => void;
  onPass: () => void;
  onDraw: () => void;
  onClaim: () => void;
}

function HandPanel(props: HandPanelProps) {
  return (
    <div className="hand-zone">
      <div className="hand-header">
        <div>
          <p className="panel-label">你的手牌</p>
          <h2>{props.isYourTurn ? "轮到你" : "等待对手"}</h2>
        </div>
        <TurnBadge active={props.isYourTurn} />
      </div>

      <div className="hand-cards">
        {props.cards.map((card) => (
          <PlayingCard
            key={card.id}
            card={card}
            selected={props.selectedIds.includes(card.id)}
            onClick={() => props.onCardClick(card.id)}
          />
        ))}
      </div>

      <div className="action-bar">
        <span className="selection-summary">
          已选 {props.selectedCards.length} 张
        </span>
        <button type="button" className="primary-action" onClick={props.onPlay} disabled={!props.isYourTurn || props.selectedIds.length === 0}>
          出牌
        </button>
        <button type="button" onClick={props.onPass} disabled={!props.canPass}>
          Pass
        </button>
        <button type="button" onClick={props.onDraw} disabled={!props.canDraw}>
          补到 5 张
        </button>
        <button type="button" onClick={props.onClaim}>
          王座归位
        </button>
      </div>
    </div>
  );
}

function ResultPanel({ state, onRestart }: { state: PublicRoomState; onRestart: () => void }) {
  const winner = state.players.find((player) => player.id === state.winner?.playerId);

  return (
    <div className="result-panel">
      <BadgeCheck size={32} />
      <h2>{winner?.name ?? "胜者"} 赢了</h2>
      <p>{state.lastAction}</p>
      <button type="button" className="primary-action" onClick={onRestart} disabled={state.you !== "P1"}>
        <RotateCcw size={18} />
        再来一局
      </button>
    </div>
  );
}

function PlayingCard({
  card,
  selected,
  disabled = false,
  onClick
}: {
  card: Card;
  selected: boolean;
  disabled?: boolean;
  onClick?: () => void;
}) {
  const isJoker = card.rank === "small-joker" || card.rank === "big-joker";
  const isRed = card.suit === "hearts" || card.rank === "big-joker";

  return (
    <button
      type="button"
      className={`playing-card ${selected ? "is-selected" : ""} ${isRed ? "is-red" : ""} ${isJoker ? "is-joker" : ""}`}
      onClick={onClick}
      disabled={disabled}
      aria-pressed={selected}
    >
      <span className="card-rank">{cardLabel(card)}</span>
      <span className="card-suit">{suitLabel(card)}</span>
    </button>
  );
}

function TurnBadge({ active }: { active: boolean }) {
  return <span className={`turn-badge ${active ? "is-active" : ""}`}>{active ? "行动中" : "等待"}</span>;
}

function send(socket: WebSocket, message: ClientMessage) {
  socket.send(JSON.stringify(message));
}

function websocketUrl() {
  const configured = import.meta.env.VITE_WS_URL as string | undefined;
  if (configured) {
    return configured;
  }

  const protocol = window.location.protocol === "https:" ? "wss" : "ws";
  const host = window.location.hostname;
  const serverPort = import.meta.env.DEV ? "8787" : window.location.port;
  return `${protocol}://${host}${serverPort ? `:${serverPort}` : ""}`;
}

function persistName(name: string) {
  localStorage.setItem("seven-kings-523-name", name);
}

function readStoredPlayer(): { roomId?: string; playerId?: PlayerId; sessionToken?: string } {
  try {
    return JSON.parse(localStorage.getItem(PLAYER_KEY) ?? "{}") as {
      roomId?: string;
      playerId?: PlayerId;
      sessionToken?: string;
    };
  } catch {
    return {};
  }
}

function suitLabel(card: Card) {
  if (card.rank === "small-joker") {
    return "S";
  }

  if (card.rank === "big-joker") {
    return "B";
  }

  const labels: Record<NonNullable<Card["suit"]>, string> = {
    spades: "S",
    hearts: "H",
    clubs: "C",
    diamonds: "D"
  };

  return card.suit ? labels[card.suit] : "";
}

function typeLabel(type: NonNullable<PublicRoomState["currentTrick"]>["type"]) {
  const labels = {
    single: "单张",
    pair: "对子",
    triple: "三张",
    straight: "顺子",
    bomb: "炸弹"
  };

  return labels[type];
}
