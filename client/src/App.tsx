import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  BadgeCheck,
  Clipboard,
  Copy,
  Dices,
  DoorOpen,
  Hand,
  Home,
  Volume2,
  VolumeX,
  Play,
  RotateCcw,
  Scissors,
  ShieldAlert,
  Wifi,
  WifiOff
} from "lucide-react";
import {
  analyzeCards,
  cardLabel,
  rankLabel,
  type Card,
  type ClientMessage,
  type FirstMoveMode,
  type PlayerId,
  type PublicRoomState,
  type RpsChoice,
  type ServerMessage
} from "@seven-kings-523/shared";
import { playSound } from "./sound";

const PLAYER_KEY = "seven-kings-523-player";
const SOUND_KEY = "seven-kings-523-muted";

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
  const [isMuted, setIsMuted] = useState(() => localStorage.getItem(SOUND_KEY) === "true");
  const [showRematchTransition, setShowRematchTransition] = useState(false);
  const [showFirstMoveReveal, setShowFirstMoveReveal] = useState(false);
  const socketRef = useRef<WebSocket | null>(null);
  const previousStateRef = useRef<PublicRoomState | null>(null);
  const previousPhaseRef = useRef<PublicRoomState["phase"] | null>(null);
  const nameRef = useRef(name);

  const wsUrl = useMemo(() => websocketUrl(), []);

  useEffect(() => {
    nameRef.current = name;
  }, [name]);

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
          name: nameRef.current || undefined
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
  }, [wsUrl]);

  const you = state?.players.find((player) => player.id === state.you);
  const opponent = state?.players.find((player) => player.id !== state.you);
  const selectedCards = you?.hand?.filter((card) => selectedIds.includes(card.id)) ?? [];
  const selectedSet = analyzeCards(selectedCards);
  const isYourTurn = state?.phase === "playing" && state.currentTurn === state.you;
  const isEndgame = state?.phase === "playing" && state.deckCount <= 7;

  useEffect(() => {
    if (!copyStatus.startsWith("已复制")) {
      return;
    }

    const timeout = window.setTimeout(() => setCopyStatus("复制房间号"), 1400);
    return () => window.clearTimeout(timeout);
  }, [copyStatus]);

  useEffect(() => {
    if (state?.phase !== "playing" || !state.firstMove.winner) {
      setShowFirstMoveReveal(false);
      return;
    }

    setShowFirstMoveReveal(true);
    const timeout = window.setTimeout(() => setShowFirstMoveReveal(false), 10_000);
    return () => window.clearTimeout(timeout);
  }, [state?.firstMove.winner, state?.phase]);

  useEffect(() => {
    const previousPhase = previousPhaseRef.current;
    previousPhaseRef.current = state?.phase ?? null;

    if (previousPhase !== "finished" || state?.phase !== "rps") {
      return;
    }

    setShowRematchTransition(true);
    playSound("draw", isMuted, 4);

    const timeout = window.setTimeout(() => setShowRematchTransition(false), 1500);
    return () => window.clearTimeout(timeout);
  }, [isMuted, state?.phase]);

  useEffect(() => {
    if (!state || (state.phase !== "playing" && state.phase !== "finished")) {
      previousStateRef.current = state;
      return;
    }

    const previousState = previousStateRef.current;
    previousStateRef.current = state;

    if (!previousState || previousState.roomId !== state.roomId || previousState.you !== state.you) {
      return;
    }

    if (previousState.phase === "rps" && state.phase === "playing") {
      playSound("start", isMuted);
      return;
    }

    const currentPlayer = state.players.find((player) => player.id === state.you);
    const previousPlayer = previousState.players.find((player) => player.id === previousState.you);
    const handDelta = (currentPlayer?.handCount ?? 0) - (previousPlayer?.handCount ?? 0);

    if (state.winner?.reason === "special" && previousState.winner?.reason !== "special") {
      playSound("special", isMuted);
      return;
    }

    if (handDelta > 0) {
      playSound("draw", isMuted, handDelta);
      return;
    }

    const currentTrickIds = state.currentTrick?.cards.map((card) => card.id).join("|") ?? "";
    const previousTrickIds = previousState.currentTrick?.cards.map((card) => card.id).join("|") ?? "";

    if (currentTrickIds && currentTrickIds !== previousTrickIds) {
      playSound(previousState.currentTrick ? "beat" : "lead", isMuted);
      return;
    }

    if (state.phase === "playing" && previousState.currentTrick && !state.currentTrick) {
      playSound("pass", isMuted);
    }
  }, [isMuted, state]);

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
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(roomId);
      } else {
        fallbackCopyText(roomId);
      }
      setCopyStatus(`已复制 ${roomId}`);
    } catch {
      setError("浏览器没有允许复制。房间号就在标题和按钮里，可以手动复制。");
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
      const currentSelection = you?.hand?.filter((card) => selectedIds.includes(card.id)) ?? [];
      if (analyzeCards(currentSelection)) {
        playSound("button", isMuted);
        emit({ type: "playCards", cardIds: selectedIds });
        return;
      }

      setSelectedIds((current) => current.filter((selectedId) => selectedId !== cardId));
      return;
    }

    setSelectedIds((current) => [...current, cardId]);
  }

  return (
    <main className="app-shell">
      <section className="table-surface" aria-live="polite">
        <header className="topbar">
          <div className="topbar-title">
            <p className="eyebrow">七王五二三</p>
            <h1>{state ? `房间 ${state.roomId}` : "双人在线对战"}</h1>
          </div>
          {state && <Scoreboard state={state} />}
          <div className="topbar-actions">
            <button
              type="button"
              className="icon-button"
              aria-label={isMuted ? "打开音效" : "关闭音效"}
              title={isMuted ? "打开音效" : "关闭音效"}
              onClick={() => {
                const nextMuted = !isMuted;
                setIsMuted(nextMuted);
                localStorage.setItem(SOUND_KEY, String(nextMuted));
                playSound("button", nextMuted);
              }}
            >
              {isMuted ? <VolumeX size={17} /> : <Volume2 size={17} />}
            </button>
            <ConnectionPill connected={isConnected} />
          </div>
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
          <div className={`game-grid ${isEndgame ? "is-endgame" : ""}`}>
            <aside className="side-panel">
              <RoomPanel
                state={state}
                playerId={playerId}
                error={error}
                compact={state.phase === "playing"}
                copyStatus={copyStatus}
                onCopyRoomId={() => void copyRoomId(state.roomId)}
                onLeaveRoom={leaveRoom}
              />
            </aside>

            <section className="play-area">
              <OpponentPanel state={state} opponent={opponent} />
              {state.phase === "playing" && showFirstMoveReveal && <FirstMoveReveal state={state} />}
              <TrickPanel state={state} />

              {state.phase === "rps" && (
                <FirstMovePanel
                  state={state}
                  onModeChange={(mode) => {
                    playSound(mode === "dice" ? "dice" : "button", isMuted);
                    emit({ type: "setFirstMoveMode", mode });
                  }}
                  onChoose={(choice) => {
                    playSound("button", isMuted);
                    emit({ type: "chooseRps", choice });
                  }}
                  onRoll={() => {
                    playSound("dice", isMuted);
                    emit({ type: "rollDice" });
                  }}
                />
              )}

              {state.phase === "playing" && you?.hand && (
                <>
                  <DeckMeter deckCount={state.deckCount} endgame={isEndgame} />
                  <HandPanel
                    cards={you.hand}
                    selectedCards={selectedCards}
                    selectedIds={selectedIds}
                    selectedSetValid={Boolean(selectedSet)}
                    isYourTurn={isYourTurn}
                    canPass={Boolean(state.currentTrick) && isYourTurn}
                    canDraw={state.canDraw}
                    onCardClick={(cardId) => handleCardClick(cardId, isYourTurn)}
                    onPlay={() => {
                      playSound("button", isMuted);
                      emit({ type: "playCards", cardIds: selectedIds });
                    }}
                    onPass={() => {
                      playSound("button", isMuted);
                      emit({ type: "pass" });
                    }}
                    onDraw={() => {
                      playSound("button", isMuted);
                      emit({ type: "drawToFive" });
                    }}
                    onClaim={() => {
                      playSound("button", isMuted);
                      emit({ type: "claimSpecialWin" });
                    }}
                  />
                </>
              )}

              {state.phase === "finished" && (
                <ResultPanel
                  state={state}
                  onReady={() => {
                    playSound("button", isMuted);
                    emit({ type: "readyForRematch" });
                  }}
                />
              )}
            </section>
          </div>
        )}
        {showRematchTransition && <RematchTransition />}
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

function Scoreboard({ state }: { state: PublicRoomState }) {
  const [left, right] = state.players;

  if (!left?.hasCustomName || !right?.hasCustomName) {
    return null;
  }

  return (
    <div className="scoreboard" aria-label={`${left.name} 对 ${right.name} 总比分 ${state.score.P1} 比 ${state.score.P2}`}>
      <span>{left.name}</span>
      <strong>
        {state.score.P1}
        <span>:</span>
        {state.score.P2}
      </strong>
      <span>{right.name}</span>
    </div>
  );
}

interface RoomPanelProps {
  state: PublicRoomState;
  playerId?: PlayerId;
  error: string | null;
  compact: boolean;
  copyStatus: string;
  onCopyRoomId: () => void;
  onLeaveRoom: () => void;
}

function RoomPanel({ state, playerId, error, compact, copyStatus, onCopyRoomId, onLeaveRoom }: RoomPanelProps) {
  const winner = state.winner ? state.players.find((player) => player.id === state.winner?.playerId) : undefined;

  return (
    <div className={`panel-stack ${compact ? "is-compact" : ""}`}>
      <div className="info-panel collapsible-panel">
        <p className="panel-label">状态</p>
        <p className="last-action">{state.lastAction}</p>
        {error && <p className="error-line">{error}</p>}
      </div>

      <div className="info-panel collapsible-panel">
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
        <p className="muted-text">你是 {playerId ?? state.you ?? "未知"}。</p>
      </div>

      {winner && (
        <div className="info-panel result-mini">
          <BadgeCheck size={18} />
          <span>{winner.name} 已获胜</span>
        </div>
      )}

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

function FirstMoveReveal({ state }: { state: PublicRoomState }) {
  const winner = state.firstMove.winner ? state.players.find((player) => player.id === state.firstMove.winner) : undefined;

  if (!winner) {
    return null;
  }

  return (
    <div className="first-reveal">
      <span>{state.firstMove.mode === "dice" ? "骰声落定" : "手势揭晓"}</span>
      <strong>{winner.name} 先手</strong>
      {state.firstMove.mode === "dice" ? <DiceResultLine state={state} /> : <RpsResultLine state={state} />}
    </div>
  );
}

function RpsResultLine({ state }: { state: PublicRoomState }) {
  return (
    <span className="reveal-detail">
      {state.players
        .map((player) => {
          const choice = state.firstMove.rpsChoices[player.id];
          return `${player.name} ${choice ? rpsLabel(choice) : "?"}`;
        })
        .join(" / ")}
    </span>
  );
}

function DiceResultLine({ state }: { state: PublicRoomState }) {
  return (
    <span className="reveal-detail">
      {state.players
        .map((player) => `${player.name} ${state.firstMove.diceRolls[player.id] ?? "?"}`)
        .join(" / ")}
    </span>
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

function FirstMovePanel({
  state,
  onModeChange,
  onChoose,
  onRoll
}: {
  state: PublicRoomState;
  onModeChange: (mode: FirstMoveMode) => void;
  onChoose: (choice: RpsChoice) => void;
  onRoll: () => void;
}) {
  const youReady =
    state.firstMove.mode === "rps"
      ? Boolean(state.you && state.firstMove.rpsChoices[state.you])
      : Boolean(state.you && state.firstMove.diceRolls[state.you]);
  const opponent = state.players.find((player) => player.id !== state.you);

  return (
    <div className="first-move-panel">
      <div className="first-move-header">
        <div>
          <p className="panel-label">决定先手</p>
          <h2>{state.firstMove.mode === "rps" ? "剪刀石头布" : "命运骰盅"}</h2>
        </div>
        <div className="mode-switch" role="group" aria-label="选择先手方式">
          <button
            type="button"
            className={state.firstMove.mode === "rps" ? "is-selected-mode" : ""}
            onClick={() => onModeChange("rps")}
          >
            手势
          </button>
          <button
            type="button"
            className={state.firstMove.mode === "dice" ? "is-selected-mode" : ""}
            onClick={() => onModeChange("dice")}
          >
            骰子
          </button>
        </div>
      </div>

      {state.firstMove.mode === "rps" ? (
        <div className="rps-actions">
          <FirstMoveChoice
            icon={<ShieldAlert size={28} />}
            title="石头"
            subtitle="克剪刀"
            active={state.you ? state.firstMove.rpsChoices[state.you] === "rock" : false}
            onClick={() => onChoose("rock")}
          />
          <FirstMoveChoice
            icon={<Scissors size={28} />}
            title="剪刀"
            subtitle="克布"
            active={state.you ? state.firstMove.rpsChoices[state.you] === "scissors" : false}
            onClick={() => onChoose("scissors")}
          />
          <FirstMoveChoice
            icon={<Hand size={28} />}
            title="布"
            subtitle="克石头"
            active={state.you ? state.firstMove.rpsChoices[state.you] === "paper" : false}
            onClick={() => onChoose("paper")}
          />
        </div>
      ) : (
        <div className="dice-stage">
          <button type="button" className="dice-button" onClick={onRoll} disabled={youReady}>
            <Dices size={30} />
            掷出命运
          </button>
          <div className="dice-results">
            {state.players.map((player) => (
              <div key={player.id} className="dice-result">
                <span>{player.name}</span>
                <strong>{state.firstMove.diceRolls[player.id] ?? "?"}</strong>
              </div>
            ))}
          </div>
        </div>
      )}

      <FirstMoveResult state={state} opponentName={opponent?.name ?? "对手"} />
      <p className="muted-text">{youReady ? "你的选择已锁定，等待对手。" : "双方完成后立即开局。"}</p>
    </div>
  );
}

function FirstMoveChoice({
  icon,
  title,
  subtitle,
  active,
  onClick
}: {
  icon: ReactNode;
  title: string;
  subtitle: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button type="button" className={`rps-card ${active ? "is-active-choice" : ""}`} onClick={onClick}>
      <span className="rps-icon">{icon}</span>
      <strong>{title}</strong>
      <span>{subtitle}</span>
    </button>
  );
}

function FirstMoveResult({ state, opponentName }: { state: PublicRoomState; opponentName: string }) {
  if (state.firstMove.mode === "rps") {
    const choices = state.players.map((player) => ({
      player,
      choice: state.firstMove.rpsChoices[player.id]
    }));

    if (choices.every((item) => item.choice)) {
      return (
        <div className="first-result">
          {choices.map((item) => (
            <div key={item.player.id}>
              <span>{item.player.name}</span>
              <strong>{item.choice ? rpsLabel(item.choice) : "已锁定"}</strong>
            </div>
          ))}
        </div>
      );
    }
  }

  if (state.firstMove.winner) {
    const winner = state.players.find((player) => player.id === state.firstMove.winner);
    return <div className="first-result is-winner">{winner?.name ?? opponentName} 抢到先手</div>;
  }

  if (state.firstMove.tieCount > 0) {
    return <div className="first-result">不分胜负，再来一次</div>;
  }

  return null;
}

function DeckMeter({ deckCount, endgame }: { deckCount: number; endgame: boolean }) {
  const maxVisibleDeck = 44;
  const percent = Math.max(0, Math.min(100, Math.round((deckCount / maxVisibleDeck) * 100)));
  const label = deckCount <= 7 ? `剩 ${deckCount} 张` : `约 ${Math.max(20, Math.round(percent / 20) * 20)}%`;

  return (
    <div className={`deck-meter ${endgame ? "is-endgame" : ""}`} aria-label={`剩余牌堆 ${label}`}>
      <div className="deck-stack" style={{ ["--deck-fill" as string]: `${percent}%` }}>
        {Array.from({ length: 5 }).map((_, index) => (
          <span key={index} />
        ))}
      </div>
      <div>
        <p className="panel-label">{endgame ? "终局牌堆" : "牌堆"}</p>
        <strong>{label}</strong>
        {endgame && <span className="deck-warning">最终决战将至</span>}
      </div>
    </div>
  );
}

interface HandPanelProps {
  cards: Card[];
  selectedCards: Card[];
  selectedIds: string[];
  selectedSetValid: boolean;
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
          已选 {props.selectedCards.length} 张{props.selectedCards.length > 0 && !props.selectedSetValid ? " · 组合无效" : ""}
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

function ResultPanel({ state, onReady }: { state: PublicRoomState; onReady: () => void }) {
  const winner = state.players.find((player) => player.id === state.winner?.playerId);
  const isSpecialWin = state.winner?.reason === "special";
  const didYouWin = state.you === state.winner?.playerId;
  const youReady = Boolean(state.you && state.rematchReady[state.you]);

  return (
    <div className={`result-panel ${isSpecialWin ? "is-special-victory" : ""}`}>
      {isSpecialWin ? (
        <SpecialVictoryBanner winnerName={winner?.name ?? "胜者"} didYouWin={didYouWin} />
      ) : (
        <>
          <BadgeCheck size={32} />
          <h2>{winner?.name ?? "胜者"} 赢了</h2>
        </>
      )}
      <p>{state.lastAction}</p>
      <div className="rematch-readiness" aria-label="再来一局准备状态">
        {state.players.map((player) => (
          <span key={player.id} className={state.rematchReady[player.id] ? "is-ready" : ""}>
            {player.name}
            <strong>{state.rematchReady[player.id] ? "已准备" : "等待"}</strong>
          </span>
        ))}
      </div>
      <button type="button" className="primary-action" onClick={onReady} disabled={!state.you || youReady}>
        <RotateCcw size={18} />
        {youReady ? "等待对方" : "再来一局"}
      </button>
    </div>
  );
}

function SpecialVictoryBanner({ winnerName, didYouWin }: { winnerName: string; didYouWin: boolean }) {
  return (
    <div className="special-victory-banner">
      <div className="sigil-ring" aria-hidden="true">
        {["7", "王", "5", "2", "3"].map((label, index) => (
          <span key={label} style={{ ["--sigil-index" as string]: index }}>
            {label}
          </span>
        ))}
      </div>
      <div>
        <p className="panel-label">王者归位</p>
        <h2>{didYouWin ? "你完成了宣言" : `${winnerName} 完成了宣言`}</h2>
        <p className="muted-text">{didYouWin ? "五张牌落定，本局归你。" : "五张牌落定，本局归对手。"}</p>
      </div>
    </div>
  );
}

function RematchTransition() {
  return (
    <div className="rematch-transition" role="status" aria-live="assertive">
      <div className="shuffle-stack" aria-hidden="true">
        {Array.from({ length: 6 }).map((_, index) => (
          <span key={index} />
        ))}
      </div>
      <strong>洗牌中</strong>
      <span>抽去暗牌，重新决定先手。</span>
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

function fallbackCopyText(text: string) {
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "true");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  document.body.append(textarea);
  textarea.select();

  const copied = document.execCommand("copy");
  textarea.remove();

  if (!copied) {
    throw new Error("copy command failed");
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

function rpsLabel(choice: RpsChoice) {
  const labels: Record<RpsChoice, string> = {
    rock: "石头",
    scissors: "剪刀",
    paper: "布"
  };

  return labels[choice];
}
