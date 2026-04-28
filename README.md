# CUA_Feishu

**专为飞书（Lark/Feishu）开发的 Computer-Use Agent**

基于 [UI-TARS-desktop](https://github.com/bytedance/UI-TARS-desktop) 构建，通过 Vision-Language Model 驱动自然语言指令，实现对飞书客户端的自动化操控。

[简体中文](./README.md)

## 项目简介

CUA_Feishu 是一个基于 UI-TARS-desktop 的 Computer-Use Agent 应用，专注于飞书场景下的桌面自动化操作。用户可以通过自然语言指令，让 AI Agent 自动完成飞书中的各类任务，如：

- 📩 在飞书中自动发送消息、回复
- 📅 创建日程、添加会议
- 📋 操作飞书文档、表格
- 🔍 搜索飞书中的内容
- ⚙️ 调整飞书设置

## 基于 UI-TARS-desktop

本项目基于 [ByteDance UI-TARS-desktop](https://github.com/bytedance/UI-TARS-desktop) 开发。UI-TARS-desktop 是一个基于 [UI-TARS](https://github.com/bytedance/UI-TARS) 模型的原生 GUI Agent 桌面应用，具备以下能力：

- 🤖 由 Vision-Language Model 驱动的自然语言控制
- 🖥️ 截屏与视觉识别支持
- 🎯 精准的鼠标和键盘控制
- 💻 跨平台支持（Windows / macOS / Browser）
- 🔐 完全本地处理，保障隐私安全

## 开发与调试

### 前置要求

- Node.js >= 20.x
- pnpm 9.x

### 启动开发

```bash
# 安装依赖
pnpm install

# 进入 ui-tars 应用目录
cd apps/ui-tars

# 启动开发服务器
pnpm dev
```

### 构建

```bash
cd apps/ui-tars
pnpm build
```

## 项目结构

```
CUA_Feishu/
├── apps/
│   └── ui-tars/          # UI-TARS Desktop 应用（主要修改区域）
│       ├── src/
│       │   ├── main/     # Electron 主进程
│       │   ├── preload/  # 预加载脚本
│       │   └── renderer/ # 渲染进程（前端 UI）
│       └── ...
├── packages/              # SDK、共享工具包
├── multimodal/            # 多模态 Agent 相关包
└── docs/                  # 文档
```

## 修改说明

相较于原始 UI-TARS-desktop，本项目针对飞书使用场景进行了以下适配：

- **Widget 窗口鼠标穿透**：通过 `setIgnoreMouseEvents(true, { forward: true })` + CSS `pointer-events` 分层控制，实现控制面板窗口的点击穿透，避免遮挡 Agent 操作目标
- **Overlay 标记窗口优化**：在 Agent 执行动作时临时隐藏预测标记窗口，确保点击不被干扰
- **无障碍树采集**：新增 `getDom` 服务，定时抓取飞书窗口的 Accessibility Tree 并写入本地日志，为后续数据分析提供基础
- **飞书UI自动标注**：新增完整的 LLM 粗标注 + 人工矫正流程，Agent 每次截图时自动触发 VLM 对飞书界面进行 UI 元素识别，标注结果持久化存储；前端新增 `/annotation` 标注页面，支持树形结构浏览、元素编辑矫正，可用于构建高质量飞书 UI 数据集

## License

本项目基于 [UI-TARS-desktop](https://github.com/bytedance/UI-TARS-desktop)，遵循 Apache License 2.0 协议。

## 致谢

- [UI-TARS-desktop](https://github.com/bytedance/UI-TARS-desktop) — ByteDance 出品的 GUI Agent 桌面应用
- [UI-TARS](https://github.com/bytedance/UI-TARS) — Vision-Language Model for GUI Automation
