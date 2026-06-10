# AI 解题助手 (AI Math Problem Solver)

基于 DeepSeek 大模型的智能解题应用，支持文字输入与图片上传，通过三层 AI 管线生成分步解题过程，并能自动生成 Python 图表辅助理解。支持浅色/深色模式切换。

## 技术栈

| 层 | 技术 |
|------|------|
| **前端** | React 18, Axios, Create React App |
| **后端** | Node.js, Express.js |
| **AI** | DeepSeek API (deepseek-chat) |
| **OCR** | 百度 OCR API |
| **可视化** | Python + Matplotlib (由后端自动调用) |

## 项目结构

```
├── backend/
│   ├── server.js              # Express 服务入口
│   ├── routes/
│   │   ├── conversations.js   # 对话 CRUD + 消息处理（三层 AI 编排）
│   │   └── python.js          # Python 代码执行接口
│   ├── models/
│   │   └── Conversation.js    # 对话数据模型 (Mongoose Schema)
│   ├── utils/
│   │   ├── llmService.js      # DeepSeek API 调用 + 绘图提示词模板 + JSON 验证
│   │   └── ocrService.js      # 百度 OCR 文字识别
│   └── .env                   # 环境变量（API Key 等）
├── frontend/
│   ├── public/
│   │   └── index.html
│   └── src/
│       ├── App.js             # 主应用组件（含深色模式切换、乐观更新等）
│       ├── index.js           # React 入口（ThemeContext 注入）
│       ├── theme.js           # 设计令牌 — 浅色/深色双主题
│       ├── index.css          # 全局样式
│       └── components/
│           ├── Sidebar.js     # 侧边栏（对话列表管理）
│           ├── ChatArea.js    # 聊天消息展示区（可滚动）
│           ├── InputArea.js   # 输入区域（文本 + 图片上传）
│           ├── CodeBlock.js   # 代码块渲染
│           ├── GeometryViewer.js      # 几何图形查看器
│           └── Interactive3DViewer.js # 3D 交互查看器
├── start.bat                  # Windows 一键启动脚本
└── start.ps1                  # PowerShell 一键启动脚本
```

## 核心流程

### 三层 AI 管线

当用户发送一条问题消息时，后端依次执行三层调用：

1. **第一层 — 生成解题步骤**: 调用 DeepSeek 分析题目，输出结构化解题步骤（JSON）。提示词要求每步包含「目标→依据→计算过程→结果」四段，强制图形类题目优先生成图像，并控制单步描述不超过150字。
2. **第二层 — 生成绘图代码**: 对需要图像的步骤，调用 DeepSeek 提取绘图参数，生成 Python matplotlib 代码（支持静态图、GIF 动画、3D 图形）。
3. **第三层 — 合成最终答案**: 收集所有步骤结果，按「先图后文」的格式拼接最终答案。

### OCR 图片识别流程

用户上传图片后：
1. 图片上传到后端进行 OCR 识别
2. 识别结果展示在输入框上方，用户可编辑修改
3. 用户确认后，OCR 文字与用户输入的文本一同提交给 AI 处理

### 提示词设计

**防幻觉机制**：
- 每步标注依据的定理/公式/条件，禁止编造数据
- 不确定时列出多种可能并说明适用条件
- 文本长度控制：每步不超过150字，summary 不超过80字

**图像生成策略**：默认优先生成。函数图→`MATH_STATIC_EQUATION`，几何→`MATH_STATIC_ABSTRACT`，动态→`MATH_DYNAMIC_GEOMETRY`，物理→`PHYSICS_ENGINE`，化学→`CHEMISTRY_CRYSTAL`。仅纯代数/逻辑推理时不生成。

### 第一层 JSON 格式验证

第一层 LLM 输出会经过 `validateAndFixFirstLayerResult` 严格校验：
- `tryExtractJSON`: 先清洗 markdown 代码块标记，再修复常见 JSON 格式问题（缺引号、尾逗号），然后解析
- 验证 `steps` 数组存在且非空
- 校验每个步骤的 `id`、`description`、`needImage`、`imageType` 字段类型
- `imageType` 必须在 6 种预定义类型中选择，支持大小写不敏感的匹配
- `needImage` 支持字符串 `"true"`/`"True"` 格式的解析
- `needImage` 为 `false` 时自动修正 `imageType` 为 `NO_IMAGE`
- 验证失败时自动重试（最多 2 次），提示 LLM 修正格式

### 支持的图像类型

| 类型 | 说明 |
|------|------|
| `MATH_STATIC_EQUATION` | 函数图像（有明确解析式） |
| `MATH_DYNAMIC_GEOMETRY` | 动态几何演示（GIF 动画） |
| `MATH_STATIC_ABSTRACT` | 抽象概念可视化 |
| `CHEMISTRY_CRYSTAL` | 晶胞结构 3D 模型 |
| `PHYSICS_ENGINE` | 基础物理模拟（如抛体运动） |

### 图片上传 + OCR

用户可上传题目图片，前端将 Base64 编码发送到后端，后端调用百度 OCR 提取文字，然后与用户输入的文本合并作为 LLM 的输入。

## 特性

- **深色模式**: 网页右上角按钮一键切换浅色/深色主题
- **乐观更新**: 用户发送消息时立即在聊天界面显示，无需等待后端响应
- **空对话自动清理**: 切换或创建新对话时，当前空对话自动删除
- **固定页面布局**: 聊天区域独立滚动，页面高度始终为视口大小
- **思考状态隔离**: 思考动画仅显示在当前对话中，新建对话不会出现错误的加载状态
- **OCR 确认流程**: 图片上传后先 OCR 识别，结果可编辑后再提交 AI 处理
- **3D 交互**: 鼠标拖拽旋转 + 滚轮缩放 3D 模型

## 前置要求

- **Node.js** >= 16.x
- **Python** >= 3.8（需安装 matplotlib, numpy, pillow）
- **MongoDB**（可选，当前使用内存存储）

### 安装 Python 依赖

```bash
pip install matplotlib numpy pillow
```

## 快速开始

1. **克隆项目并安装依赖**

```bash
cd backend && npm install
cd ../frontend && npm install
cd ..
```

2. **配置 API Key**

编辑 `backend/.env`，填入你的 API Key：

```env
PORT=5000
DEEPSEEK_API_URL=https://api.deepseek.com/v1/chat/completions
DEEPSEEK_API_KEY=你的DeepSeek_API_Key
BAIDU_OCR_API_KEY=你的百度OCR_API_Key
BAIDU_OCR_SECRET_KEY=你的百度OCR_Secret_Key
```

3. **启动服务**

Windows 用户双击 `start.bat` 或运行：

```bash
# 终端1: 启动后端
cd backend && node server.js

# 终端2: 启动前端
cd frontend && npm start
```

4. **打开浏览器访问** `http://localhost:3000`

## API 接口

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/conversations` | 获取所有对话列表 |
| POST | `/api/conversations` | 创建新对话 |
| GET | `/api/conversations/:id` | 获取指定对话详情 |
| POST | `/api/conversations/:id/message` | 发送消息（触发三层 AI 管线） |
| DELETE | `/api/conversations/:id` | 删除对话 |
| POST | `/api/python/execute` | 执行 Python 代码 |

## 注意事项

- 当前对话数据存储在内存中，重启后端后数据会丢失。如需持久化，可将 MongoDB 连接配置到 `backend/.env` 中的 `MONGODB_URI`。
- Python 绘图生成的图片保存为 `/tmp/figure.png` 或 `/tmp/animation.gif`，Windows 下会自动转换为 `backend/tmp/` 目录。
- DeepSeek API 调用超时设置为 180 秒，Python 执行超时设置为 90 秒。
- DeepSeek 第一层 JSON 解析含自动重试机制，最多重试 2 次。
- **安全提醒**: 请勿将包含真实 API Key 的 `.env` 文件提交到公开仓库。
