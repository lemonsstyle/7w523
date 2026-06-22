# 七王五二三 Online MVP

双人房间链接对战版。服务端负责洗牌、发牌、规则校验和胜负判定；客户端只发送玩家意图。

## Local Development

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

局域网设备联机时，先在主机运行 `npm run dev:lan`，终端会显示 Vite 的 `Network` 地址和服务端 `LAN WebSocket` 地址。手机或另一台电脑打开 `http://主机局域网IP:5173` 即可；客户端会自动连接同一台主机的 `8787` WebSocket 服务。

## Scripts

- `npm run dev`: 同时启动服务端和客户端。
- `npm run dev:lan`: 同 `npm run dev`，用于语义明确的局域网本地联机。
- `npm run build`: 构建 shared、server、client。
- `npm test`: 运行规则和服务端流程测试。
