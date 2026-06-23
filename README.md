# 七王五二三 Online MVP

双人房间链接对战版。服务端负责洗牌、发牌、规则校验和胜负判定；客户端只发送玩家意图。

## 项目结构

- `client`: React + Vite 前端，负责大厅、房间、牌桌交互、音效和 WebSocket 客户端连接。
- `server`: Node.js + `ws` 服务端，负责房间状态、洗牌发牌、回合推进、断线保留和胜负判定。
- `shared`: 前后端共享的牌型、排序、消息类型和规则函数。
- `server/test`: 服务端流程测试，覆盖建房、加入、先手、出牌、pass、补牌、断线和牌库删牌边界。
- `shared/test`: 纯规则测试，覆盖牌型识别、比较、炸弹、顺子和特殊胜利。
- `design-ethos.md`: 设计与工程判断标准，核心是诚实、可控、连贯、稳健和克制。
- `七王五二三-在线对战MVP计划.md`: MVP 范围、玩法规则、接口和验收计划。

## 当前功能

- 双人房间：创建房间、输入或 URL 自动读取房间号加入，同一房间最多两名玩家。
- 房间身份：本地保存 `playerId + sessionToken`，断线或返回大厅后短时间内可重连原身份。
- 决定先手：支持剪刀石头布和摇骰子，结果在双方完成选择后公开。
- 核心牌局：服务端洗牌、每局随机删除 `8-20` 张、双方各摸 5 张、按回合出牌。
- 牌型规则：支持单张、对子、三张、三张及以上顺子、四张炸弹；不支持三带一。
- 胜负规则：集齐 `7 + 王 + 5 + 2 + 3` 后由玩家手动宣告胜利；牌库见底后先出完手牌者胜利。
- 局分记录：双方都输入用户名时，顶部展示当前房间内两人的对局胜利总比分。
- 再来一局：游戏结束后双方都点击“再来一局”，才重新进入决定先手阶段，并展示短暂洗牌过场。
- 交互反馈：出牌、管牌、补牌、pass、宣告特殊胜利、开局和骰子都有不同音效。
- 牌桌体验：开始游戏后左侧房间信息降噪；右侧展示剩余牌堆大致比例，少于等于 7 张显示精确张数。

## 分支设定

- `feature/online-mvp`: 标准在线 MVP 分支。前端默认在本机 `5173` 启动，开发环境下自动连接同一 hostname 的 `8787` WebSocket；生产环境可通过 `VITE_WS_URL` 指定服务端地址。
- `feature/lan-play`: 局域网本地联机分支。包含 online MVP 的玩法功能，额外让服务端监听 `0.0.0.0`，客户端开发服务也对局域网开放，并提供 `npm run dev:lan` 语义脚本。
- 两个分支共用同一玩法规则：标准 54 张牌、每局随机删除 `8-20` 张、开局各 5 张、相同出牌与胜负判定。
- 当前差异只应集中在局域网可访问性和运行说明；玩法规则或状态机修复应同步到两个分支，避免同一游戏出现两套规则。
- 更详细的分支功能边界见 `BRANCHES.md`。

## 本地开发

```bash
npm install
npm run dev
```

默认地址：

- Client: `http://localhost:5173`
- Server: `ws://localhost:8787`
- LAN Client: `http://你的局域网 IP:5173`
- LAN Server: `ws://你的局域网 IP:8787`

打开两个浏览器窗口，创建房间后把链接复制到第二个窗口加入。

在 `feature/lan-play` 上，本地局域网联机使用：

```bash
npm run dev:lan
```

终端会显示 Vite 的 Network 地址和服务端 LAN WebSocket 地址。手机或另一台电脑打开 `http://主机局域网IP:5173`，客户端会自动连接同一台主机的 `8787` WebSocket 服务。

## Scripts

- `npm run dev`: 同时启动服务端和客户端。
- `npm run dev:lan`: 仅 `feature/lan-play` 提供，语义等同本地局域网联机开发。
- `npm run build`: 构建 shared、server、client。
- `npm run typecheck`: 对所有 workspace 运行 TypeScript 检查。
- `npm test`: 运行规则和服务端流程测试。

## 部署要点

- Node.js 版本需要 `>=20`。
- 构建顺序固定为 `shared -> server -> client`，直接运行 `npm run build` 即可。
- 服务端启动命令是 `npm run start --workspace server`，默认监听 `PORT=8787`。
- 前端生产构建输出在 `client/dist`，可放到任意静态资源服务。
- 如果前端和 WebSocket 不在同一 host/port，构建前设置 `VITE_WS_URL=wss://你的域名/ws` 或对应的 `ws://` 地址。
- 服务端当前只提供 WebSocket 和 `/health`，房间状态保存在内存里；服务重启会丢失正在进行的对局。

## 验收清单

- 规则或状态机改动后至少运行 `npm test`。
- 前后端类型或消息结构改动后运行 `npm run typecheck`。
- 准备部署或交付体验前运行 `npm run build`。
- 改到玩法规则时同步检查 `shared/test/rules.test.ts` 和 `server/test/game.test.ts`。
