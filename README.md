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

打开两个浏览器窗口，创建房间后把链接复制到第二个窗口加入。

## Scripts

- `npm run dev`: 同时启动服务端和客户端。
- `npm run build`: 构建 shared、server、client。
- `npm test`: 运行规则和服务端流程测试。
