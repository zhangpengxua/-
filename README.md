# AI 解题助手 (AI Math Problem Solver)

基于 Claude Sonnet 4.6 (via AIHubMix) 的智能解题应用，支持文字输入与图片上传，通过三层 AI 管线生成分步解题过程，并能自动生成 Python 图表辅助理解。支持浅色/深色模式切换。

## 技术栈

| 层 | 技术 |
|------|------|
| **前端** | React 18, Axios, Create React App |
| **后端** | Node.js, Express.js |
| **AI** | Claude Sonnet 4.6 (via AIHubMix) |
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
│   │   ├── llmService.js      # Claude API 调用 + 绘图提示词模板 + JSON 验证
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

1. **第一层 — 生成解题步骤**: 调用 Claude 分析题目，输出结构化解题步骤（JSON）。提示词要求每步包含「目标→依据→计算过程→结果」四段，强制图形类题目优先生成图像，并控制单步描述不超过150字。
2. **第二层 — 生成绘图代码**: 对需要图像的步骤，调用 Claude 提取绘图参数，生成 Python matplotlib 代码（支持静态图、GIF 动画、3D 图形）。
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

- **环境自动检测**: 启动时自动检测 Python、matplotlib、numpy、pillow、API Key 等依赖，缺失时弹出图形化指引
- **深色模式**: 右上角一键切换浅色/深色主题
- **智能路由**: 自动判断输入是否为题目——题目走多层分步解题+图像生成流程，普通对话走简洁模式
- **停止生成**: 思考中将发送按钮变为红色停止按钮，点击立即中止 AI 生成
- **修改重问**: 最近一次用户消息气泡左下角有编辑按钮，点击可修改提问并自动删除旧问答后重新发送
- **OCR 保护**: OCR 结果必须展示至少 1 秒后才能确认发送，防止误触
- **对话删除中止**: 删除对话时自动中止正在进行的 AI 生成
- **空对话自动清理**: 切换对话时自动清理空对话
- **3D 交互模型**: 几何类题目自动展示可拖拽旋转+滚轮缩放的3D视图
- **固定页面布局**: 聊天区域独立滚动，页面高度始终为视口大小
- **思考状态隔离**: 思考动画仅显示在当前对话中

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
LLM_API_URL=https://aihubmix.com/v1/chat/completions
LLM_API_KEY=你的AIHubMix_API_Key
LLM_MODEL=claude-sonnet-4-6-1m
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

## 更新记录

### 2026-06-12
- **双模型路由**: 普通对话/分类/标题/参数提取使用 DeepSeek V4 Pro，仅3D几何代码生成使用 Claude Sonnet 4.6
- **交互式3D模型**: 几何类题目优先使用Three.js在浏览器中直接渲染可拖拽缩放的3D模型，不再依赖Python生成的静态PNG
- **下标坐标解析**: 新增`x₀=1, y₀=√2, z₀=0`格式的坐标提取，自动识别点名称并构建3D顶点
- **右键菜单删除**: 右键点击侧边栏对话弹出红色删除菜单项
- **边自连接算法**: 多层级分组匹配连接各层环+垂直棱，小集完全图fallback确保所有点有线相连
- **向量/分数渲染预处理**: 自动将`\vec{AB}`、`\overrightarrow{AB}`、`\frac{}{}`、`\sqrt{}`、`AC→`包裹为KaTeX可识别的`$...$`

### 2026-06-10
- **编辑按钮移至气泡**: 修改最近一次提问的编辑按钮移至最近用户消息气泡左下角，更小更不显眼
- **编辑后删除旧消息**: 修改提问时自动删除修改前的提示词和对应的AI回答
- **3D模型生成修复**: 修复`extractGeometryParams`/`extractFunctionParams`/`extractAnimationParams`中JSON解析失败时返回原始对象而非Python代码的问题；在Python执行前添加`matplotlib.use('Agg')`确保无GUI环境可正常运行
- **启动脚本修复**: 修复`start.bat`闪退问题——改用绝对路径(`%~dp0`)、增加错误提示、逐步骤显示进度

## 注意事项

- 当前对话数据存储在内存中，重启后端后数据会丢失。如需持久化，可将 MongoDB 连接配置到 `backend/.env` 中的 `MONGODB_URI`。
- Python 绘图生成的图片保存为 `/tmp/figure.png` 或 `/tmp/animation.gif`，Windows 下会自动转换为 `backend/tmp/` 目录。
- Claude API 调用超时设置为 180 秒，Python 执行超时设置为 90 秒。
- Claude 第一层 JSON 解析含自动重试机制，最多重试 2 次。
- **安全提醒**: 请勿将包含真实 API Key 的 `.env` 文件提交到公开仓库。
