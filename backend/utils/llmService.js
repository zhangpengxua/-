const axios = require('axios');
require('dotenv').config();

const DEEPSEEK_API_URL = process.env.DEEPSEEK_API_URL;
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;

// ==================== 提示词模板定义 ====================
const PROMPT_TEMPLATES = {
  FIRST_LAYER: {
    NO_IMAGE: 'NO_IMAGE',
    NEED_IMAGE: 'NEED_IMAGE'
  },
  SECOND_LAYER: {
    MATH_STATIC_EQUATION: 'MATH_STATIC_EQUATION',
    MATH_DYNAMIC_GEOMETRY: 'MATH_DYNAMIC_GEOMETRY',
    MATH_STATIC_ABSTRACT: 'MATH_STATIC_ABSTRACT',
    CHEMISTRY_CRYSTAL: 'CHEMISTRY_CRYSTAL',
    PHYSICS_ENGINE: 'PHYSICS_ENGINE',
    DEFAULT: 'DEFAULT'
  }
};

class LLMService {
  static async callDeepSeek(messages, systemPrompt = '', maxTokens = 4096) {
    try {
      const requestBody = {
        model: 'deepseek-chat',
        messages: [
          { role: 'system', content: systemPrompt || 'You are a helpful assistant.' },
          ...messages
        ],
        max_tokens: maxTokens,
        temperature: 0.7
      };

      const response = await axios.post(DEEPSEEK_API_URL, requestBody, {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${DEEPSEEK_API_KEY}`
        },
        timeout: 180000
      });

      return response.data.choices[0].message.content;
    } catch (error) {
      console.error('DeepSeek API Error:', error.response?.data || error.message);
      throw error;
    }
  }

  // ==================== JSON 解析与验证 ====================
  static VALID_IMAGE_TYPES = [
    'NO_IMAGE', 'MATH_STATIC_EQUATION', 'MATH_DYNAMIC_GEOMETRY',
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

  // ==================== 第一层：生成解题步骤 ====================
  static async firstLayerLLM(context, userInput) {
    const systemPrompt = [
      '你是一位资深理科教师。给出详尽、准确、无幻觉的解题过程。',

      '## 杜绝幻觉',
      '1. 禁止编造数据。题目未给的条件不得杜撰，假设需标注"假设…"',
      '2. 每步标注依据（定理/公式/条件）',
      '3. 不确定时列出多种可能并说明适用条件',

      '## 步骤格式',
      '每步 description 包含四段（简洁扼要，不要过长）：',
      '① 目标（一行）',
      '② 依据',
      '③ 计算过程（只列关键推导，不要逐行展开每个代数变换）',
      '④ 结果',

      '**长度控制：每个步骤的 description 总共不超过150字。summary 不超过80字。**',

      '## 图像决策',
      '以下情况 needImage=true：',
      '- 函数图像（一次/二次/指数/对数/三角）→ MATH_STATIC_EQUATION',
      '- 几何/空间图形（平面几何/立体几何/向量/坐标系）→ MATH_STATIC_ABSTRACT',
      '- 动态过程（动点轨迹/图形变换）→ MATH_DYNAMIC_GEOMETRY',
      '- 物理运动/力学 → PHYSICS_ENGINE',
      '- 化学晶胞/分子结构 → CHEMISTRY_CRYSTAL',
      '仅纯代数运算/纯逻辑推理时 needImage=false。默认优先生成图。',

      '## 输出',
      '纯JSON，不要markdown包裹。',
      '{"steps":[{"id":1,"description":"① 目标：…\\n② 依据：…\\n③ 计算过程：…\\n④ 结果：…","needImage":true,"imageType":"MATH_STATIC_EQUATION"}],"summary":"…"}',
      'imageType: NO_IMAGE | MATH_STATIC_EQUATION | MATH_DYNAMIC_GEOMETRY | MATH_STATIC_ABSTRACT | CHEMISTRY_CRYSTAL | PHYSICS_ENGINE',
    ].join('\n');

    const messages = [
      {
        role: 'user',
        content: `${context ? '对话上下文：\n' + context + '\n\n' : ''}请解答以下问题。每个步骤必须包含目标、依据、详细计算过程和结果。只要涉及图形/函数/几何/物理/化学内容，务必标记为需要生成图像。\n\n问题：${userInput}`
      }
    ];

    const MAX_RETRIES = 2;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      const result = await this.callDeepSeek(messages, systemPrompt);

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
  static async secondLayerLLM(stepDescription, imageType) {
    if (imageType === 'MATH_STATIC_ABSTRACT' || imageType === 'MATH_DYNAMIC_GEOMETRY') {
      return this.extractGeometryParams(stepDescription, imageType);
    } else {
      return this.extractFunctionParams(stepDescription, imageType);
    }
  }

  // ==================== 提取几何参数 ====================
  static async extractGeometryParams(stepDescription, imageType) {
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
      '- viewAngle: 3D视角 [elevation, azimuth]，如[30, 45]',
      '',
      '常见几何体默认参考（仅在题目未给数值时使用）：',
      '- 正方体：8个顶点，12条棱，6个面，默认边长2',
      '- 正四面体：4个顶点，6条棱',
      '- 三棱柱：6个顶点，9条棱',
    ].join('\n');

    const userPrompt = [
      '请根据以下解题步骤中的几何信息，提取精确的绘图参数。',
      '',
      '解题步骤：' + stepDescription,
      '',
      '图像类型：' + (imageType === 'MATH_DYNAMIC_GEOMETRY' ? '动态几何（动图）' : '静态几何（3D/2D图形）'),
      '',
      '请输出JSON格式的几何参数。如果步骤中有具体顶点名称和位置关系，必须精确反映。',
    ].join('\n');

    const messages = [{ role: 'user', content: userPrompt }];
    const result = await this.callDeepSeek(messages, systemPrompt);

    try {
      const jsonMatch = result.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const params = JSON.parse(jsonMatch[0]);
        return this.generateGeometryCode(params, imageType);
      }
      return JSON.parse(result);
    } catch (parseError) {
      console.error('几何参数解析失败:', parseError.message);
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
  static async extractFunctionParams(stepDescription, imageType) {
    const systemPrompt = [
      '你是一个函数参数提取专家。请根据题目描述提取函数绘图所需的参数。',
      '',
      '准则：',
      '1. 仅基于题目给出的函数/数据提取参数',
      '2. 方程表达式使用Python/numpy语法（如 y = x**2, y = np.sin(x), y = np.exp(x)）',
      '3. 坐标范围要能清晰展示函数的关键特征（交点、极值点、渐近线等）',
      '4. 输出仅包含JSON对象，无其他文字',
      '',
      '参数说明：',
      '- title: 图形标题',
      '- equations: 函数表达式数组 ["y = x**2", "y = 2*x + 1"]',
      '- colors: 颜色数组，与equations对应 ["red", "blue", "green", "orange", "purple"]',
      '- xRange: x轴范围 [min, max]',
      '- yRange: y轴范围 [min, max]',
      '- showGrid: 是否显示网格（true/false）',
      '- legend: 图例标签数组 ["抛物线", "直线"]',
      '',
      '范围选择指南：',
      '- 一次/二次函数：xRange默认[-10, 10]',
      '- 三角函数：xRange默认[-2*pi, 2*pi] 即约[-6.28, 6.28]',
      '- 指数函数：xRange默认[-3, 3]',
      '- 物理题：根据实际物理量范围设定',
    ].join('\n');

    const typeName = imageType === 'MATH_STATIC_EQUATION' ? '函数图像（解析式）'
      : imageType === 'CHEMISTRY_CRYSTAL' ? '化学晶胞'
      : imageType === 'PHYSICS_ENGINE' ? '物理模拟'
      : '默认图形';

    const userPrompt = [
      '请根据以下解题步骤提取函数绘图参数。',
      '',
      '解题步骤：' + stepDescription,
      '',
      '图像类型：' + typeName,
      '',
      '请输出JSON格式的参数。',
    ].join('\n');

    const messages = [{ role: 'user', content: userPrompt }];
    const result = await this.callDeepSeek(messages, systemPrompt);

    try {
      const jsonMatch = result.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const params = JSON.parse(jsonMatch[0]);
        return this.generateFunctionCode(params, imageType);
      }
      return JSON.parse(result);
    } catch (parseError) {
      console.error('函数参数解析失败:', parseError.message);
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

    const pointCode = points.map(p => `${p.name} = (${p.x}, ${p.y}, ${p.z})`).join('\n');

    let lineCode = '';
    lines.forEach((line) => {
      const key = line.join('-');
      const color = highlightLines.includes(key) ? 'red' : 'blue';
      const lw = highlightLines.includes(key) ? 3 : 2;
      lineCode += `ax.plot([${line[0]}[0], ${line[1]}[0]], [${line[0]}[1], ${line[1]}[1]], [${line[0]}[2], ${line[1]}[2]], color='${color}', linewidth=${lw})\n`;
    });

    const scatterCode = points.map(p =>
      `ax.scatter(${p.x}, ${p.y}, ${p.z}, c='black', s=50)\nax.text(${p.x}+0.1, ${p.y}+0.1, ${p.z}+0.1, '${p.name}', fontsize=12)`
    ).join('\n');

    return '```python\nimport matplotlib.pyplot as plt\nfrom mpl_toolkits.mplot3d import Axes3D\nimport numpy as np\n\nplt.rcParams[\'font.sans-serif\'] = [\'SimHei\', \'DejaVu Sans\']\nplt.rcParams[\'axes.unicode_minus\'] = False\n\nfig = plt.figure(figsize=(12, 8))\nax = fig.add_subplot(111, projection=\'3d\')\n\n' + pointCode + '\n\n' + lineCode + '\n' + scatterCode + '\n\nax.set_title(\'' + title + '\', fontsize=14, fontweight=\'bold\')\nax.set_xlabel(\'X\', fontsize=12)\nax.set_ylabel(\'Y\', fontsize=12)\nax.set_zlabel(\'Z\', fontsize=12)\nax.grid(True, linestyle=\'--\', alpha=0.7)\nax.view_init(elev=' + viewAngle[0] + ', azim=' + viewAngle[1] + ')\n\nplt.tight_layout()\nplt.savefig(\'/tmp/figure.png\', dpi=150, bbox_inches=\'tight\')\nprint("Done")\n```';
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
        return this.generateAnimationCode(params);
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

    for (const step of stepResults) {
      if (step.imageData) {
        finalAnswer += '### 步骤 ' + step.id + '\n\n';
        finalAnswer += '[IMAGE:' + step.id + ']\n\n';
        images.push({ stepId: step.id, imageData: step.imageData });
        finalAnswer += step.description + '\n\n';
      } else {
        finalAnswer += '### 步骤 ' + step.id + '\n\n';
        finalAnswer += step.description + '\n\n';
      }
    }

    return { finalAnswer, images };
  }

  // ==================== 对话标题生成 ====================
  static async generateConversationTitle(messages) {
    const systemPrompt = '你是一个标题生成助手。请根据对话内容生成一个简洁的对话标题，不超过20个字。';
    const messagesText = messages.map(m => m.role + ': ' + m.content).join('\n');
    const responseMessages = [
      { role: 'user', content: '请为以下对话生成一个简洁的标题（不超过20个字）：\n\n' + messagesText }
    ];
    const result = await this.callDeepSeek(responseMessages, systemPrompt);
    return result.trim().replace(/["""'']/g, '');
  }

  static getTemplates() {
    return PROMPT_TEMPLATES;
  }
}

module.exports = LLMService;
