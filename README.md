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

- **Widget 窗口鼠标穿透**：Widget 窗口通过 `setIgnoreMouseEvents(true, { forward: true })` 全局透传鼠标事件，同时在 CSS 层将 `html/body/#root` 设为 `pointer-events: none`，仅对 `button` 等交互元素恢复 `pointer-events: auto`，实现"控制按钮可点击、背景区域完全穿透"的精细分层控制
- **Overlay 标记窗口优化**：在 `operator.ts` 的 `execute()` 中，每次执行动作前调用 `hideOverlay()` 隐藏预测标记窗口，动作完成后在 `finally` 块中调用 `showOverlay()` 恢复，避免透明覆盖层拦截鼠标点击；Windows 下的 `type` 动作额外通过剪贴板粘贴方式输入，绕过输入法兼容问题
- **无障碍树采集**：`getDom` 服务通过动态生成 PowerShell 脚本，调用 Windows UIA（UI Automation）的 `IAccessible` 接口遍历飞书进程的完整控件树，将节点的控件类型、名称、包围盒、可交互状态等字段序列化为 JSON 返回；采集结果可注入 Agent 上下文，辅助 VLM 理解当前界面结构
- **飞书窗口自动激活**：Agent 执行前自动将飞书窗口置于前台（`ensureFeishuForeground`），避免因窗口遮挡导致操作失败
- **Agent 记忆系统**：新增完整的任务记忆能力，支持将成功执行的任务步骤持久化为可复用的记忆片段，下次执行相似任务时自动检索并优先回放，显著提升重复任务的执行效率
  - 基于向量嵌入（embedding）的语义相似度检索，自动匹配历史任务
  - 记忆回放（replay）：直接重放历史操作步骤，跳过 VLM 推理，速度更快
  - 手动录制（recording）：用户可手动录制操作步骤并保存为记忆，供 Agent 后续复用
  - 侧边栏 `NavMemories` 组件：可视化浏览、管理所有已保存的记忆条目
  - 任务执行阶段可视化：前端实时展示 `memory-search`、`replay`、`agent` 等执行阶段状态

## License

本项目基于 [UI-TARS-desktop](https://github.com/bytedance/UI-TARS-desktop)，遵循 Apache License 2.0 协议。

## 致谢

- [UI-TARS-desktop](https://github.com/bytedance/UI-TARS-desktop) — ByteDance 出品的 GUI Agent 桌面应用
- [UI-TARS](https://github.com/bytedance/UI-TARS) — Vision-Language Model for GUI Automation
