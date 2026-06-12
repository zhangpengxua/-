const axios = require('axios');
require('dotenv').config();

const AIHUBMIX_API_URL = process.env.AIHUBMIX_API_URL || 'https://aihubmix.com/v1/chat/completions';
const AIHUBMIX_API_KEY = process.env.AIHUBMIX_API_KEY;

// DeepSeek uses its own key (from original project), Claude uses AIHubMix key
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY || AIHUBMIX_API_KEY;
const DEEPSEEK_API_URL = process.env.DEEPSEEK_API_URL || 'https://api.deepseek.com/v1/chat/completions';

const LLM_CHAT_MODEL = process.env.LLM_CHAT_MODEL || 'deepseek-chat';
const LLM_IMAGE_MODEL = process.env.LLM_IMAGE_MODEL || 'claude-sonnet-4-6';

// ==================== Prompt template definitions ====================
const PROMPT_TEMPLATES = {
  FIRST_LAYER: {
    NO_IMAGE: 'NO_IMAGE',
    NEED_IMAGE: 'NEED_IMAGE'
  },
  SECOND_LAYER: {
    MATH_STATIC_EQUATION: 'MATH_STATIC_EQUATION',
    MATH_DYNAMIC_GEOMETRY: 'MATH_DYNAMIC_GEOMETRY',
    MATH_DYNAMIC_3D_GEOMETRY: 'MATH_DYNAMIC_3D_GEOMETRY',  // 新增：3D几何动画
    MATH_STATIC_ABSTRACT: 'MATH_STATIC_ABSTRACT',
    CHEMISTRY_CRYSTAL: 'CHEMISTRY_CRYSTAL',
    PHYSICS_ENGINE: 'PHYSICS_ENGINE',
    DEFAULT: 'DEFAULT'
  }
};

class LLMService {
  static logCall(type, model, promptLen) {
    console.log(`[LLM:${type}] model=${model} promptLen=${promptLen}`);
  }

  static async callLLMChat(messages, systemPrompt = '', maxTokens = 4096) {
    this.logCall('chat', LLM_CHAT_MODEL, (systemPrompt + JSON.stringify(messages)).length);
    return this._callLLM(LLM_CHAT_MODEL, messages, systemPrompt, maxTokens);
  }

  static async callLLMImage(messages, systemPrompt = '', maxTokens = 4096) {
    this.logCall('image', LLM_IMAGE_MODEL, (systemPrompt + JSON.stringify(messages)).length);
    return this._callLLM(LLM_IMAGE_MODEL, messages, systemPrompt, maxTokens);
  }

  static async _callLLM(model, messages, systemPrompt = '', maxTokens = 4096) {
    // DeepSeek chat model uses DeepSeek API directly; Claude image model uses AIHubMix
    const isDeepSeek = model === 'deepseek-chat';
    const url = isDeepSeek ? DEEPSEEK_API_URL : AIHUBMIX_API_URL;
    const key = isDeepSeek ? DEEPSEEK_API_KEY : AIHUBMIX_API_KEY;

    try {
      const msgs = [];
      if (systemPrompt) {
        msgs.push({ role: 'system', content: systemPrompt });
      }
      msgs.push(...messages);

      const requestBody = {
        model,
        messages: msgs,
        max_tokens: maxTokens,
        temperature: 0.7
      };

      const response = await axios.post(url, requestBody, {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${key}`
        },
        timeout: 180000,
        maxRedirects: 5
      });

      const content = response.data.choices[0].message.content;
      console.log(`[LLM:${model}] Response length:`, content?.length, 'First 200 chars:', content?.substring(0, 200));
      return content;
    } catch (error) {
      const detail = error.response?.data;
      console.error(`[LLM:${model}] API Error:`, JSON.stringify(detail || error.message));
      throw error;
    }
  }

  // ==================== JSON 解析与验证 ====================
  static VALID_IMAGE_TYPES = [
    'NO_IMAGE', 'MATH_STATIC_EQUATION', 'MATH_DYNAMIC_GEOMETRY',
    'MATH_DYNAMIC_3D_GEOMETRY',  // 新增：3D几何动画
    'MATH_STATIC_ABSTRACT', 'CHEMISTRY_CRYSTAL', 'PHYSICS_ENGINE'
  ];

  static tryExtractJSON(text) {
    let cleaned = text.trim();
    cleaned = cleaned.replace(/```(?:json)?\s*/gi, '').replace(/```\s*/g, '');

    let jsonMatch = cleaned.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;

    let jsonStr = jsonMatch[0];
    jsonStr = jsonStr
      .replace(/,(\s*[}\]])/g, '$1')
      .replace(/([{,]\s*)(\w+)(\s*:)/g, '$1"$2"$3')
      .replace(/:(\s*)(\w+)(\s*[,}\]])/g, ':"$2"$3');

    try {
      return JSON.parse(jsonStr);
    } catch (e1) {
      try {
        return JSON.parse(jsonMatch[0]);
      } catch (e2) {
        return null;
      }
    }
  }

  static validateAndFixFirstLayerResult(result) {
    if (!result || typeof result !== 'object') return null;
    if (!Array.isArray(result.steps)) return null;

    const fixedSteps = [];
    for (let i = 0; i < result.steps.length; i++) {
      const step = result.steps[i];
      if (!step || typeof step !== 'object') continue;

      const needImage = typeof step.needImage === 'boolean'
        ? step.needImage
        : (step.needImage === 'true' || step.needImage === 'True' || step.needImage === true);

      const fixed = {
        id: typeof step.id === 'number' ? step.id : (i + 1),
        description: typeof step.description === 'string' && step.description.trim()
          ? step.description.trim()
          : `步骤 ${i + 1}`,
        needImage,
        imageType: 'NO_IMAGE',
      };

      if (typeof step.imageType === 'string') {
        const trimmed = step.imageType.trim().toUpperCase();
        if (this.VALID_IMAGE_TYPES.includes(trimmed)) {
          fixed.imageType = trimmed;
        } else if (needImage) {
          fixed.imageType = 'MATH_STATIC_EQUATION';
        }
      }

      if (fixed.needImage && fixed.imageType === 'NO_IMAGE') {
        fixed.imageType = 'MATH_STATIC_EQUATION';
      }

      if (!fixed.needImage) {
        fixed.imageType = 'NO_IMAGE';
      }

      fixedSteps.push(fixed);
    }

    if (fixedSteps.length === 0) return null;

    return {
      steps: fixedSteps,
      summary: typeof result.summary === 'string' ? result.summary : '',
    };
  }

  // ==================== 问题分类：判断是否为理科题目 ====================
  static async classifyInput(userInput) {
    const systemPrompt = '你是一个输入分类器。判断用户输入是否为数学、物理、化学、几何类题目。是则输出 {"isProblem":true}，否则输出 {"isProblem":false}。只输出JSON。';

    const messages = [{ role: 'user', content: '判断以下输入是否是理科题目（需要分步解题）：\n' + userInput }];

    try {
      const result = await this.callLLMChat(messages, systemPrompt, 200);
      const parsed = this.tryExtractJSON(result);
      if (parsed && typeof parsed.isProblem === 'boolean') {
        return parsed.isProblem;
      }
      // 简单的本地判断: 包含数学/物理/化学/几何关键词
      const problemKeywords = ['求', '解', '计算', '证明', '画图', '函数', '方程', '几何', '三角', '面积', '体积',
        '速度', '力', '电场', '磁场', '化学', '晶胞', '反应', '质量', '浓度', '向量', '导数', '积分', '概率',
        'x', 'y', '=', '°', '℃', 'sin', 'cos', 'tan', 'log', 'dx'];
      return problemKeywords.some(k => userInput.toLowerCase().includes(k.toLowerCase()));
    } catch (e) {
      return false;
    }
  }

  // ==================== 简单对话回复 ====================
  static async simpleChat(context, userInput) {
    const systemPrompt = '你是一个AI解题助手。用友好的口吻回复用户的一般性问题，引导用户提出需要解答的数学/科学问题。回复不超过3句话。';

    const messages = [
      { role: 'user', content: `${context ? '上下文：\n' + context + '\n\n' : ''}用户说：${userInput}` }
    ];

    return await this.callLLMChat(messages, systemPrompt, 300);
  }
  static async firstLayerLLM(context, userInput) {
    const systemPrompt = [
      '你是一位资深理科教师。给出详尽、准确、无幻觉的解题过程。',

      '## 杜绝幻觉',
      '1. 禁止编造数据。题目未给的条件不得杜撰，假设需标注"假设…"',
      '2. 每步标注依据（定理/公式/条件）',
      '3. 不确定时列出多种可能并说明适用条件',

      '## 步骤格式 - 仿照以下范例输出',
      '每步 description 需要详细且结构化，参考格式：',
      '',
      '**Step N: 步骤名称**',
      '',
      '详细描述解题过程，使用 Markdown 格式，包括：',
      '- **粗体** 强调关键概念和定理',
      '- *斜体* 标注注意事项',
      '- `代码块` 标记变量和公式',
      '- 有序列表和无序列表组织信息',
      '- 表格整理数据',
      '- > 引用块标注重要结论',
      '- **数学公式使用 LaTeX 格式**：行内公式用 `$` 包裹（如 `$\\cos\\theta = \\frac{\\text{邻边}}{\\text{斜边}}$`），块级公式用 `$$` 包裹',
      '- 向量用 `\\overrightarrow{AB}` 或 `\\vec{a}`，分数用 `\\frac{}{}`，根号用 `\\sqrt{}`',
      '- **禁止使用 Unicode 下标** （如 ₁₂₃₄₅₆₇₈₉₀），始终用 LaTeX 或纯文本标记下标',
      '',
      '**示例格式：**',
      '',
      '**Step 1: 设定坐标系**',
      '',
      '由于△ABC是等腰直角三角形，设：',
      '',
      'C(0,0,0), A(a,0,0), B(0,a,0)',
      '',
      '其中 AC = BC = a。',
      '',
      '因为是直棱柱且CC₁=2，所以：',
      '',
      'A₁(a,0,2), B₁(0,a,2), C₁(0,0,2)',
      '',
      'D是AB中点，故D(a/2, a/2, 0)',
      'E是AC₁中点，故E(a/2, 0, 1)',
      '',
      '**顶点坐标列表：**',
      '- A(2,0,0), B(0,2,0), C(0,0,0)',
      '- A₁(2,0,2), B₁(0,2,2), C₁(0,0,2)',
      '- D(1,1,0), E(1,0,1)',
      '',
      '**Step 2: 证明DE ∥ 平面BCC₁B₁**',
      '',
      'DE的方向向量：',
      '',
      'DE→ = E - D = (0, -1, 1)',
      '',
      '平面BCC₁B₁的法向量：n = (1,0,0)',
      '',
      '> 关键推论：因为DE与平面法向量垂直，所以DE ∥ 平面BCC₁B₁',
      '',
      '**长度控制：** 每个步骤的 description 总共不超过300字。summary 不超过100字。',
      '**段落分隔：** 使用双换行 \\n\\n 分隔不同内容块，确保网页显示有合适间距。',

      '## 底面顶点排布规则（重要）',
      '',
      '## 坐标系设定规则（必须遵守）',
      '',
      '使用标准右手直角坐标系：',
      '- **底面在 XY 平面**（所有底面顶点的 z 坐标均为 0）',
      '- **Z 轴为竖直轴**，向上为正方向',
      '- **满足右手法则**：右手四指从 X 轴转向 Y 轴，拇指指向 Z 轴正方向',
      '- X 轴指向右，Y 轴指向前（屏幕深处），Z 轴指向上',
      '',
      '**坐标放置要求（重要）：**',
      '必须将所有几何体的顶点坐标全部放在第一卦限内（x≥0, y≥0, z≥0）。',
      '选择合理的原点位置，使得图形的大部分位于坐标轴的正方向区域内。',
      '例如：将几何体的一个顶点放在原点(0,0,0)处，其他顶点向x、y、z的正方向展开。',
      '底面放在z=0的平面上，高沿z轴正方向延伸。',
      '',
      '底面顶点命名规则：',
      '对于几何体（如棱柱、棱锥等），在描述顶点坐标时，底面顶点必须按照',
      '**从上往下看逆时针（CCW）** 的方向排列。这是3D渲染系统正确判定面朝向的依据。',
      '',
      '具体规则：',
      '1. 选取底面的任意一个顶点作为起点（如A）',
      '2. 沿着底面多边形的边界，按逆时针方向依次命名后续顶点（B, C, D...）',
      '3. 顶面的对应顶点应按相同顺序命名（A₁, B₁, C₁, D₁...）',
      '4. 描述顶点坐标时，在顶点列表中按名称排序即可',
      '',
      '示例 - 正四棱柱底面（从上往下看，Z轴向下时XY面上的顶点）：',
      '- A(1,1,0) — 右下',
      '- B(-1,1,0) — 左上',
      '- C(-1,-1,0) — 左下',
      '- D(1,-1,0) — 右下',
      '',
      '## 骨架绘制规则（重要）',
      '',
      '对于需要生成3D图形的几何题，**必须在 description 末尾明确列出几何体的所有顶点和所有边（骨架）**。',
      '即使某些顶点或边在解题步骤中没有被明确提及，也必须列出完整的几何体骨架。',
      '',
      '格式（分号分隔）：',
      '- 先列出所有顶点的坐标：A(x,y,z); B(x,y,z); C(x,y,z); ...（按名称排序）',
      '- 再列出所有边的连接：A-B; B-C; C-A; A-A1; B-B1; C-C1; ...（按几何结构列出）',
      '',
      '对于棱柱：底面环形连接 + 顶面环形连接 + 垂直棱',
      '对于棱锥：底面环形连接 + 顶点到底面各顶点的连接',
      '',
      '示例 - 正三棱柱ABCDEF-A₁B₁C₁D₁E₁F₁：',
      'A(0,0,0); B(2,0,0); C(3,√3,0); D(2,2√3,0); E(0,2√3,0); F(-1,√3,0); A₁(0,0,2); B₁(2,0,2); C₁(3,√3,2); D₁(2,2√3,2); E₁(0,2√3,2); F₁(-1,√3,2); A-B; B-C; C-D; D-E; E-F; F-A; A₁-B₁; B₁-C₁; C₁-D₁; D₁-E₁; E₁-F₁; F₁-A₁; A-A₁; B-B₁; C-C₁; D-D₁; E-E₁; F-F₁',
      '',
      '## 图像决策',
      '以下情况 needImage=true：',
      '- 函数图像（一次/二次/指数/对数/三角/幂/绝对值/分段）→ MATH_STATIC_EQUATION',
      '- 几何/空间图形（平面几何/立体几何/向量/坐标系/解析几何/截面）→ MATH_STATIC_ABSTRACT',
      '- 动态过程（动点轨迹/图形变换/函数平移伸缩/旋转体）→ MATH_DYNAMIC_GEOMETRY',
      '- 物理运动/力学/电路/光路 → PHYSICS_ENGINE',
      '- 化学晶胞/分子结构/反应装置 → CHEMISTRY_CRYSTAL',
      '- 坐标系中画点/线/面/向量 → MATH_STATIC_EQUATION',
      '- 不等式区域/线性规划可行域 → MATH_STATIC_EQUATION',
      '- 数列图像/散点图 → MATH_STATIC_EQUATION',
      '仅纯代数运算/纯文字逻辑推理时 needImage=false。默认优先生成图。',

      '## 输出',
      '纯JSON，不要markdown包裹。',
      '{"steps":[{"id":1,"description":"**Step 1: ...**\\n\\n详细内容...","needImage":true,"imageType":"MATH_STATIC_ABSTRACT"}],"summary":"最终答案总结"}',
      'imageType: NO_IMAGE | MATH_STATIC_EQUATION | MATH_DYNAMIC_GEOMETRY | MATH_STATIC_ABSTRACT | CHEMISTRY_CRYSTAL | PHYSICS_ENGINE',
    ].join('\n');

    const messages = [
      {
        role: 'user',
        content: `${context ? '对话上下文：\n' + context + '\n\n' : ''}请解答以下问题。使用Markdown格式输出，数学公式使用LaTeX（$cos\theta$ 行内公式 或 $$\\cos\\theta = \\frac{1}{2}$$ 块级公式）。对于几何类题目（imageType=MATH_STATIC_ABSTRACT），必须在description末尾用分号分隔格式明确列出所有顶点坐标和棱边连接。只要涉及图形/函数/几何/物理/化学内容，务必标记为需要生成图像。底面顶点请按从上往下看逆时针方向排布。\n\n问题：${userInput}`
      }
    ];

    const MAX_RETRIES = 2;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      const result = await this.callLLMChat(messages, systemPrompt);

      const parsed = this.tryExtractJSON(result);

      if (!parsed) {
        console.error(`第一层JSON解析失败 (attempt ${attempt + 1})，原始内容:`, result.substring(0, 500));
        if (attempt < MAX_RETRIES) {
          messages.push({ role: 'assistant', content: result });
          messages.push({ role: 'user', content: '你的输出无法被JSON解析器解析。请只输出纯JSON对象，不要包含任何markdown代码块标记或其他文字。' });
          continue;
        }
        return { steps: [{ id: 1, description: userInput, needImage: false, imageType: 'NO_IMAGE' }], summary: '直接回答用户问题' };
      }

      const fixed = this.validateAndFixFirstLayerResult(parsed);
      if (fixed) {
        return fixed;
      }

      console.log(`第一层JSON内容不符合规范 (attempt ${attempt + 1})，原始内容:`, result.substring(0, 500));
      if (attempt < MAX_RETRIES) {
        messages.push({ role: 'assistant', content: result });
        messages.push({ role: 'user', content: '你的JSON格式不正确。必须包含"steps"数组，每个步骤必须有id(数字)、description(字符串)、needImage(布尔值)、imageType(必须是' + this.VALID_IMAGE_TYPES.join(', ') + '之一)。请修正后重新输出。' });
        continue;
      }
      return { steps: [{ id: 1, description: userInput, needImage: false, imageType: 'NO_IMAGE' }], summary: '直接回答用户问题' };
    }

    return { steps: [{ id: 1, description: userInput, needImage: false, imageType: 'NO_IMAGE' }], summary: '直接回答用户问题' };
  }

  // ==================== 第二层：生成绘图代码 ====================
  static async secondLayerLLM(stepDescription, imageType, previousParams = null) {
    console.log('[secondLayerLLM] imageType:', imageType, 'previousParams:', previousParams);
    // MATH_STATIC_ABSTRACT → 3D 几何体
    if (imageType === 'MATH_STATIC_ABSTRACT') {
      return this.extractGeometryParams(stepDescription, imageType, previousParams);
    }
    // MATH_DYNAMIC_GEOMETRY 和 MATH_DYNAMIC_3D_GEOMETRY → 3D几何动画
    if (imageType === 'MATH_DYNAMIC_GEOMETRY' || imageType === 'MATH_DYNAMIC_3D_GEOMETRY') {
      return this.extractAnimationParams(stepDescription, previousParams);
    }
    // 其余类型（MATH_STATIC_EQUATION / CHEMISTRY_CRYSTAL / PHYSICS_ENGINE）→ 函数参数
    return this.extractFunctionParams(stepDescription, imageType, previousParams);
  }

  // ==================== 提取几何参数 ====================
  static async extractGeometryParams(stepDescription, imageType, previousParams = null) {
    console.log('[extractGeometryParams] imageType:', imageType, 'desc:', stepDescription?.substring(0, 100));
    const systemPrompt = [
      '你是一个几何/3D建模参数提取专家。请根据题目描述精确提取绘图参数。',
      '',
      '准则：',
      '1. 仅基于题目给出的信息提取参数，不要编造未给出的坐标、尺寸',
      '2. 如果题目未给出具体坐标，基于几何关系合理推断',
      '3. 坐标值必须是数值，不是表达式',
      '4. 输出仅包含JSON对象，无其他文字',
      '',
      '参数说明：',
      '- title: 图形标题',
      '- points: 关键顶点坐标数组 [{"name":"A","x":0,"y":0,"z":0}, ...]，二维图形z=0',
      '- lines: 棱/边数组 [["A","B"],["B","C"],...]',
      '- planes: 面数组 [{"name":"底面","points":["A","B","C","D"]},...]',
      '- highlightPoints: 需突出显示的点名数组',
      '- highlightLines: 需突出显示的线段数组',
      '- auxiliaryLines: 辅助线数组，如["A-D","B-E"]，这些线会用虚线和不同颜色显示',
      '- auxiliaryPlanes: 辅助面数组 [{"name":"截面","points":["A","B","C"]},...]，同一辅助面的线条颜色一致',
      '- lineStyles: 自定义线条样式 {"A-B":{"color":"red","lineStyle":"--","lineWidth":3}}',
      '- viewAngle: 3D视角 [elevation, azimuth]，如[30, 45]',
      '',
      '重要提示：',
      '- 辅助线是题目中提到的辅助线、延长线、连接线等非主体线条',
      '- 辅助面是题目中提到的截面、辅助平面等',
      '- 同一辅助面的所有线条应该使用相同的颜色',
      '- 辅助线应该用虚线显示，主体线条用实线',
      '',
      '上下文一致性：',
      '- 如果提供了previousParams，请参考其中的顶点坐标、线条定义等参数',
      '- 保持几何体的连续性，同一几何体的不同步骤应该使用相同的顶点和线条定义',
      '- 保持视角的一致性，使用相同的viewAngle',
      '',
      '常见几何体默认参考（仅在题目未给数值时使用）：',
      '- 正方体：8个顶点，12条棱，6个面，默认边长2',
      '- 正四面体：4个顶点，6条棱',
      '- 三棱柱：6个顶点，9条棱',
    ].join('\n');

    let userPrompt = [
      '请根据以下解题步骤中的几何信息，提取精确的绘图参数。',
      '',
      '解题步骤：' + stepDescription,
      '',
      '图像类型：' + (imageType === 'MATH_DYNAMIC_GEOMETRY' ? '动态几何（动图）' : '静态几何（3D/2D图形）'),
    ];

    if (previousParams) {
      userPrompt.push('');
      userPrompt.push('前一步的参数（用于保持一致性）：');
      userPrompt.push(JSON.stringify(previousParams, null, 2));
      userPrompt.push('');
      userPrompt.push('请参考这些参数，确保新图形与之前的图形保持相同的几何体定义和视角。');
    }

    userPrompt.push('');
    userPrompt.push('请输出JSON格式的几何参数。如果步骤中有具体顶点名称和位置关系，必须精确反映。');
    userPrompt.push('特别注意：识别题目中的辅助线和辅助面，并在auxiliaryLines和auxiliaryPlanes中标注。');

    const messages = [{ role: 'user', content: userPrompt.join('\n') }];
    console.log('[extractGeometryParams] Calling Claude for 3D code gen...');
    const result = await this.callLLMImage(messages, systemPrompt);
    console.log('[extractGeometryParams] Claude response:', result?.substring(0, 400));

    try {
      const jsonMatch = result.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const params = JSON.parse(jsonMatch[0]);
        return this.generateGeometryCode(params, imageType);
      }
      throw new Error('No JSON found in geometry params response');
    } catch (parseError) {
      console.error('几何参数解析失败:', parseError.message, '原始响应:', result?.substring(0, 300));
      return this.generateGeometryCode({
        title: '几何图形',
        points: [
          { name: 'A', x: 0, y: 0, z: 0 },
          { name: 'B', x: 2, y: 0, z: 0 },
          { name: 'C', x: 0, y: 2, z: 0 },
          { name: 'A1', x: 0, y: 0, z: 2 },
          { name: 'B1', x: 2, y: 0, z: 2 },
          { name: 'C1', x: 0, y: 2, z: 2 }
        ],
        lines: [['A', 'B'], ['B', 'C'], ['C', 'A'], ['A1', 'B1'], ['B1', 'C1'], ['C1', 'A1'], ['A', 'A1'], ['B', 'B1'], ['C', 'C1']]
      }, imageType);
    }
  }

  // ==================== 提取函数参数 ====================
  static async extractFunctionParams(stepDescription, imageType, previousParams = null) {
    const systemPrompt = [
      '你是一个函数参数提取专家。请根据题目描述提取函数绘图所需的参数。',
      '',
      '准则：',
      '1. 仅基于题目给出的函数/数据提取参数',
      '2. 方程表达式使用Python/numpy语法（如 y = x**2, y = np.sin(x), y = np.exp(x)）',
      '3. 坐标范围要能清晰展示函数的所有关键特征（零点、极值、渐近线、对称轴、顶点、交点），必要时扩大范围',
      '4. 对复杂曲线（参数方程、隐函数、分段函数、极坐标），必须提取完整参数信息',
      '5. 输出仅包含JSON对象，无其他文字',
      '',
      '参数说明：',
      '- title: 图形标题',
      '- equations: 函数表达式数组 ["y = x**2", "y = 2*x + 1"]',
      '- colors: 颜色数组，与equations对应 ["red", "blue", "green", "orange", "purple"]',
      '- xRange: x轴范围 [min, max]',
      '- yRange: y轴范围 [min, max]',
      '- showGrid: 是否显示网格（true/false）',
      '- legend: 图例标签数组 ["抛物线", "直线"]',
      '- lineStyles: 线条样式数组 [{"lineStyle":"-","lineWidth":2},...]，支持实线"-"、虚线"--"、点线":"、点划线"-."',
      '',
      '范围选择指南：',
      '- 一次/二次/多项式函数：xRange默认[-10, 10]，yRange根据顶点和最值适当选择',
      '- 三角函数：xRange默认[-6.28, 6.28]（约2π），yRange默认[-2, 2]',
      '- 指数函数：xRange默认[-3, 5]，yRange默认[-1, 20]',
      '- 对数函数：xRange默认[0.01, 10]，yRange默认[-5, 5]',
      '- 幂函数/根号函数：xRange默认[0, 10]',
      '- 分段函数：覆盖所有分段定义域',
      '- 双曲线/圆锥曲线：xRange默认[-10, 10]，yRange默认[-10, 10]',
      '- 参数方程/极坐标：t范围根据周期完整覆盖',
      '- 物理题：根据实际物理量范围设定（如运动学t∈[0,5]，高度y∈[0,30]）',
      '- 不等式区域：xRange默认[-10, 10]，yRange默认[-10, 10]',
      '',
      '上下文一致性：',
      '- 如果提供了previousParams，请参考其中的xRange、yRange等参数，确保多个图形在同一坐标系中显示',
      '- 保持配色方案的一致性，相同类型的函数使用相同的颜色',
      '- 如果是同一问题的多个步骤，确保图形风格统一',
    ].join('\n');

    const typeName = imageType === 'MATH_STATIC_EQUATION' ? '函数图像（解析式）'
      : imageType === 'CHEMISTRY_CRYSTAL' ? '化学晶胞'
      : imageType === 'PHYSICS_ENGINE' ? '物理模拟'
      : '默认图形';

    let userPrompt = [
      '请根据以下解题步骤提取函数绘图参数。',
      '',
      '解题步骤：' + stepDescription,
      '',
      '图像类型：' + typeName,
    ];

    if (previousParams) {
      userPrompt.push('');
      userPrompt.push('前一步的参数（用于保持一致性）：');
      userPrompt.push(JSON.stringify(previousParams, null, 2));
      userPrompt.push('');
      userPrompt.push('请参考这些参数，确保新图形与之前的图形在同一坐标系中显示，保持风格一致。');
    }

    userPrompt.push('');
    userPrompt.push('请输出JSON格式的参数。');

    const messages = [{ role: 'user', content: userPrompt.join('\n') }];
    console.log('[extractFunctionParams] Calling DeepSeek...');
    const result = await this.callLLMChat(messages, systemPrompt);
    console.log('[extractFunctionParams] DeepSeek response:', result?.substring(0, 400));

    try {
      const jsonMatch = result.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const params = JSON.parse(jsonMatch[0]);
        return this.generateFunctionCode(params, imageType);
      }
      throw new Error('No JSON found in function params response');
    } catch (parseError) {
      console.error('函数参数解析失败:', parseError.message, '原始响应:', result?.substring(0, 300));
      return this.generateFunctionCode({
        title: '数学图形',
        equations: ['y = x'],
        colors: ['blue'],
        xRange: [-10, 10],
        yRange: [-10, 10],
        showGrid: true,
        legend: ['直线']
      }, imageType);
    }
  }

  // ==================== 代码生成 ====================
  static generateGeometryCode(params, imageType) {
    console.log('[generateGeometryCode] imageType:', imageType, 'points:', params.points?.length, 'lines:', params.lines?.length);
    console.log('[generateGeometryCode] params:', JSON.stringify(params).substring(0, 400));
    const title = params.title || '几何图形';
    const points = params.points || [
      { name: 'A', x: 0, y: 0, z: 0 },
      { name: 'B', x: 2, y: 0, z: 0 },
      { name: 'C', x: 0, y: 2, z: 0 },
      { name: 'A1', x: 0, y: 0, z: 2 },
      { name: 'B1', x: 2, y: 0, z: 2 },
      { name: 'C1', x: 0, y: 2, z: 2 }
    ];
    const lines = params.lines || [['A', 'B'], ['B', 'C'], ['C', 'A'], ['A1', 'B1'], ['B1', 'C1'], ['C1', 'A1'], ['A', 'A1'], ['B', 'B1'], ['C', 'C1']];
    const highlightLines = params.highlightLines || [];
    const viewAngle = params.viewAngle || [30, 45];

    // 新增：支持线条样式和辅助面
    const lineStyles = params.lineStyles || {};
    const auxiliaryLines = params.auxiliaryLines || [];
    const auxiliaryPlanes = params.auxiliaryPlanes || [];

    // ====== 多层级配色方案，增加对比度 ======
    
    // 第1层：主体结构线 - 深色高饱和度，视觉焦点
    const primaryColors = [
      '#1a237e',  // 深靛蓝 - 主色
      '#b71c1c',  // 深红 - 强调
      '#1b5e20',  // 深绿 - 稳定
      '#4a148c',  // 深紫 - 高级
      '#e65100',  // 深橙 - 活力
      '#006064'   // 深青 - 专业
    ];
    
    // 第2层：扩展/连接线 - 中等亮度，与主体区分
    const secondaryColors = [
      '#3949ab',  // 中蓝
      '#d32f2f',  // 中红
      '#388e3c',  // 中绿
      '#7b1fa2',  // 中紫
      '#f57c00',  // 中橙
      '#00838f'   // 中青
    ];
    
    // 第3层：辅助线 - 浅色/灰色，视觉弱化
    const auxiliaryLineColors = [
      '#90caf9',  // 浅蓝
      '#ef9a9a',  // 浅红
      '#a5d6a7',  // 浅绿
      '#ce93d8',  // 浅紫
      '#ffcc80',  // 浅橙
      '#80deea'   // 浅青
    ];
    
    // 第4层：延伸线/虚线 - 点线混合，用于示意
    const extensionColors = [
      '#64b5f6',  // 点蓝
      '#e57373',  // 点红
      '#81c784',  // 点绿
      '#ba68c8',  // 点紫
      '#ffb74d',  // 点橙
      '#4dd0e1'   // 点青
    ];
    
    // 高亮线条 - 醒目色
    const highlightColor = '#ff1744';  // 亮红
    const focusColor = '#ffd600';       // 亮黄

    // 创建点名称映射：将下标等特殊字符转换为Python兼容的变量名
    const pointNameMap = {};
    let pointCode = points.map(p => {
      const pythonName = p.name
        .replace(/₀/g, '0')
        .replace(/₁/g, '1')
        .replace(/₂/g, '2')
        .replace(/₃/g, '3')
        .replace(/₄/g, '4')
        .replace(/₅/g, '5')
        .replace(/₆/g, '6')
        .replace(/₇/g, '7')
        .replace(/₈/g, '8')
        .replace(/₉/g, '9');
      pointNameMap[p.name] = pythonName;
      return `${pythonName} = (${p.x}, ${p.y}, ${p.z})`;
    }).join('\n');

    pointCode = pointCode.split('\n').map(p => p.trim()).filter(Boolean).join('; ');
    let lineCode = '';
    const lineNames = lines.map(l => l.join('-'));

    // Also emit human-readable data for the 3D viewer
    const verticesDesc = points.map(p => `${p.name}(${p.x},${p.y},${p.z})`).join('; ');
    const edgesDesc = lines.map(l => l.join('-')).join('; ');
    console.log('[generateGeometryCode] vertices:', verticesDesc.substring(0, 200));
    console.log('[generateGeometryCode] edges:', edgesDesc.substring(0, 200));

    lines.forEach((line, index) => {
      const key = line.join('-');
      let color, lw, linestyle;

      // 判断线条类型
      const isAuxiliary = auxiliaryLines.includes(key);
      const isHighlight = highlightLines.includes(key);

      if (isHighlight) {
        // 高亮线条：醒目的红色/黄色，最粗
        color = highlightColor;
        lw = 5;
        linestyle = '-';
      } else if (isAuxiliary) {
        // 辅助线：浅色 + 虚线，明显区别于主体
        color = auxiliaryLineColors[index % auxiliaryLineColors.length];
        lw = 2;
        linestyle = '--';
      } else {
        // 主体线条：根据层级选择颜色
        if (index % 3 === 0) {
          // 第1层：主体结构
          color = primaryColors[(index / 3) % primaryColors.length];
          lw = 3.5;
          linestyle = '-';
        } else if (index % 3 === 1) {
          // 第2层：扩展连接
          color = secondaryColors[((index - 1) / 3) % secondaryColors.length];
          lw = 2.5;
          linestyle = '-';
        } else {
          // 第3层：辅助示意
          color = extensionColors[((index - 2) / 3) % extensionColors.length];
          lw = 2;
          linestyle = ':';
        }
      }

      // 检查是否有自定义样式
      if (lineStyles[key]) {
        const style = lineStyles[key];
        color = style.color || color;
        lw = style.lineWidth || lw;
        linestyle = style.lineStyle || linestyle;
      }

      // 使用映射后的Python兼容变量名
      lineCode += `ax.plot([${pointNameMap[line[0]]}[0], ${pointNameMap[line[1]]}[0]], [${pointNameMap[line[0]]}[1], ${pointNameMap[line[1]]}[1]], [${pointNameMap[line[0]]}[2], ${pointNameMap[line[1]]}[2]], color='${color}', linewidth=${lw}, linestyle='${linestyle}')\n`;
    });

    // 绘制辅助面（填充多边形）- 使用半透明颜色，与主体形成对比
    let planeCode = '';
    const planeColors = ['#e1bee7', '#bbdefb', '#c8e6c9', '#fff9c4', '#ffe0b2', '#b2ebf2'];
    auxiliaryPlanes.forEach((plane, index) => {
      const planeColor = planeColors[index % planeColors.length];
      // 使用映射后的变量名
      const planePoints = plane.points.map(p => pointNameMap[p] || p);
      if (planePoints.length >= 3) {
        const pointsArray = planePoints.map(p => `${p}[0], ${p}[1], ${p}[2]`).join(', ');
        planeCode += `# 辅助面：${plane.name || '未命名'}\n`;
        planeCode += `plane_points = np.array([[${pointsArray}]])\n`;
        planeCode += `from mpl_toolkits.mplot3d.art3d import Poly3DCollection\n`;
        planeCode += `poly = Poly3DCollection([plane_points], alpha=0.2, facecolor='${planeColor}', edgecolor='${auxiliaryLineColors[index % auxiliaryLineColors.length]}', linewidth=1.5, linestyle='--')\n`;
        planeCode += `ax.add_collection3d(poly)\n\n`;
      }
    });

    const scatterCode = points.map(p =>
      `ax.scatter(${p.x}, ${p.y}, ${p.z}, c='${primaryColors[0]}', s=80, edgecolors='white', linewidths=2)\nax.text(${p.x}+0.15, ${p.y}+0.15, ${p.z}+0.15, '${p.name}', fontsize=14, fontweight='bold', color='${primaryColors[0]}')`
    ).join('\n');

    // Emit the vertices and edges as a comment in the Python code for the 3D viewer
    const geoComment = `# 3D_GEOMETRY_DATA|${verticesDesc}|${edgesDesc}\n`;
    return geoComment + '```python\nimport matplotlib.pyplot as plt\nfrom mpl_toolkits.mplot3d import Axes3D\nimport numpy as np\n\nplt.rcParams[\'font.sans-serif\'] = [\'SimHei\', \'DejaVu Sans\']\nplt.rcParams[\'axes.unicode_minus\'] = False\n\nfig = plt.figure(figsize=(12, 8), facecolor=\'white\')\nax = fig.add_subplot(111, projection=\'3d\')\nax.set_facecolor(\'#fafafa\')\n\n' + pointCode + '\n\n# 基础线条\n' + lineCode + '\n# 辅助面\n' + planeCode + '\n# 散点 + 标注\n' + scatterCode + '\n\nax.set_title(\'' + title + '\', fontsize=16, fontweight=\'bold\', pad=20, color=\'#1a237e\')\nax.set_xlabel(\'X\', fontsize=13, fontweight=\'bold\', color=\'#37474f\')\nax.set_ylabel(\'Y\', fontsize=13, fontweight=\'bold\', color=\'#37474f\')\nax.set_zlabel(\'Z\', fontsize=13, fontweight=\'bold\', color=\'#37474f\')\nax.grid(True, linestyle=\'--\', alpha=0.4, color=\'#90a4ae\')\nax.view_init(elev=' + viewAngle[0] + ', azim=' + viewAngle[1] + ')\n\nplt.tight_layout()\nplt.savefig(\'/tmp/figure.png\', dpi=150, bbox_inches=\'tight\', facecolor=\'white\')\nprint("Done")\n```';
  }

  static generateFunctionCode(params, imageType) {
    const title = params.title || '数学图形';
    const equations = params.equations || ['y = x'];
    const colors = params.colors || ['blue'];
    const xRange = params.xRange || [-10, 10];
    const yRange = params.yRange || [-10, 10];
    const showGrid = params.showGrid !== undefined ? params.showGrid : true;
    const legend = params.legend || equations.map((_, i) => '曲线' + (i + 1));

    while (colors.length < equations.length) colors.push('blue');

    switch (imageType) {
      case 'MATH_DYNAMIC_GEOMETRY':
        return this.generateGeometryAnimationCode(params);
      case 'MATH_DYNAMIC_3D_GEOMETRY':  // 新增：3D几何动画类型
        return this.generateGeometryAnimationCode(params);
      case 'CHEMISTRY_CRYSTAL':
        return this.generateCrystalCode(params);
      case 'PHYSICS_ENGINE':
        return this.generatePhysicsCode(params);
      default:
        return this.generateStaticCode({ title, equations, colors, xRange, yRange, showGrid, legend });
    }
  }

  static generateStaticCode({ title, equations, colors, xRange, yRange, showGrid, legend }) {
    const plotLines = equations.map((eq, i) =>
      `y${i} = ${eq}\nax.plot(x, y${i}, color='${colors[i]}', label='${legend[i]}', linewidth=2)`
    ).join('\n');

    return '```python\nimport matplotlib.pyplot as plt\nimport numpy as np\n\nplt.rcParams[\'font.sans-serif\'] = [\'SimHei\', \'DejaVu Sans\']\nplt.rcParams[\'axes.unicode_minus\'] = False\n\nfig, ax = plt.subplots(figsize=(12, 8))\nx = np.linspace(' + xRange[0] + ', ' + xRange[1] + ', 1000)\n\n' + plotLines + '\n\nax.set_title(\'' + title + '\', fontsize=14, fontweight=\'bold\')\nax.set_xlabel(\'X\', fontsize=12)\nax.set_ylabel(\'Y\', fontsize=12)\nax.set_xlim(' + xRange[0] + ', ' + xRange[1] + ')\nax.set_ylim(' + yRange[0] + ', ' + yRange[1] + ')\n' + (showGrid ? 'ax.grid(True, linestyle=\'--\', alpha=0.7)\n' : '') + 'ax.legend(fontsize=12)\n\nplt.tight_layout()\nplt.savefig(\'/tmp/figure.png\', dpi=150, bbox_inches=\'tight\')\nprint("Done")\n```';
  }

  static generateGeometryAnimationCode(params) {
    const title = params.title || '几何动画演示';
    
    // 检查是否为球体
    const isSphere = params.geometryType === 'sphere' || params.shape === 'sphere' || 
                     (params.points && params.points.length === 1 && params.radius);
    
    if (isSphere) {
      // 球体动画生成
      const center = params.points?.[0] || { name: 'O', x: 0, y: 0, z: 0 };
      const radius = params.radius || 1;
      
      const animation = params.animation || { type: 'rotate_view', duration: 40 };
      
      let animCode = '';
      if (animation.type === 'rotate_view') {
        animCode = `
# 球体旋转视角动画
def update(frame):
    ax.view_init(elev=30, azim=frame * 9)
    return []

ani = animation.FuncAnimation(fig, update, frames=${animation.duration || 40}, interval=100, blit=True)
`;
      } else if (animation.type === 'grow') {
        animCode = `
# 球体生长动画
def update(frame):
    r = ${radius} * min(frame * 0.05, 1)
    ax.cla()
    u = np.linspace(0, 2 * np.pi, 100)
    v = np.linspace(0, np.pi, 100)
    x = ${center.x} + r * np.outer(np.cos(u), np.sin(v))
    y = ${center.y} + r * np.outer(np.sin(u), np.sin(v))
    z = ${center.z} + r * np.outer(np.ones(np.size(u)), np.cos(v))
    ax.plot_surface(x, y, z, color='#1a237e', alpha=0.6)
    ax.set_xlim(-${radius + 1}, ${radius + 1})
    ax.set_ylim(-${radius + 1}, ${radius + 1})
    ax.set_zlim(-${radius + 1}, ${radius + 1})
    ax.set_title('${title}', fontsize=16, fontweight='bold')
    return ax,

ani = animation.FuncAnimation(fig, update, frames=30, interval=100)
`;
      } else {
        animCode = `
def update(frame):
    return []

ani = animation.FuncAnimation(fig, update, frames=20, interval=100)
`;
      }
      
      return '```python\nimport matplotlib.pyplot as plt\nfrom mpl_toolkits.mplot3d import Axes3D\nimport matplotlib.animation as animation\nimport numpy as np\n\nplt.rcParams[\'font.sans-serif\'] = [\'SimHei\', \'DejaVu Sans\']\nplt.rcParams[\'axes.unicode_minus\'] = False\n\nfig = plt.figure(figsize=(12, 8), facecolor=\'white\')\nax = fig.add_subplot(111, projection=\'3d\')\nax.set_facecolor(\'#fafafa\')\n\n# 绘制球体\nu = np.linspace(0, 2 * np.pi, 100)\nv = np.linspace(0, np.pi, 100)\nx = ' + center.x + ' + ' + radius + ' * np.outer(np.cos(u), np.sin(v))\ny = ' + center.y + ' + ' + radius + ' * np.outer(np.sin(u), np.sin(v))\nz = ' + center.z + ' + ' + radius + ' * np.outer(np.ones(np.size(u)), np.cos(v))\nax.plot_surface(x, y, z, color=\'#1a237e\', alpha=0.6)\nax.scatter(' + center.x + ', ' + center.y + ', ' + center.z + ', c=\'#ff1744\', s=80, edgecolors=\'white\')\nax.text(' + center.x + '+0.1, ' + center.y + '+0.1, ' + center.z + '+0.1, \'' + center.name + '\', fontsize=12, fontweight=\'bold\')\n\nax.set_title(\'' + title + '\', fontsize=16, fontweight=\'bold\', pad=20, color=\'#1a237e\')\nax.set_xlabel(\'X\', fontsize=12, fontweight=\'bold\')\nax.set_ylabel(\'Y\', fontsize=12, fontweight=\'bold\')\nax.set_zlabel(\'Z\', fontsize=12, fontweight=\'bold\')\nax.set_xlim(-' + (radius + 1) + ', ' + (radius + 1) + ')\nax.set_ylim(-' + (radius + 1) + ', ' + (radius + 1) + ')\nax.set_zlim(-' + (radius + 1) + ', ' + (radius + 1) + ')\nax.grid(True, linestyle=\':\', alpha=0.4)\n\n' + animCode + '\n\nplt.tight_layout()\nani.save(\'/tmp/animation.gif\', writer=\'pillow\', fps=20, dpi=100)\nprint(\"Done\")\n```';
    }
    
    // 检查是否为圆形（2D）
    const isCircle = params.geometryType === 'circle' || params.shape === 'circle' ||
                    (params.center && params.radius);
    
    if (isCircle) {
      const center = params.center || { x: 0, y: 0 };
      const radius = params.radius || 1;
      
      return '```python\nimport matplotlib.pyplot as plt\nimport numpy as np\n\nplt.rcParams[\'font.sans-serif\'] = [\'SimHei\', \'DejaVu Sans\']\nplt.rcParams[\'axes.unicode_minus\'] = False\n\nfig, ax = plt.subplots(figsize=(12, 8))\nax.set_aspect(\'equal\')\nax.set_facecolor(\'#fafafa\')\n\n# 绘制圆形\ncircle = plt.Circle((' + center.x + ', ' + center.y + '), ' + radius + ', color=\'#1a237e\', fill=False, linewidth=3)\nax.add_artist(circle)\nax.scatter(' + center.x + ', ' + center.y + ', c=\'#ff1744\', s=60, edgecolors=\'white\')\nax.text(' + (center.x + 0.1) + ', ' + (center.y + 0.1) + ', \'O\', fontsize=12, fontweight=\'bold\')\n\nax.set_title(\'' + title + '\', fontsize=16, fontweight=\'bold\', pad=20, color=\'#1a237e\')\nax.set_xlabel(\'X\', fontsize=12, fontweight=\'bold\')\nax.set_ylabel(\'Y\', fontsize=12, fontweight=\'bold\')\nax.set_xlim(' + (center.x - radius - 1) + ', ' + (center.x + radius + 1) + ')\nax.set_ylim(' + (center.y - radius - 1) + ', ' + (center.y + radius + 1) + ')\nax.grid(True, linestyle=\':\', alpha=0.4)\n\nplt.tight_layout()\nplt.savefig(\'/tmp/figure.png\', dpi=150, bbox_inches=\'tight\')\nprint(\"Done\")\n```';
    }
    
    // 多面体处理（原有逻辑）
    const points = params.points || [
      { name: 'A', x: 0, y: 0, z: 0 },
      { name: 'B', x: 2, y: 0, z: 0 },
      { name: 'C', x: 0, y: 2, z: 0 },
      { name: 'D', x: 2, y: 2, z: 0 },
      { name: 'A1', x: 0, y: 0, z: 2 },
      { name: 'B1', x: 2, y: 0, z: 2 },
      { name: 'C1', x: 0, y: 2, z: 2 },
      { name: 'D1', x: 2, y: 2, z: 2 }
    ];
    
    // 根据点数动态生成线条
    const pointNames = points.map(p => p.name);
    let baseLines = [];
    
    if (pointNames.length === 4) {
      // 四面体：6条棱
      baseLines = [
        ['A', 'B'], ['A', 'C'], ['A', 'D'],
        ['B', 'C'], ['B', 'D'], ['C', 'D']
      ];
    } else if (pointNames.length === 6) {
      // 三棱柱：9条棱
      baseLines = [
        ['A', 'B'], ['B', 'C'], ['C', 'A'],  // 底面
        ['A1', 'B1'], ['B1', 'C1'], ['C1', 'A1'],  // 顶面
        ['A', 'A1'], ['B', 'B1'], ['C', 'C1']  // 侧棱
      ];
    } else if (pointNames.length === 8) {
      // 正方体/长方体：12条棱
      baseLines = [
        ['A', 'B'], ['B', 'D'], ['D', 'C'], ['C', 'A'],  // 底面
        ['A1', 'B1'], ['B1', 'D1'], ['D1', 'C1'], ['C1', 'A1'],  // 顶面
        ['A', 'A1'], ['B', 'B1'], ['C', 'C1'], ['D', 'D1']  // 侧棱
      ];
    } else if (params.lines && params.lines.length > 0) {
      // 使用用户提供的线条
      baseLines = params.lines;
    } else {
      // 默认使用前4个点形成四面体
      const availablePoints = pointNames.slice(0, 4);
      if (availablePoints.length >= 3) {
        baseLines = [
          [availablePoints[0], availablePoints[1]],
          [availablePoints[1], availablePoints[2]],
          [availablePoints[2], availablePoints[0]]
        ];
        if (availablePoints.length >= 4) {
          baseLines.push([availablePoints[0], availablePoints[3]]);
          baseLines.push([availablePoints[1], availablePoints[3]]);
          baseLines.push([availablePoints[2], availablePoints[3]]);
        }
      }
    }
    
    // 动画配置：描述动画类型和参数
    const animation = params.animation || {
      type: 'extend_line',  // 扩展线动画
      lines: [['A', 'B']],  // 要扩展的线
      extendDirection: 'x',  // 扩展方向
      maxExtend: 2,          // 最大扩展量
      speed: 0.05            // 动画速度
    };
    
    // 配色方案 - 与静图保持一致
    const primaryColor = '#1a237e';
    const highlightColor = '#ff1744';
    const extensionColor = '#ff9100';
    const auxiliaryColor = '#90caf9';
    
    // 创建点名称映射：将下标等特殊字符转换为Python兼容的变量名
    const pointNameMapAnim = {};
    const pointCodeAnim = points.map(p => {
      const pythonName = p.name
        .replace(/₀/g, '0')
        .replace(/₁/g, '1')
        .replace(/₂/g, '2')
        .replace(/₃/g, '3')
        .replace(/₄/g, '4')
        .replace(/₅/g, '5')
        .replace(/₆/g, '6')
        .replace(/₇/g, '7')
        .replace(/₈/g, '8')
        .replace(/₉/g, '9');
      pointNameMapAnim[p.name] = pythonName;
      return `${pythonName} = np.array([${p.x}, ${p.y}, ${p.z}])`;
    }).join('\n');
    
    let linePlotCode = '';
    baseLines.forEach((line, i) => {
      // 检查点是否存在，使用映射后的变量名
      if (pointNames.includes(line[0]) && pointNames.includes(line[1])) {
        const color = (i < Math.floor(baseLines.length / 3)) ? primaryColor : (i < Math.floor(baseLines.length * 2 / 3) ? '#3949ab' : '#7b1fa2');
        linePlotCode += `ax.plot([${pointNameMapAnim[line[0]]}[0], ${pointNameMapAnim[line[1]]}[0]], [${pointNameMapAnim[line[0]]}[1], ${pointNameMapAnim[line[1]]}[1]], [${pointNameMapAnim[line[0]]}[2], ${pointNameMapAnim[line[1]]}[2]], color='${color}', linewidth=2.5, linestyle='-')\n`;
      }
    });
    
    // 动画扩展线代码
    let animCode = '';
    
    // 将模糊的动画类型描述映射到具体类型
    const animType = animation?.type || '';
    let resolvedType = animType;
    
    // 映射中文描述到具体类型（更灵活的匹配）
    if (animType.includes('旋转') || animType.includes('视角') || animType.includes('观察')) {
      resolvedType = 'rotate_view';
    } else if (animType.includes('扩展') && animType.includes('边')) {
      resolvedType = 'extend_line';
    } else if (animType.includes('延长') || animType.includes('延伸')) {
      resolvedType = 'extend_line';
    } else if (animType.includes('扩展') && (animType.includes('面') || animType.includes('平面'))) {
      resolvedType = 'extend_plane';
    } else if (animType.includes('扩大') && animType.includes('面')) {
      resolvedType = 'extend_plane';
    } else if (animType.includes('高亮') || animType.includes('突出')) {
      resolvedType = 'highlight_plane';
    } else if (animType.includes('绘制') || animType.includes('画')) {
      resolvedType = 'draw_plane';
    } else if (animType.includes('移动') || animType.includes('平移')) {
      resolvedType = 'slide_move';
    }
    
    if (resolvedType === 'extend_line') {
      const [startPt, endPt] = animation.lines[0];
      // 使用映射后的变量名
      const startPtMapped = pointNameMapAnim[startPt] || startPt;
      const endPtMapped = pointNameMapAnim[endPt] || endPt;
      
      animCode = `
# 扩展线动画
extend_line, = ax.plot([], [], [], color='${extensionColor}', linewidth=3.5, linestyle='-')
extend_arrow = ax.annotate('', xy=(0, 0, 0), xytext=(0, 0, 0),
    arrowprops=dict(arrowstyle='->', color='${extensionColor}', lw=2))

def init():
    extend_line.set_data([], [])
    extend_line.set_3d_properties([])
    extend_arrow.xy = (0, 0, 0)
    extend_arrow.xytext = (0, 0, 0)
    return extend_line, extend_arrow

def update(frame):
    progress = frame * ${animation.speed}
    if progress > 1:
        progress = 1
    
    # 计算扩展线的终点
    x_ext = ${endPtMapped}[0] + (${endPtMapped}[0] - ${startPtMapped}[0]) * progress * 0.5
    y_ext = ${endPtMapped}[1] + (${endPtMapped}[1] - ${startPtMapped}[1]) * progress * 0.5
    z_ext = ${endPtMapped}[2]
    
    extend_line.set_data([${startPtMapped}[0], x_ext], [${startPtMapped}[1], y_ext])
    extend_line.set_3d_properties([${startPtMapped}[2], z_ext])
    
    extend_arrow.xy = (x_ext, y_ext)
    extend_arrow.xytext = (${endPtMapped}[0], ${endPtMapped}[1])
    
    return extend_line, extend_arrow

ani = animation.FuncAnimation(fig, update, frames=40, init_func=init, interval=100, blit=True)
`;
    } else if (resolvedType === 'rotate_view') {
      animCode = `
# 旋转视角动画
def update(frame):
    ax.view_init(elev=30, azim=frame * 9)
    return []

ani = animation.FuncAnimation(fig, update, frames=40, interval=100, blit=True)
`;
    } else if (resolvedType === 'highlight_plane') {
      // 使用映射后的变量名
      const p0 = pointNameMapAnim[points[0]?.name] || points[0]?.name || 'A';
      const p1 = pointNameMapAnim[points[1]?.name] || points[1]?.name || 'B';
      const p2 = pointNameMapAnim[points[2]?.name] || points[2]?.name || 'C';
      const p3 = pointNameMapAnim[points[3]?.name] || points[3]?.name || 'D';
      
      animCode = `
# 高亮平面动画
from mpl_toolkits.mplot3d.art3d import Poly3DCollection

# 定义平面顶点
verts = [
    [${p0}[0], ${p0}[1], ${p0}[2]],
    [${p1}[0], ${p1}[1], ${p1}[2]],
    [${p3}[0], ${p3}[1], ${p3}[2]],
    [${p2}[0], ${p2}[1], ${p2}[2]]
]

# 创建平面（初始透明）
plane = Poly3DCollection([verts], alpha=0, facecolor='${auxiliaryColor}', edgecolor='${primaryColor}', linewidth=2)
ax.add_collection3d(plane)

def init():
    plane.set_alpha(0)
    return ax,

def update(frame):
    # 计算透明度（0到0.4渐变）
    alpha = min(frame * 0.02, 0.4)
    plane.set_alpha(alpha)
    return ax,

ani = animation.FuncAnimation(fig, update, init_func=init, frames=20, interval=150, blit=False)
`;
    } else if (resolvedType === 'draw_plane') {
      // 绘制平面动画
      const p0 = pointNameMapAnim[points[0]?.name] || points[0]?.name || 'A';
      const p1 = pointNameMapAnim[points[1]?.name] || points[1]?.name || 'B';
      const p2 = pointNameMapAnim[points[2]?.name] || points[2]?.name || 'C';
      const p3 = pointNameMapAnim[points[3]?.name] || points[3]?.name || 'D';
      
      animCode = `
# 绘制平面动画
from mpl_toolkits.mplot3d.art3d import Poly3DCollection

# 定义平面顶点
verts = [
    [${p0}[0], ${p0}[1], ${p0}[2]],
    [${p1}[0], ${p1}[1], ${p1}[2]],
    [${p3}[0], ${p3}[1], ${p3}[2]],
    [${p2}[0], ${p2}[1], ${p2}[2]]
]

# 创建平面（初始透明）
plane = Poly3DCollection([verts], alpha=0, facecolor='${auxiliaryColor}', edgecolor='${primaryColor}', linewidth=2)
ax.add_collection3d(plane)

# 创建边界线
line1, = ax.plot([], [], [], color='${primaryColor}', linewidth=2)
line2, = ax.plot([], [], [], color='${primaryColor}', linewidth=2)
line3, = ax.plot([], [], [], color='${primaryColor}', linewidth=2)
line4, = ax.plot([], [], [], color='${primaryColor}', linewidth=2)

def init():
    line1.set_data([], [])
    line1.set_3d_properties([])
    line2.set_data([], [])
    line2.set_3d_properties([])
    line3.set_data([], [])
    line3.set_3d_properties([])
    line4.set_data([], [])
    line4.set_3d_properties([])
    plane.set_alpha(0)
    return line1, line2, line3, line4, plane

def update(frame):
    if frame < 6:
        # 画第一条边
        t = frame / 5.0
        line1.set_data([${p0}[0] + (${p1}[0] - ${p0}[0])*t], [${p0}[1] + (${p1}[1] - ${p0}[1])*t])
        line1.set_3d_properties([${p0}[2] + (${p1}[2] - ${p0}[2])*t])
    elif frame < 12:
        # 画第二条边
        t = (frame - 6) / 5.0
        line2.set_data([${p1}[0] + (${p3}[0] - ${p1}[0])*t], [${p1}[1] + (${p3}[1] - ${p1}[1])*t])
        line2.set_3d_properties([${p1}[2] + (${p3}[2] - ${p1}[2])*t])
    elif frame < 18:
        # 画第三条边
        t = (frame - 12) / 5.0
        line3.set_data([${p3}[0] + (${p2}[0] - ${p3}[0])*t], [${p3}[1] + (${p2}[1] - ${p3}[1])*t])
        line3.set_3d_properties([${p3}[2] + (${p2}[2] - ${p3}[2])*t])
    elif frame < 24:
        # 画第四条边
        t = (frame - 18) / 5.0
        line4.set_data([${p2}[0] + (${p0}[0] - ${p2}[0])*t], [${p2}[1] + (${p0}[1] - ${p2}[1])*t])
        line4.set_3d_properties([${p2}[2] + (${p0}[2] - ${p2}[2])*t])
    else:
        # 填充平面
        t = (frame - 24) / 5.0
        plane.set_alpha(min(t, 0.3))
    
    return line1, line2, line3, line4, plane

ani = animation.FuncAnimation(fig, update, init_func=init, frames=30, interval=100, blit=False)
`;
    } else if (resolvedType === 'extend_plane') {
      // 扩展平面动画
      const p0 = pointNameMapAnim[points[0]?.name] || points[0]?.name || 'A';
      const p1 = pointNameMapAnim[points[1]?.name] || points[1]?.name || 'B';
      const p2 = pointNameMapAnim[points[2]?.name] || points[2]?.name || 'C';
      const p3 = pointNameMapAnim[points[3]?.name] || points[3]?.name || 'D';
      
      animCode = `
# 扩展平面动画
from mpl_toolkits.mplot3d.art3d import Poly3DCollection

# 原始平面顶点
original_verts = [
    [${p0}[0], ${p0}[1], ${p0}[2]],
    [${p1}[0], ${p1}[1], ${p1}[2]],
    [${p3}[0], ${p3}[1], ${p3}[2]],
    [${p2}[0], ${p2}[1], ${p2}[2]]
]

# 创建平面
plane = Poly3DCollection([original_verts], alpha=0.3, facecolor='${auxiliaryColor}', edgecolor='${primaryColor}', linewidth=2)
ax.add_collection3d(plane)

def update(frame):
    # 计算扩展因子
    factor = 1 + frame * 0.05
    
    # 扩展后的顶点（以中心为基准向外扩展）
    cx = (${p0}[0] + ${p1}[0] + ${p2}[0] + ${p3}[0]) / 4
    cy = (${p0}[1] + ${p1}[1] + ${p2}[1] + ${p3}[1]) / 4
    cz = (${p0}[2] + ${p1}[2] + ${p2}[2] + ${p3}[2]) / 4
    
    extended_verts = [
        [cx + (${p0}[0] - cx) * factor, cy + (${p0}[1] - cy) * factor, cz + (${p0}[2] - cz) * factor],
        [cx + (${p1}[0] - cx) * factor, cy + (${p1}[1] - cy) * factor, cz + (${p1}[2] - cz) * factor],
        [cx + (${p3}[0] - cx) * factor, cy + (${p3}[1] - cy) * factor, cz + (${p3}[2] - cz) * factor],
        [cx + (${p2}[0] - cx) * factor, cy + (${p2}[1] - cy) * factor, cz + (${p2}[2] - cz) * factor]
    ]
    
    plane.set_verts([extended_verts])
    return ax,

ani = animation.FuncAnimation(fig, update, frames=20, interval=100, blit=False)
`;
    } else if (resolvedType === 'slide_move') {
      // 滑动移动动画
      animCode = `
# 滑动移动动画
def update(frame):
    # 沿Y轴正方向移动
    offset = frame * 0.05
    ax.set_xlim(-1 + offset, 4 + offset)
    ax.set_ylim(-1 + offset, 4 + offset)
    ax.set_zlim(-1 + offset, 3 + offset)
    return ax,

ani = animation.FuncAnimation(fig, update, frames=20, interval=100, blit=False)
`;
    } else {
      // 默认：旋转视角动画（最可靠的fallback）
      animCode = `
# 默认旋转视角动画
def update(frame):
    ax.view_init(elev=30, azim=frame * 9)
    return []

ani = animation.FuncAnimation(fig, update, frames=40, interval=100, blit=True)
`;
    }

    // scatterCode保留原始名称用于显示标签
    const scatterCode = points.map(p =>
      `ax.scatter(${p.x}, ${p.y}, ${p.z}, c='${primaryColor}', s=60, edgecolors='white', linewidths=1.5)\nax.text(${p.x}+0.1, ${p.y}+0.1, ${p.z}+0.1, '${p.name}', fontsize=11, fontweight='bold', color='${primaryColor}')`
    ).join('\n');

    return '```python\nimport matplotlib.pyplot as plt\nfrom mpl_toolkits.mplot3d import Axes3D\nimport matplotlib.animation as animation\nimport numpy as np\n\nplt.rcParams[\'font.sans-serif\'] = [\'SimHei\', \'DejaVu Sans\']\nplt.rcParams[\'axes.unicode_minus\'] = False\n\nfig = plt.figure(figsize=(12, 8), facecolor=\'white\')\nax = fig.add_subplot(111, projection=\'3d\')\nax.set_facecolor(\'#fafafa\')\n\n# 定义点坐标（使用Python兼容的变量名）\n' + pointCodeAnim + '\n\n# 绘制基础线条\n' + linePlotCode + '\n# 绘制点\n' + scatterCode + '\n\nax.set_title(\'' + title + '\', fontsize=16, fontweight=\'bold\', pad=20, color=\'#1a237e\')\nax.set_xlabel(\'X\', fontsize=12, fontweight=\'bold\')\nax.set_ylabel(\'Y\', fontsize=12, fontweight=\'bold\')\nax.set_zlabel(\'Z\', fontsize=12, fontweight=\'bold\')\nax.set_xlim(-1, 4)\nax.set_ylim(-1, 4)\nax.set_zlim(-1, 3)\nax.grid(True, linestyle=\':\', alpha=0.4)\n\n' + animCode + '\n\nplt.tight_layout()\nani.save(\'/tmp/animation.gif\', writer=\'pillow\', fps=20, dpi=100)\nprint("Done")\n```';
  }

  static generateAnimationCode(params) {
    const title = params.title || '动态几何演示';
    const equations = params.equations || ['np.sin(x + t * 0.1)'];
    const colors = params.colors || ['blue'];
    const mainEquation = equations[0] || 'np.sin(x + t * 0.1)';

    return '```python\nimport matplotlib.pyplot as plt\nimport matplotlib.animation as animation\nimport numpy as np\n\nplt.rcParams[\'font.sans-serif\'] = [\'SimHei\', \'DejaVu Sans\']\nplt.rcParams[\'axes.unicode_minus\'] = False\n\nfig, ax = plt.subplots(figsize=(12, 8))\nax.set_xlim(-10, 10)\nax.set_ylim(-10, 10)\nax.set_aspect(\'equal\')\nax.grid(True, linestyle=\'--\', alpha=0.7)\nax.set_title(\'' + title + '\', fontsize=14, fontweight=\'bold\')\n\nline, = ax.plot([], [], \'' + colors[0] + '\', linewidth=2)\npoint, = ax.plot([], [], \'ro\', markersize=8)\n\ndef init():\n    line.set_data([], [])\n    point.set_data([], [])\n    return line, point\n\ndef update(frame):\n    x = np.linspace(-10, 10, 1000)\n    t = frame\n    y = ' + mainEquation + '\n    line.set_data(x, y)\n    point.set_data([x[500]], [y[500]])\n    return line, point\n\nani = animation.FuncAnimation(fig, update, frames=100, init_func=init, interval=50, blit=True)\nani.save(\'/tmp/animation.gif\', writer=\'pillow\', fps=20)\nprint("Done")\n```';
  }

  static generateAbstractCode(params) {
    const title = params.title || '抽象概念可视化';
    return '```python\nimport matplotlib.pyplot as plt\nimport numpy as np\n\nplt.rcParams[\'font.sans-serif\'] = [\'SimHei\', \'DejaVu Sans\']\nplt.rcParams[\'axes.unicode_minus\'] = False\n\nfig, ax = plt.subplots(figsize=(12, 8))\nax.set_title(\'' + title + '\', fontsize=14, fontweight=\'bold\')\nax.set_xlabel(\'X\', fontsize=12)\nax.set_ylabel(\'Y\', fontsize=12)\nax.grid(True, linestyle=\'--\', alpha=0.7)\n\nx = np.linspace(-5, 5, 100)\nax.plot(x, x**2, \'r-\', label=\'quadratic\', linewidth=2)\nax.plot(x, np.exp(x), \'b-\', label=\'exponential\', linewidth=2)\nax.plot(x, np.log(np.abs(x) + 1), \'g-\', label=\'log\', linewidth=2)\n\nax.legend(fontsize=12)\nplt.tight_layout()\nplt.savefig(\'/tmp/figure.png\', dpi=150, bbox_inches=\'tight\')\nprint("Done")\n```';
  }

  static generateCrystalCode(params) {
    const title = params.title || '晶胞结构';
    return '```python\nimport matplotlib.pyplot as plt\nfrom mpl_toolkits.mplot3d import Axes3D\nimport numpy as np\n\nplt.rcParams[\'font.sans-serif\'] = [\'SimHei\', \'DejaVu Sans\']\nplt.rcParams[\'axes.unicode_minus\'] = False\n\nfig = plt.figure(figsize=(18, 6))\n\nax1 = fig.add_subplot(131, projection=\'3d\')\nax1.set_title(\'Crystal 3D\', fontsize=12)\nr = [0, 1]\nfor x in r:\n    for y in r:\n        for z in r:\n            ax1.scatter(x, y, z, c=\'blue\', s=100)\nax1.set_xlim(-0.5, 1.5)\nax1.set_ylim(-0.5, 1.5)\nax1.set_zlim(-0.5, 1.5)\n\nax2 = fig.add_subplot(132)\nax2.set_title(\'Front View\', fontsize=12)\nax2.set_aspect(\'equal\')\nax2.grid(True, linestyle=\'--\', alpha=0.7)\nfor x in r:\n    for y in r:\n        ax2.scatter(x, y, c=\'red\', s=100)\nax2.set_xlim(-0.5, 1.5)\nax2.set_ylim(-0.5, 1.5)\n\nax3 = fig.add_subplot(133)\nax3.set_title(\'Top View\', fontsize=12)\nax3.set_aspect(\'equal\')\nax3.grid(True, linestyle=\'--\', alpha=0.7)\nfor x in r:\n    for z in r:\n        ax3.scatter(x, z, c=\'green\', s=100)\nax3.set_xlim(-0.5, 1.5)\nax3.set_ylim(-0.5, 1.5)\n\nplt.tight_layout()\nplt.savefig(\'/tmp/figure.png\', dpi=150, bbox_inches=\'tight\')\nprint("Done")\n```';
  }

  static generatePhysicsCode(params) {
    const title = params.title || '物理模拟';
    return '```python\nimport matplotlib.pyplot as plt\nimport numpy as np\n\nplt.rcParams[\'font.sans-serif\'] = [\'SimHei\', \'DejaVu Sans\']\nplt.rcParams[\'axes.unicode_minus\'] = False\n\ng = 9.8\nv0 = 20\ntheta = 45\n\nfig, (ax1, ax2) = plt.subplots(1, 2, figsize=(16, 8))\n\nax1.set_xlim(0, 50)\nax1.set_ylim(0, 25)\nax1.grid(True, linestyle=\'--\', alpha=0.7)\nax1.set_title(\'' + title + ' - Trajectory\', fontsize=14, fontweight=\'bold\')\nax1.set_xlabel(\'Distance (m)\', fontsize=12)\nax1.set_ylabel(\'Height (m)\', fontsize=12)\n\nt = np.linspace(0, 3, 100)\nx = v0 * np.cos(np.radians(theta)) * t\ny = v0 * np.sin(np.radians(theta)) * t - 0.5 * g * t**2\nax1.plot(x, y, \'b-\', linewidth=2, label=\'trajectory\')\nax1.legend(fontsize=12)\n\nax2.set_xlabel(\'Time (s)\', fontsize=12)\nax2.set_ylabel(\'Velocity (m/s)\', fontsize=12)\nax2.set_title(\'Velocity\', fontsize=14, fontweight=\'bold\')\nax2.grid(True, linestyle=\'--\', alpha=0.7)\n\nvx = v0 * np.cos(np.radians(theta)) * np.ones_like(t)\nvy = v0 * np.sin(np.radians(theta)) - g * t\nax2.plot(t, vx, \'r-\', label=\'vx\', linewidth=2)\nax2.plot(t, vy, \'g-\', label=\'vy\', linewidth=2)\nax2.legend(fontsize=12)\n\nplt.tight_layout()\nplt.savefig(\'/tmp/figure.png\', dpi=150, bbox_inches=\'tight\')\nprint("Done")\n```';
  }

  // ==================== 第三层：合成最终答案 ====================
  static async thirdLayerLLM(stepResults) {
    let finalAnswer = '';
    const images = [];

    console.log('[ThirdLayer] stepResults count:', stepResults.length);
    for (const step of stepResults) {
      console.log(`[ThirdLayer] step ${step.id}: hasImageData=${!!step.imageData} imageDataLen=${step.imageData?.length || 0}`);
      if (step.imageData) {
        finalAnswer += '### 步骤 ' + step.id + '\n\n';
        finalAnswer += '[IMAGE:' + step.id + ']\n\n';
        images.push({ stepId: step.id, imageData: step.imageData, imageType: step.executionResult?.imageType || 'png' });
        finalAnswer += step.description + '\n\n';
      } else {
        finalAnswer += '### 步骤 ' + step.id + '\n\n';
        finalAnswer += step.description + '\n\n';
      }
    }

    return { finalAnswer, images };
  }

  // ==================== 提取动画参数 ====================
  static async extractAnimationParams(stepDescription, previousParams = null) {
    const systemPrompt = [
      '你是一个几何动画设计专家。请分析解题步骤，设计合适的动画来帮助理解几何概念。',
      '',
      '【核心任务】',
      '理解解题步骤中描述的几何操作，设计一个清晰、直观的动画来演示这个过程。',
      '',
      '【输出格式】',
      '请输出JSON格式，包含以下字段：',
      '- title: 动画标题（简洁描述动画内容）',
      '- geometryType: 几何体类型（可选，如 "sphere"、"circle" 等）',
      '- points: 关键点坐标数组，每个点包含 name、x、y、z',
      '- radius: 半径（用于圆形、球体等）',
      '- center: 中心点坐标（用于圆形、球体等）',
      '- animation: 动画配置对象',
      '  - type: 动画类型（描述动画效果，如 "旋转"、"扩展"、"高亮"、"绘制"、"移动" 等）',
      '  - target: 动画目标（可以是点、线、面的名称或描述）',
      '  - direction: 动画方向（可选）',
      '  - duration: 动画持续帧数（建议20-60）',
      '',
      '【设计原则】',
      '1. 动画应该清晰展示几何变换过程',
      '2. 选择最能帮助理解的视角和速度',
      '3. 可以自由选择合适的动画方式，不限于特定类型',
      '4. 如果有前一步的参数，保持坐标一致性',
      '',
      '【示例】',
      '{"title": "观察几何体", "points": [{"name":"A","x":0,"y":0,"z":0},...], "animation": {"type": "旋转", "duration": 40}}',
      '',
      '请发挥创意，设计最适合教学的动画效果。',
    ].join('\n');

    let userPrompt = [
      '请分析以下解题步骤，设计一个合适的动画来演示几何变换过程。',
      '',
      '解题步骤：',
      stepDescription,
    ];

    if (previousParams) {
      userPrompt.push('');
      userPrompt.push('参考坐标（如果适用）：');
      userPrompt.push(JSON.stringify(previousParams, null, 2));
    }

    userPrompt.push('');
    userPrompt.push('请输出JSON格式的动画参数。');

    const messages = [{ role: 'user', content: userPrompt.join('\n') }];
    console.log('[extractAnimationParams] Calling DeepSeek...');
    const result = await this.callLLMChat(messages, systemPrompt);
    console.log('[extractAnimationParams] Raw response:', result?.substring(0, 500));

    try {
      const jsonMatch = result.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const params = JSON.parse(jsonMatch[0]);
        return this.generateGeometryAnimationCode(params);
      }
      throw new Error('No JSON found in animation params response');
    } catch (e) {
      console.error('动画参数解析失败:', e.message, '原始响应:', result?.substring(0, 300));
      // 默认返回旋转视角动画
      return this.generateGeometryAnimationCode({
        title: '几何动画演示',
        points: [
          { name: 'A', x: 0, y: 0, z: 0 },
          { name: 'B', x: 2, y: 0, z: 0 },
          { name: 'C', x: 0, y: 2, z: 0 },
          { name: 'D', x: 2, y: 2, z: 0 },
          { name: 'A1', x: 0, y: 0, z: 2 },
          { name: 'B1', x: 2, y: 0, z: 2 },
          { name: 'C1', x: 0, y: 2, z: 2 },
          { name: 'D1', x: 2, y: 2, z: 2 }
        ],
        animation: {
          type: 'rotate_view',
          duration: 40
        }
      });
    }
  }

  // ==================== 对话标题生成 ====================
  static async generateConversationTitle(messages) {
    const systemPrompt = '你是一个标题生成助手。请根据对话内容生成一个简洁的对话标题，不超过20个字。';
    const messagesText = messages.map(m => m.role + ': ' + m.content).join('\n');
    const responseMessages = [
      { role: 'user', content: '请为以下对话生成一个简洁的标题（不超过20个字）：\n\n' + messagesText }
    ];
    const result = await this.callLLMChat(responseMessages, systemPrompt);
    return result.trim().replace(/["""'']/g, '');
  }

  static getTemplates() {
    return PROMPT_TEMPLATES;
  }
}

module.exports = LLMService;
