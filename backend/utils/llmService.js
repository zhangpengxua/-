const axios = require('axios');
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;
const DEEPSEEK_API_URL = process.env.DEEPSEEK_API_URL || 'https://api.deepseek.com/chat/completions';
const DEEPSEEK_MODEL = process.env.DEEPSEEK_MODEL || 'deepseek-flash';

// ==================== Prompt template definitions ====================
const PROMPT_TEMPLATES = {
  FIRST_LAYER: { NO_IMAGE: 'NO_IMAGE', NEED_IMAGE: 'NEED_IMAGE' },
  SECOND_LAYER: {
    MATH_STATIC_EQUATION: 'MATH_STATIC_EQUATION',
    MATH_DYNAMIC_GEOMETRY: 'MATH_DYNAMIC_GEOMETRY',
    MATH_DYNAMIC_3D_GEOMETRY: 'MATH_DYNAMIC_3D_GEOMETRY',
    MATH_STATIC_ABSTRACT: 'MATH_STATIC_ABSTRACT',
    MATH_STATIC_SURFACE: 'MATH_STATIC_SURFACE',
    MATH_STATIC_2D_FUNCTION: 'MATH_STATIC_2D_FUNCTION',
    MATH_STATIC_IMPLICIT: 'MATH_STATIC_IMPLICIT',
    CHEMISTRY_CRYSTAL: 'CHEMISTRY_CRYSTAL',
    PHYSICS_ENGINE: 'PHYSICS_ENGINE',
    DEFAULT: 'DEFAULT'
  }
};

class LLMService {
  static _lastGeometryParams = null;

  // ==================== 常量池 & 点位池 ====================
  static FUNCTION_POOL = {
    "Formula_1": { latex: "u = e^{xy^2} + \\ln(x + y + z^2)", category: "多元显式超越复合函数", dimension: "3D" },
    "Formula_2": { latex: "f(x) = \\frac{5x - 12}{x^2 + 5x - 6}", category: "有理分式函数", dimension: "2D", singularities: [1, -6] },
    "Formula_3": { latex: "f(x) = \\begin{cases} \\frac{1+x^2}{x}\\arctan x & x \\neq 0 \\\\ 1 & x = 0 \\end{cases}", category: "可去间断点修补型超越分段函数", dimension: "2D" },
    "Formula_4": { latex: ["x - e^u - u\\sin v = 0", "y - e^u + u\\sin v = 0"], category: "二维非线性隐式方程组", dimension: "3D" },
    "Formula_5": { latex: "(2x\\cos y+y^2\\cos x)dx+(2y\\sin x-x^2\\sin y)dy", category: "全微分单连通守恒向量场", dimension: "3D" },
    "Formula_6": { latex: "y' - y = x y^5", category: "一阶非线性伯努利常微分方程", dimension: "2D" },
    "Formula_7": { latex: "y'' - y = \\frac{e^{2x}}{1+e^x} + \\cos x", category: "复杂非齐次强迫振动常微分方程", dimension: "2D" },
    "Formula_8": { latex: "z = |y - x^2|", category: "绝对值非光滑复合面", dimension: "3D", crease_line: "y = x^2" },
    "Formula_9": { latex: "f(x) = \\pi^2 - x^2", category: "周期延拓常规余弦傅里叶源", dimension: "2D", domain: [-3.14159, 3.14159] },
  };

  static POINT_POOL = {
    "Slot_Point_1": { coordinates: [1, -1, 1], target: "Formula_1", desc: "三维全微分极值斜率高亮锚定中心点" },
    "Slot_Cylinder_2D": { implicit: "x^2 + y^2 - ax = 0", polar: "r = a\\cos\\theta", desc: "二维非圆心对称偏心截取圆柱面边界" },
    "Slot_Sphere_3D": { inequality: "x^2 + y^2 + z^2 - 2z \\le 0", center: [0, 0, 1], radius: 1, desc: "底部紧贴原点的纵向偏心空间球体" },
    "Slot_Parallel_Tangents": { constraint: "x - y + 2z = 0", ellipsoid: "x^2 + 2y^2 + z^2 = 1", desc: "椭球面平行切平面" },
    "Slot_Rectangular_Area": { bounds: { x: [-1, 1], y: [0, 2] }, cutting: "y = x^2", desc: "被抛物线横穿裁剪的对称二维有界闭区域" },
    "Slot_Torus_Closed": { equation: "(\\sqrt{x^2+y^2} - b)^2 + z^2 = a^2", desc: "空间封闭式救生圈型环面" },
  };

  // ==================== LLM API 调用 ====================
  static logCall(type, model, promptLen) {
    console.log(`[LLM:${type}] model=${model} promptLen=${promptLen}`);
  }

  static async callLLMChat(messages, systemPrompt = '', maxTokens = 4096, options = {}) {
    this.logCall('chat', DEEPSEEK_MODEL, (systemPrompt + JSON.stringify(messages)).length);
    return this._callLLM(messages, systemPrompt, maxTokens, options);
  }

  static async callLLMImage(messages, systemPrompt = '', maxTokens = 4096, options = {}) {
    this.logCall('multimodal', DEEPSEEK_MODEL, (systemPrompt + JSON.stringify(messages)).length);
    return this._callLLM(messages, systemPrompt, maxTokens, options);
  }

  // 结构化调用：options 支持向下兼容扩展（signal/timeoutMs/temperature/taskType），
  // 学习分析、出题、批改等新流程通过 taskType 区分日志，且不再输出正文预览。
  static async callLLMStructured(messages, systemPrompt = '', maxTokens = 8192, options = {}) {
    this.logCall(options.taskType || 'structured', DEEPSEEK_MODEL, (systemPrompt + JSON.stringify(messages)).length);
    return this._callLLM(messages, systemPrompt, maxTokens, {
      thinking: { type: 'disabled' },
      responseFormat: { type: 'json_object' },
      ...options,
    });
  }

  static getModelName() {
    return DEEPSEEK_MODEL;
  }

  static async _callLLM(messages, systemPrompt = '', maxTokens = 4096, options = {}) {
    try {
      const msgs = systemPrompt ? [{ role: 'system', content: systemPrompt }, ...messages] : [...messages];
      const body = {
        model: DEEPSEEK_MODEL,
        messages: msgs,
        max_tokens: maxTokens,
        temperature: options.temperature === undefined ? 0.7 : options.temperature,
      };
      if (options.thinking) body.thinking = options.thinking;
      if (options.responseFormat) body.response_format = options.responseFormat;

      const response = await axios.post(DEEPSEEK_API_URL, body, {
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${DEEPSEEK_API_KEY}` },
        timeout: options.timeoutMs || 180000, maxRedirects: 5,
        signal: options.signal,
      });
      const choice = response.data?.choices?.[0];
      const content = choice?.message?.content;
      const finishReason = choice?.finish_reason || 'unknown';
      const reasoningLength = choice?.message?.reasoning_content?.length || 0;
      if (options.taskType) {
        // 新流程日志只记录任务类型、耗时与字符量，不输出正文内容。
        console.log(
          `[LLM:${options.taskType}] model=${DEEPSEEK_MODEL} finish=${finishReason} contentLen=${content?.length || 0}`
        );
      } else {
        console.log(
          `[LLM:${DEEPSEEK_MODEL}] finish=${finishReason} contentLen=${content?.length || 0} reasoningLen=${reasoningLength}`,
          'First 200 chars:', content?.substring(0, 200)
        );
      }
      if (typeof content !== 'string' || !content.trim()) {
        const emptyError = new Error(
          `DeepSeek 未返回可用正文 (finish_reason=${finishReason}, reasoning_length=${reasoningLength})`
        );
        emptyError.code = 'LLM_EMPTY_CONTENT';
        throw emptyError;
      }
      return content;
    } catch (error) {
      const detail = error.response?.data;
      console.error(`[LLM:${DEEPSEEK_MODEL}] API Error:`, JSON.stringify(detail || error.message));
      throw error;
    }
  }

  // 将上游 Axios 异常映射为业务错误码；认证类错误不可重试。
  static classifyError(error) {
    if (!error) return { code: 'LLM_UPSTREAM_ERROR', retryable: true, message: '模型调用失败' };
    if (error.code === 'ERR_CANCELED' || error.name === 'CanceledError' || error.name === 'AbortError') {
      return { code: 'CANCELLED', retryable: false, message: '请求已被取消' };
    }
    if (error.code === 'ECONNABORTED') {
      return { code: 'LLM_TIMEOUT', retryable: true, message: '模型请求超时' };
    }
    const status = error.response?.status;
    if (status === 401 || status === 403) {
      return { code: 'LLM_UPSTREAM_ERROR', retryable: false, message: '模型服务认证失败，请检查 API Key' };
    }
    if (status === 429) {
      return { code: 'LLM_UPSTREAM_ERROR', retryable: true, message: '模型服务限流，请稍后重试' };
    }
    if (status >= 500) {
      return { code: 'LLM_UPSTREAM_ERROR', retryable: true, message: '模型服务暂时不可用' };
    }
    return { code: 'LLM_UPSTREAM_ERROR', retryable: true, message: error.message || '模型调用失败' };
  }

  // ==================== JSON 解析与验证 ====================
  static VALID_IMAGE_TYPES = [
    'NO_IMAGE', 'MATH_STATIC_EQUATION', 'MATH_DYNAMIC_GEOMETRY',
    'MATH_DYNAMIC_3D_GEOMETRY', 'MATH_STATIC_ABSTRACT',
    'MATH_STATIC_SURFACE', 'MATH_STATIC_2D_FUNCTION', 'MATH_STATIC_IMPLICIT',
    'CHEMISTRY_CRYSTAL', 'PHYSICS_ENGINE'
  ];

  static tryExtractJSON(text) {
    let raw = text.trim();
    raw = raw.replace(/^```(?:json)?\s*\n?/gi, '').replace(/\n?```\s*$/gi, '');
    const firstBrace = raw.indexOf('{');
    if (firstBrace === -1) return null;
    let depth = 0, inStr = false, esc = false;
    for (let i = firstBrace; i < raw.length; i++) {
      const ch = raw[i];
      if (esc) { esc = false; continue; }
      if (ch === '\\') { esc = true; continue; }
      if (ch === '"') { inStr = !inStr; continue; }
      if (inStr) continue;
      if (ch === '{') depth++;
      else if (ch === '}') { depth--; if (depth === 0) { raw = raw.slice(firstBrace, i + 1); break; } }
    }
    let s = raw;
    s = s.replace(/,(\s*[}\]])/g, '$1');
    s = s.replace(/([{,]\s*)([a-zA-Z_]\w*)(\s*:)/g, '$1"$2"$3');
    s = s.replace(/:\s*([a-zA-Z_][^,\[\]{}"]*?)(\s*[,}\]])/g, (m, v, d) => {
      const trimmed = v.trimEnd();
      if (trimmed === 'true' || trimmed === 'false' || trimmed === 'null' || /^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(trimmed)) return m;
      if (/^[A-Z_]+$/.test(trimmed)) return ':"' + trimmed + '"' + d;
      return m;
    });
    const NLH = '\x00NL\x00';
    s = s.replace(/\\n/g, NLH).replace(/(?<!\\)\\([a-zA-Z])/g, '\\\\$1').replace(new RegExp(NLH.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), '\\n');
    try { return JSON.parse(s); } catch (e1) {
      try {
        const NL = '\x00NL\x00';
        let fb = raw.replace(/,(\s*[}\]])/g, '$1').replace(/([{,]\s*)([a-zA-Z_]\w*)(\s*:)/g, '$1"$2"$3')
          .replace(/\\n/g, NL).replace(/(?<!\\)\\([a-zA-Z])/g, '\\\\$1')
          .replace(new RegExp(NL.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), '\\n');
        return JSON.parse(fb);
      } catch (e2) { return null; }
    }
  }

  static validateAndFixFirstLayerResult(result) {
    if (!result || typeof result !== 'object' || !Array.isArray(result.steps)) return null;
    const fixedSteps = [];
    for (let i = 0; i < result.steps.length; i++) {
      const step = result.steps[i];
      if (!step || typeof step !== 'object') continue;
      const needImage = typeof step.needImage === 'boolean' ? step.needImage : (step.needImage === 'true' || step.needImage === 'True' || step.needImage === true);
      const fixed = {
        id: typeof step.id === 'number' ? step.id : (i + 1),
        description: typeof step.description === 'string' && step.description.trim() ? step.description.trim() : `步骤 ${i + 1}`,
        needImage,
        imageType: 'NO_IMAGE',
      };
      if (typeof step.imageType === 'string') {
        const trimmed = step.imageType.trim().toUpperCase();
        if (this.VALID_IMAGE_TYPES.includes(trimmed)) fixed.imageType = trimmed;
        else if (needImage) fixed.imageType = 'MATH_STATIC_EQUATION';
      }
      if (fixed.needImage && fixed.imageType === 'NO_IMAGE') fixed.imageType = 'MATH_STATIC_EQUATION';
      if (!fixed.needImage) fixed.imageType = 'NO_IMAGE';
      if (step.drawingData && typeof step.drawingData === 'object') fixed.drawingData = step.drawingData;
      fixedSteps.push(fixed);
    }
    if (fixedSteps.length === 0) return null;
    return { steps: fixedSteps, summary: typeof result.summary === 'string' ? result.summary : '' };
  }

  static GEO_SURFACE_TYPES = ['MATH_STATIC_ABSTRACT', 'MATH_DYNAMIC_GEOMETRY', 'MATH_DYNAMIC_3D_GEOMETRY'];

  /** 校验立体几何 drawingData 是否包含完整面方程（不自动补全，仅用于提示词重试） */
  static validateDrawingDataSurfaces(steps) {
    const issues = [];
    for (const step of steps) {
      if (!step.needImage || !this.GEO_SURFACE_TYPES.includes(step.imageType)) continue;
      const dd = step.drawingData;
      if (!dd || typeof dd !== 'object') {
        issues.push(`步骤${step.id}：imageType=${step.imageType} 但缺少 drawingData`);
        continue;
      }
      const planes = Array.isArray(dd.planes) ? dd.planes : [];
      const functions = Array.isArray(dd.functions) ? dd.functions : [];
      const text = (step.description || '') + JSON.stringify(dd);

      const pointExploration = dd.interaction?.bindings?.some(b=>typeof b.path === 'string' && b.path.startsWith('points.')) && !/圆锥|圆台|圆柱|棱锥|棱柱|球体|立方体/.test(step.description || '');
      if (planes.length === 0 && functions.length === 0 && !pointExploration) {
        issues.push(`步骤${step.id}：立体几何不能只输出点线，必须填写 planes（平面外表面）和/或 functions（曲面外表面）`);
      }

      planes.forEach((pl, i) => {
        if (!pl || typeof pl !== 'object') {
          issues.push(`步骤${step.id} planes[${i}]：无效对象`);
          return;
        }
        if (!pl.equation && (!pl.normal || !pl.point)) {
          issues.push(`步骤${step.id} planes[${i}]（${pl.name || '未命名'}）：缺少 equation 或 normal+point`);
        }
        if (!pl.bounds && pl.type !== 'disk' && !pl.radius) {
          issues.push(`步骤${step.id} planes[${i}]（${pl.name || '未命名'}）：缺少 bounds`);
        }
        if (pl.type === 'disk' || /圆|disk/i.test(pl.name || '')) {
          if (pl.radius == null && !pl.boundary) {
            issues.push(`步骤${step.id} planes[${i}]（${pl.name || '圆面'}）：缺少 radius 或 boundary（如 x^2+y^2=4）`);
          }
          if (!pl.normal || !pl.point) {
            issues.push(`步骤${step.id} planes[${i}]（${pl.name || '圆面'}）：缺少 normal 和 point`);
          }
        }
      });

      if (/圆台|截头圆锥|frustum/i.test(text) && planes.length < 2) {
        issues.push(`步骤${step.id}：圆台须至少 2 个 planes（上底圆面+下底圆面），含 equation/normal/point/radius/bounds`);
      }
      if (/圆台|截头圆锥|frustum/i.test(text)) {
        const hasLateral = functions.some(f => f && (f.type === 'parametric' || /侧/.test(f.name || '')));
        if (!hasLateral) {
          issues.push(`步骤${step.id}：圆台侧面须用 functions 参数方程（type=parametric, exprU/exprV/exprW, paramU/paramV）`);
        }
      }
    }

    if (issues.length === 0) return { ok: true };
    return {
      ok: false,
      retryMessage: [
        'drawingData 外表面数据不完整。前端不会自动推断平面，请补全后重新输出纯 JSON：',
        ...issues.map(s => `- ${s}`),
        '',
        '圆台下底面示例：{"name":"下底圆面","type":"disk","equation":"z=0","boundary":"x^2+y^2=4","normal":[0,0,1],"point":[0,0,0],"radius":2,"bounds":[[-2,2],[-2,2]]}',
        '圆台侧面示例：{"name":"侧面","type":"parametric","exprU":"(2*(1-v)+1*v)*cos(u)","exprV":"(2*(1-v)+1*v)*sin(u)","exprW":"3*v","paramU":["u",0,6.283185],"paramV":["v",0,1]}',
      ].join('\n'),
    };
  }

  // ==================== 第一层：拆解题步骤 + 提取结构化数据 ====================
  static async firstLayerLLM(context, userInput, imageBase64 = null) {
    const systemPrompt = [
      require('fs').readFileSync(require('path').join(__dirname, '../prompts/interactive-scene.txt'), 'utf8'),
      '你是一位资深理科教师。给出详尽、准确、无幻觉的解题过程。',
      '',
      '## 🔹 题目类型分类（第一步：判定题型）',
      '首先判断题目类型，从以下30个细分题型中匹配：',
      '1. 多元显函数全微分 | 2. 隐函数方程组求偏导 | 3. 全微分反求原函数',
      '4. 旋转曲面截面积 | 5. 偏心区域三重积分 | 6. 绝对值二重积分',
      '7. 球面对称曲面积分 | 8. 投影半球面第二类曲面积分 | 9. 旋转曲面第二类曲面积分',
      '10. 格林公式挖洞法 | 11. 抽象函数曲面积分证明 | 12. 高斯公式法',
      '13. 全微分求未知函数 | 14. 路径无关曲线积分 | 15. 可分离变量微分方程',
      '16. 伯努利方程 | 17. 二阶齐次特征根 | 18. 待定系数法',
      '19. 常数变易法 | 20. 由解反求方程 | 21. 错位相减法',
      '22. 交错级数敛散性 | 23. 反例构造 | 24. 幂级数收敛域',
      '25. 逐项积微分求和 | 26. 反三角函数幂级数展开 | 27. 傅里叶展开',
      '28. 抽象傅里叶级数 | 29. 级数积分交织 | 30. 基础概念教学',
      '',
      '**分类匹配规则：**',
      '- 如果题目匹配上述题型 → 按对应题型模板生成步骤',
      '- 如果题目不匹配任何题型 → 直接提取公式和结构化数据到 drawingData',
      '',
      '## 🔹 常量池（函数模板）',
      '当题目未给定具体函数/参数时，从以下池中选取：',
      'Formula_1: u = e^{xy^2} + ln(x + y + z^2)    [多元超越函数, 3D]',
      'Formula_2: f(x) = (5x-12)/(x^2+5x-6)         [有理分式, 2D]',
      'Formula_4: x=e^u+u sin v, y=e^u-u sin v       [隐式方程组, 3D]',
      'Formula_8: z = |y - x^2|                       [绝对值面, 3D]',
      '',
      '## 🔹 点位池（几何模板）',
      '当题目未给定具体坐标/区域时，从以下池中选取：',
      'Slot_Point_1: (1,-1,1) → 配合Formula_1',
      'Slot_Cylinder_2D: x^2+y^2=ax                   [偏心圆柱面]',
      'Slot_Sphere_3D: x^2+y^2+z^2≤2z, center(0,0,1) [偏心球体]',
      '',
      '## 杜绝幻觉',
      '1. 禁止编造数据。题目未给的条件不得杜撰',
      '2. 每步标注依据（定理/公式/条件）',
      '3. 动词用"设"、"解得"、"得"、"因为"、"所以"、"故"',
      '',
      '## 步骤格式',
      '每步 description 详细且结构化：',
      '- **粗体** 强调关键概念和定理',
      '- 数学公式用 $...$ 包裹成完整表达式',
      '每个步骤的 description 总共不超过300字。summary 不超过100字。',
      '',
      '## ⚠️ 重要：你的角色是"数据提取者"',
      '你不会画画，也不需要生成任何图像。你的唯一任务是：',
      '1. 分析题目 → 拆分为解题步骤（纯文本描述）',
      '2. 判断每个步骤是否需要配图 → 设置 needImage / imageType',
      '3. 如果需要配图，提取该步骤的**结构化几何/函数数据**输出到 drawingData',
      '4. drawingData 会由前端数值计算引擎直接渲染——你完全不参与渲染过程',
      '',
      '## 图像决策',
      'needImage=true 的情况：',
      '- 2D函数图像 → MATH_STATIC_2D_FUNCTION',
      '- 3D曲面(z=f(x,y)、隐式曲面) → MATH_STATIC_SURFACE',
      '- 隐式方程(平面/曲线/曲面) → MATH_STATIC_IMPLICIT',
      '- 几何/空间图形(立体几何/向量/坐标系) → MATH_STATIC_ABSTRACT',
      '- 一般函数图像 → MATH_STATIC_EQUATION',
      '- 动态过程 → MATH_DYNAMIC_GEOMETRY',
      '- 3D动态 → MATH_DYNAMIC_3D_GEOMETRY',
      '仅纯代数运算/纯文字逻辑推理时 needImage=false',
      '',
      '## ⚠️ 立体几何：你必须完整输出外表面（禁止只输出点线）',
      '前端**不会**根据点线自动推断平面或侧面，一切面方程必须由你在 drawingData 中显式给出。',
      '立体图形（棱柱/棱锥/圆台/圆柱/球体等）配图时，drawingData 必须包含：',
      '- points + lines：顶点和棱',
      '- **planes**：所有平面外表面（底面、顶面、侧面若为平面），每项字段齐全',
      '- **functions**：所有曲面外表面（圆台侧面、球面、圆柱侧面等）',
      '',
      '### planes 每项必填字段',
      '- name: 面名称（如"下底圆面"）',
      '- type: "flat"（矩形平面）或 "disk"（圆盘面）',
      '- equation: 平面解析式（如 z=0, x=1, x+y+z=4）',
      '- normal: [nx,ny,nz] 法向量',
      '- point: [px,py,pz] 平面上一点（通常取圆心或顶点）',
      '- bounds: [[uMin,uMax],[vMin,vMax]] 该面在局部坐标下的绘制范围',
      '- 圆盘面额外必填: radius（半径）和 boundary（如 x^2+y^2=4）',
      '',
      '### functions 曲面项必填字段',
      '- name, type 必须为 "parametric" | "implicit" | "explicit" 之一',
      '- **parametric（圆台侧面/旋转曲面）**: 必须写 exprU, exprV, exprW（分别对应 x,y,z），以及 paramU, paramV。不要写在 expr 字段里',
      '- **explicit（z=f(x,y)）**: expr 写 f(x,y) 或 z=f(x,y)，附 xRange/yRange',
      '- **implicit（球面/圆锥等）**: expr 写 F(x,y,z)=0 形式（如 x^2+y^2+z^2=4），附 xRange/yRange/zRange',
      '',
      '### 圆台完整模板（R=下底半径, r=上底半径, h=高，以题目数值为准）',
      '"planes": [',
      '  {"name":"下底圆面","type":"disk","equation":"z=0","boundary":"x^2+y^2=R^2","normal":[0,0,1],"point":[0,0,0],"radius":R,"bounds":[[-R,R],[-R,R]]},',
      '  {"name":"上底圆面","type":"disk","equation":"z=h","boundary":"x^2+y^2=r^2","normal":[0,0,1],"point":[0,0,h],"radius":r,"bounds":[[-r,r],[-r,r]]}',
      '],',
      '"functions": [',
      '  {"name":"侧面","type":"parametric","exprU":"(R*(1-v)+r*v)*cos(u)","exprV":"(R*(1-v)+r*v)*sin(u)","exprW":"h*v","paramU":["u",0,6.283185],"paramV":["v",0,1],"color":"#4d96ff","opacity":0.6}',
      ']',
      '将 R,r,h 替换为题目中的具体数值（如 R=2,r=1,h=3），不得省略 planes。',
      '',
      '### 棱柱/棱锥模板',
      '每个平面多边形面一条 planes 记录：equation + normal + point + bounds（bounds 覆盖该面顶点范围）。',
      '示例底面：{"name":"底面ABCD","type":"flat","equation":"z=0","normal":[0,0,1],"point":[0,0,0],"bounds":[[-2,2],[-2,2]]}',
      '',
      '### 常见错误（禁止）',
      '- ❌ 只输出 points 和 lines，planes 为空数组',
      '- ❌ 圆台面只写 equation:"z=0" 却缺少 radius/bounds/normal/point',
      '- ❌ 用算法猜测的浮点半径（必须从题目条件计算后写入精确值）',
      '- ❌ 圆台侧面放进 planes（侧面是曲面，应放 functions）',
      '',
      '## 输出格式',
      '纯JSON，不要markdown包裹。',
      '{',
      '  "steps": [{',
      '    "id": 1,',
      '    "description": "**Step 1: ...**\\n\\n详细内容...",',
      '    "needImage": true,',
      '    "imageType": "MATH_STATIC_ABSTRACT",',
      '    "drawingData": {',
      '      "dimension": "3D",',
      '      "type": "static",',
      '      "points": [{"name":"A","x":2,"y":0,"z":0},{"name":"B","x":0,"y":2,"z":0}],',
      '      "lines": [["A","B"]],',
      '      "planes": [{"name":"底面","type":"disk","equation":"z=0","boundary":"x^2+y^2=4","normal":[0,0,1],"point":[0,0,0],"radius":2,"bounds":[[-2,2],[-2,2]],"color":"#90caf9","opacity":0.3}],',
      '      "functions": [{"expr":"x^2 + y^2","type":"explicit","vars":["x","y"],"xRange":[-2,2],"yRange":[-2,2],"color":"#4d96ff","resolution":50}]',
      '    }',
      '  }],',
      '  "summary": "最终答案总结"',
      '}',
      'imageType: NO_IMAGE | MATH_STATIC_EQUATION | MATH_STATIC_2D_FUNCTION | MATH_STATIC_SURFACE | MATH_STATIC_IMPLICIT | MATH_STATIC_ABSTRACT | MATH_DYNAMIC_GEOMETRY | MATH_DYNAMIC_3D_GEOMETRY | CHEMISTRY_CRYSTAL | PHYSICS_ENGINE',
    ].join('\n');

    const requestText = `${context ? '对话上下文：\n' + context + '\n\n' : ''}请按以下要求处理问题：\n\n1. **解题步骤**：给出详细的解题步骤文本，使用Markdown和LaTeX。\n2. **图像判断**：判断哪些步骤需要配图，设置 needImage 和 imageType。\n3. **数据提取**：需要配图的步骤，提取结构化几何/函数数据到 drawingData（坐标、点、线、面、方程）。\n\n注意：你不需要画图。你只负责提取数据，渲染由前端引擎完成。\n\n**图像类型选择指南：**\n- 2D函数曲线(y=f(x))→ MATH_STATIC_2D_FUNCTION\n- 3D曲面(z=f(x,y),隐式曲面)→ MATH_STATIC_SURFACE\n- 隐式方程(平面/曲线)→ MATH_STATIC_IMPLICIT\n- 3D几何体(棱柱/棱锥等)→ MATH_STATIC_ABSTRACT\n- 一般方程/坐标系绘图→ MATH_STATIC_EQUATION\n- 动画/动点轨迹→ MATH_DYNAMIC_GEOMETRY\n- 3D动画/旋转→ MATH_DYNAMIC_3D_GEOMETRY\n\n**drawingData 必须同时输出 points + lines + planes + functions**。\n**立体几何禁止只输出点线**：planes 须含完整 equation+normal+point+bounds（圆面加 radius+boundary），曲面侧面放 functions。\n**前端不会自动补面，遗漏则无法渲染**。\n\n问题：${userInput}`;
    const userContent = imageBase64
      ? [
          { type: 'text', text: requestText },
          {
            type: 'image_url',
            image_url: {
              url: imageBase64.startsWith('data:image/')
                ? imageBase64
                : `data:image/png;base64,${imageBase64}`,
              detail: 'high',
            },
          },
        ]
      : requestText;
    const messages = [{ role: 'user', content: userContent }];

    const MAX_RETRIES = 2;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      const result = await this.callLLMStructured(messages, systemPrompt);
      const parsed = this.tryExtractJSON(result);
      if (!parsed) {
        if (attempt < MAX_RETRIES) {
          messages.push({ role: 'assistant', content: result });
          messages.push({ role: 'user', content: '你的输出无法被JSON解析器解析。请只输出纯JSON对象。' });
          continue;
        }
        return { steps: [{ id: 1, description: userInput, needImage: false, imageType: 'NO_IMAGE' }], summary: '直接回答用户问题' };
      }
      const fixed = this.validateAndFixFirstLayerResult(parsed);
      if (!fixed) {
        if (attempt < MAX_RETRIES) {
          messages.push({ role: 'assistant', content: result });
          messages.push({ role: 'user', content: '你的JSON格式不正确。必须包含"steps"数组，每个步骤必须有id(数字)、description(字符串)、needImage(布尔值)、imageType。请修正后重新输出。' });
          continue;
        }
        return { steps: [{ id: 1, description: userInput, needImage: false, imageType: 'NO_IMAGE' }], summary: '直接回答用户问题' };
      }
      const surfaceCheck = this.validateDrawingDataSurfaces(fixed.steps);
      if (!surfaceCheck.ok) {
        console.warn('[firstLayerLLM] drawingData 面方程不完整:', surfaceCheck.retryMessage);
        if (attempt < MAX_RETRIES) {
          messages.push({ role: 'assistant', content: result });
          messages.push({ role: 'user', content: surfaceCheck.retryMessage });
          continue;
        }
      }
      const interactionIssues = [];
      if (/(截面.*(变化|移动|高度)|动点|滑块|拖动|参数.*变化)/.test(userInput) && fixed.steps.some(s=>s.needImage) && !fixed.steps.some(s=>s.drawingData?.interaction)) {
        interactionIssues.push('题目要求动态探索，请在相关配图步骤补充 interaction 参数、绑定和指标');
      }
      for (const step of fixed.steps) {
        try { require('../../frontend/src/utils/parameterScene.mjs').prepareScene(step.drawingData); }
        catch (e) { interactionIssues.push(`步骤${step.id}: ${e.message}`); }
      }
      if (interactionIssues.length) {
        if (attempt < MAX_RETRIES) {
          messages.push({role:'assistant',content:result},{role:'user',content:`请修复交互关系并返回完整JSON：${interactionIssues.join('；')}`});
          continue;
        }
        // Preserve the valid static scene; the UI reports unavailable interaction.
        for (const step of fixed.steps) if (step.drawingData) step.drawingData.interactionError = '交互关系校验未通过';
      }
      return fixed;
    }
    return { steps: [{ id: 1, description: userInput, needImage: false, imageType: 'NO_IMAGE' }], summary: '直接回答用户问题' };
  }

  // ==================== 第二层：已废弃Python代码生成，所有渲染由前端完成 ====================
  static async secondLayerLLM(stepDescription, imageType, previousParams = null) {
    console.log('[secondLayerLLM] SKIPPED - all rendering now handled by frontend mathjs engine');
    return null;
  }

  // ==================== 提取几何参数（仅提取结构化数据，不生成代码） ====================
  static async extractGeometryParams(stepDescription, imageType, previousParams = null) {
    console.log('[extractGeometryParams] imageType:', imageType, 'desc:', stepDescription?.substring(0, 100));
    const systemPrompt = [
      '你是一个几何/3D建模参数提取专家。请根据题目描述精确提取结构化的几何参数。',
      '这些数据会被前端Three.js引擎自动渲染成3D图形。你不会生成图像，你只需要输出结构化的几何数据。',
      '输出仅包含JSON对象，无其他文字。',
      '',
      '参数说明：',
      '- title: 图形标题',
      '- points: 关键顶点坐标数组 [{"name":"A","x":0,"y":0,"z":0}, ...]',
      '- lines: 棱/边数组 [["A","B"],["B","C"],...]',
      '- planes: 面数组 [{"name":"底面","points":["A","B","C","D"],"equation":"z=0","normal":[0,0,1],"bounds":[[-3,3],[-3,3]],"color":"#90caf9","opacity":0.3},...]',
      '- functions: 函数列表 [{"expr":"x^2+y^2","type":"explicit","vars":["x","y"],"xRange":[-2,2],"yRange":[-2,2],"color":"#4d96ff","resolution":50}]',
      '- auxiliaryLines: 辅助线数组',
      '- viewAngle: 3D视角 [elevation, azimuth]',
    ].join('\n');

    const messages = [{ role: 'user', content: '请从以下解题步骤中提取几何数据。\n解题步骤：' + stepDescription }];
    const result = await this.callLLMStructured(messages, systemPrompt);
    try {
      const jsonMatch = result.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const params = JSON.parse(jsonMatch[0].replace(/\\n/g, '\x00NL\x00').replace(/(?<!\\)\\([a-zA-Z])/g, '\\\\$1').replace(/\x00NL\x00/g, '\\n'));
        this._lastGeometryParams = params;
        return params;
      }
    } catch (e) { console.error('几何参数解析失败:', e.message); }
    return null;
  }

  // ==================== 提取曲面参数（仅提取结构化数据） ====================
  static async extractSurfaceParams(stepDescription, imageType, previousParams = null) {
    const systemPrompt = '你是一个3D曲面参数提取专家。请从题目描述中提取曲面数据。输出仅包含JSON对象。参数：title, surfaceType, surfaceEquation, xRange, yRange, zRange, resolution, points, planes, viewAngle';
    const result = await this.callLLMStructured([{ role: 'user', content: '请提取曲面数据。\n' + stepDescription }], systemPrompt, 4000);
    return this.tryExtractJSON(result);
  }

  // ==================== 提取2D函数图像参数（仅提取结构化数据） ====================
  static async extractFunctionPlotParams(stepDescription, imageType, previousParams = null) {
    const systemPrompt = '你是一个2D函数图像参数提取专家。请从题目描述中提取函数数据。输出仅包含JSON对象。参数：title, functions[{expr,color,label,lineStyle}], xRange, yRange, points, showGrid, showLegend';
    const result = await this.callLLMStructured([{ role: 'user', content: '请提取2D函数数据。\n' + stepDescription }], systemPrompt, 4000);
    return this.tryExtractJSON(result);
  }

  // ==================== 提取函数参数（仅提取结构化数据） ====================
  static async extractFunctionParams(stepDescription, imageType, previousParams = null) {
    const systemPrompt = '你是一个函数参数提取专家。请根据题目描述提取函数数据。输出仅包含JSON对象。参数：title, functions[{expr,color,label,type}], xRange, yRange, showGrid, showLegend';
    const messages = [{ role: 'user', content: '请提取函数数据。\n' + stepDescription }];
    const result = await this.callLLMStructured(messages, systemPrompt, 4000);
    try {
      const jsonMatch = result.match(/\{[\s\S]*\}/);
      if (jsonMatch) return JSON.parse(jsonMatch[0].replace(/\\n/g, '\x00NL\x00').replace(/(?<!\\)\\([a-zA-Z])/g, '\\\\$1').replace(/\x00NL\x00/g, '\\n'));
    } catch (e) { console.error('函数参数解析失败:', e.message); }
    return null;
  }

  // ==================== 函数池富化（LLM无法提取函数时的fallback） ====================

  /**
   * 使用函数计算方式判断函数类型（不硬编码具体函数名）
   * 根据 latex 表达式内容和维度自动推断类型
   */
  static _determineFunctionType(latex, dimension) {
    const expr = Array.isArray(latex) ? latex[0] : String(latex || '');

    // 数组类型 → 隐式方程组
    if (Array.isArray(latex)) return 'implicit';

    // 微分方程/微分形式（含 y', y'', dy/dx, dx, dy）
    if (/['']|\\frac\{d[^}]*\}\{d[^}]*\}|d[xzy]\b/.test(expr)) return 'differential';

    // 3D 维度：检测是否含 z=, u= 等显式形式
    if (dimension === '3D') {
      if (/^[a-zA-Z]\s*=/.test(expr)) return 'explicit';
      return 'implicit';
    }

    // 2D 维度默认显式
    return 'explicit';
  }

  static enrichWithFunctionPool(drawingData, stepDescription) {
    if (!drawingData) drawingData = {};
    const hasFunctions = drawingData.functions && drawingData.functions.length > 0;
    if (hasFunctions) return drawingData;

    const desc = (stepDescription || '').toLowerCase();
    const functionMatches = [];
    for (const [key, func] of Object.entries(this.FUNCTION_POOL)) {
      if (desc.includes(func.category?.toLowerCase() || '') || desc.includes(key.toLowerCase()))
        functionMatches.push({ key, ...func });
    }
    if (functionMatches.length > 0) {
      drawingData.functions = functionMatches
        .map(f => {
          const type = this._determineFunctionType(f.latex, f.dimension);
          if (type === 'differential') return null;
          return {
            expr: Array.isArray(f.latex) ? f.latex[0] : f.latex,
            name: f.key,
            type,
            category: f.category,
            dimension: f.dimension,
          };
        })
        .filter(Boolean);
    }
    const hasPoints = drawingData.points && drawingData.points.length > 0;
    if (!hasPoints && drawingData.dimension === '3D') {
      const pointMatches = [];
      for (const [key, pt] of Object.entries(this.POINT_POOL)) {
        if (desc.includes(key.toLowerCase()) || desc.includes(pt.desc?.toLowerCase() || ''))
          pointMatches.push({ key, ...pt });
      }
      if (pointMatches.length > 0 && pointMatches[0].coordinates) {
        drawingData.points = pointMatches[0].coordinates.map((coord, i) => ({
          name: `P${i + 1}`, x: coord[0], y: coord[1], z: coord[2] || 0,
        }));
      }
    }
    return drawingData;
  }

  // ==================== 第三层：合成最终答案 ====================
  static async thirdLayerLLM(stepResults) {
    let finalAnswer = '';
    const images = [];
    for (const step of stepResults) {
      if (step.imageData) {
        finalAnswer += '### 步骤 ' + step.id + '\n\n[IMAGE:' + step.id + ']\n\n' + step.description + '\n\n';
        images.push({ stepId: step.id, imageData: step.imageData, imageType: step.executionResult?.imageType || 'png' });
      } else {
        finalAnswer += '### 步骤 ' + step.id + '\n\n' + step.description + '\n\n';
      }
    }
    return { finalAnswer, images };
  }

  // ==================== 对话标题生成 ====================
  static async generateConversationTitle(messages) {
    const systemPrompt = '你是一个标题生成助手。请根据对话内容生成一个简洁的对话标题，不超过20个字。';
    const messagesText = messages.map(m => m.role + ': ' + m.content).join('\n');
    const result = await this.callLLMChat(
      [{ role: 'user', content: '请为以下对话生成一个简洁的标题（不超过20个字）：\n\n' + messagesText }],
      systemPrompt,
      128,
      { thinking: { type: 'disabled' } }
    );
    return result.trim().replace(/["""'']/g, '');
  }

  static getTemplates() {
    return PROMPT_TEMPLATES;
  }
}

module.exports = LLMService;
