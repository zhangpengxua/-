const axios = require('axios');
require('dotenv').config();

const DEEPSEEK_API_URL = process.env.DEEPSEEK_API_URL;
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;

// ==================== 提示词模板定义 ====================
const PROMPT_TEMPLATES = {
  // 第一层：是否需要图像辅助
  FIRST_LAYER: {
    NO_IMAGE: 'NO_IMAGE',
    NEED_IMAGE: 'NEED_IMAGE'
  },
  
  // 第二层：图像类型选择
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
          {
            role: 'system',
            content: systemPrompt || 'You are a helpful assistant.'
          },
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
        timeout: 180000 // 3分钟超时
      });

      return response.data.choices[0].message.content;
    } catch (error) {
      console.error('DeepSeek API Error:', error.response?.data || error.message);
      throw error;
    }
  }

  // ==================== 第一层：生成解题步骤（纯文字） ====================
  static async firstLayerLLM(context, userInput) {
    const systemPrompt = `你是一个专业的数学解题助手。请分析用户的问题，并生成详细的解题步骤。

**重要要求：**
1. 每个步骤必须是纯文字描述，不要包含任何代码
2. 步骤需要清晰、有序、逻辑性强
3. 对于每个步骤，判断是否需要图形辅助理解
4. 输出必须是严格的JSON格式

**输出格式：**
{
  "steps": [
    {
      "id": 1,
      "description": "第一步的详细文字描述，解释要做什么",
      "needImage": false,
      "imageType": "NO_IMAGE"
    },
    {
      "id": 2,
      "description": "第二步的详细文字描述",
      "needImage": true,
      "imageType": "MATH_STATIC_EQUATION"
    }
  ],
  "summary": "问题的整体分析和解题思路"
}

**imageType可选值：**
- NO_IMAGE: 不需要图像
- MATH_STATIC_EQUATION: 数学静态图形（有明确解析式）
- MATH_DYNAMIC_GEOMETRY: 数学动态图形（几何描述，可操纵动图）
- MATH_STATIC_ABSTRACT: 数学静态图形（抽象函数/定义类）
- CHEMISTRY_CRYSTAL: 化学晶胞模型（分子结构、晶胞截面）
- PHYSICS_ENGINE: 物理模拟引擎（基础物理模拟）

**注意：**
- 只有当步骤确实需要图形辅助理解时，才设置needImage为true
- 大部分步骤可能不需要图形
- 输出必须是有效的JSON格式，不要有任何额外的文字`;

    const messages = [
      {
        role: 'user',
        content: `${context ? `上下文信息：\n${context}\n\n` : ''}用户问题：${userInput}\n\n请分析上述问题，给出详细的解题步骤。`
      }
    ];

    const result = await this.callDeepSeek(messages, systemPrompt);
    try {
      // 尝试提取JSON
      const jsonMatch = result.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }
      return JSON.parse(result);
    } catch (parseError) {
      console.error('第一层JSON解析失败:', parseError.message);
      return { 
        steps: [{ 
          id: 1, 
          description: userInput, 
          needImage: false, 
          imageType: 'NO_IMAGE' 
        }],
        summary: '直接回答用户问题'
      };
    }
  }

  // ==================== 第二层：根据步骤生成绘图参数（改进版） ====================
  static async secondLayerLLM(stepDescription, imageType) {
    // 根据图像类型选择不同的提示词策略
    if (imageType === 'MATH_STATIC_ABSTRACT' || imageType === 'MATH_DYNAMIC_GEOMETRY') {
      // 几何问题：提取几何参数
      return this.extractGeometryParams(stepDescription, imageType);
    } else {
      // 函数问题：提取函数参数
      return this.extractFunctionParams(stepDescription, imageType);
    }
  }

  // ==================== 提取几何参数 ====================
  static async extractGeometryParams(stepDescription, imageType) {
    const systemPrompt = `你是一个几何参数提取专家。请根据几何问题描述提取绘图所需的参数，仅输出JSON格式。
    
**输出格式要求：**
- 必须是有效的JSON格式
- 不要包含任何解释性文字
- 只输出JSON对象

**几何参数说明：**
- title: 图形标题（字符串）
- points: 关键点坐标数组，如 [{"name": "A", "x": 0, "y": 0, "z": 0}, {"name": "B", "x": 1, "y": 0, "z": 0}]
- lines: 线段数组，如 [["A", "B"], ["B", "C"]]
- planes: 平面数组，如 [{"name": "底面", "points": ["A", "B", "C"]}]
- highlightPoints: 需要高亮的点名称数组
- highlightLines: 需要高亮的线段数组
- viewAngle: 3D视角，如 [30, 45]`;

    const userPrompt = `请根据以下几何问题描述提取绘图参数：
    
题目描述：${stepDescription}

请输出JSON格式的几何参数。`;

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
    const systemPrompt = `你是一个函数参数提取专家。请根据数学问题描述提取函数绘图所需的参数，仅输出JSON格式，不要输出其他内容。
    
**输出格式要求：**
- 必须是有效的JSON格式
- 不要包含任何解释性文字
- 只输出JSON对象

**参数说明：**
- title: 图形标题（字符串）
- equations: 函数表达式数组，如 ["y = x**2", "y = np.sin(x)"]
- colors: 颜色数组，与equations对应，如 ["red", "blue"]
- xRange: x轴范围，如 [-10, 10]
- yRange: y轴范围，如 [-5, 5]
- showGrid: 是否显示网格（布尔值）
- legend: 图例标签数组，如 ["抛物线", "正弦曲线"]`;

    const userPrompt = `请根据以下数学问题描述提取函数绘图参数：
    
题目描述：${stepDescription}

图像类型：${imageType === 'MATH_STATIC_EQUATION' ? '数学静态图形（解析式）' : 
           imageType === 'CHEMISTRY_CRYSTAL' ? '化学晶胞' :
           imageType === 'PHYSICS_ENGINE' ? '物理模拟' : '默认图形'}

请输出JSON格式的参数。`;

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

  // ==================== 生成几何图形代码 ====================
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
    
    // 生成点坐标代码
    const pointCode = points.map(p => `${p.name} = (${p.x}, ${p.y}, ${p.z})`).join('\n');
    
    // 生成线段代码
    let lineCode = '';
    lines.forEach((line, i) => {
      const color = highlightLines.includes(line.join('-')) ? 'red' : 'blue';
      lineCode += `ax.plot([${line[0]}[0], ${line[1]}[0]], [${line[0]}[1], ${line[1]}[1]], [${line[0]}[2], ${line[1]}[2]], color='${color}', linewidth=${highlightLines.includes(line.join('-')) ? 3 : 2})\n`;
    });
    
    // 生成点标记代码
    const scatterCode = points.map(p => `ax.scatter(${p.x}, ${p.y}, ${p.z}, c='black', s=50)\nax.text(${p.x}+0.1, ${p.y}+0.1, ${p.z}+0.1, '${p.name}', fontsize=12)`).join('\n');
    
    return `\`\`\`python
import matplotlib.pyplot as plt
from mpl_toolkits.mplot3d import Axes3D

# 设置中文字体支持
plt.rcParams['font.sans-serif'] = ['SimHei', 'DejaVu Sans']
plt.rcParams['axes.unicode_minus'] = False

# 创建3D图形
fig = plt.figure(figsize=(12, 8))
ax = fig.add_subplot(111, projection='3d')

# 定义点坐标
${pointCode}

# 绘制线段
${lineCode}

# 绘制点和标签
${scatterCode}

# 设置图形属性
ax.set_title('${title}', fontsize=14, fontweight='bold')
ax.set_xlabel('X轴', fontsize=12)
ax.set_ylabel('Y轴', fontsize=12)
ax.set_zlabel('Z轴', fontsize=12)
ax.grid(True, linestyle='--', alpha=0.7)

# 调整视角
ax.view_init(elev=30, azim=45)

# 保存图片
plt.tight_layout()
plt.savefig('/tmp/figure.png', dpi=150, bbox_inches='tight')
print("图片已保存到 /tmp/figure.png")
\`\`\``;
  }

  // ==================== 根据参数生成Python代码 ====================
  static generateFunctionCode(params, imageType) {
    const title = params.title || '数学图形';
    const equations = params.equations || ['y = x'];
    const colors = params.colors || ['blue'];
    const xRange = params.xRange || [-10, 10];
    const yRange = params.yRange || [-10, 10];
    const showGrid = params.showGrid !== undefined ? params.showGrid : true;
    const legend = params.legend || equations.map((_, i) => `曲线${i+1}`);

    while (colors.length < equations.length) {
      colors.push('blue');
    }

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

  // ==================== 生成静态图形代码 ====================
  static generateStaticCode({ title, equations, colors, xRange, yRange, showGrid, legend }) {
    return `\`\`\`python
import matplotlib.pyplot as plt
import numpy as np

# 设置中文字体支持
plt.rcParams['font.sans-serif'] = ['SimHei', 'DejaVu Sans']
plt.rcParams['axes.unicode_minus'] = False

# 设置图形尺寸（统一标准）
fig, ax = plt.subplots(figsize=(12, 8))

# 定义变量范围
x = np.linspace(${xRange[0]}, ${xRange[1]}, 1000)

# 绘制函数曲线
${equations.map((eq, i) => `y${i} = ${eq}\nax.plot(x, y${i}, color='${colors[i]}', label='${legend[i]}', linewidth=2)`).join('\n')}

# 图形设置
ax.set_title('${title}', fontsize=14, fontweight='bold')
ax.set_xlabel('X轴', fontsize=12)
ax.set_ylabel('Y轴', fontsize=12)
ax.set_xlim(${xRange[0]}, ${xRange[1]})
ax.set_ylim(${yRange[0]}, ${yRange[1]})
${showGrid ? 'ax.grid(True, linestyle=\'--\', alpha=0.7)' : ''}
ax.legend(fontsize=12)

# 保存图片
plt.tight_layout()
plt.savefig('/tmp/figure.png', dpi=150, bbox_inches='tight')
print("图片已保存到 /tmp/figure.png")
\`\`\``;
  }

  // ==================== 生成动画代码 ====================
  static generateAnimationCode(params) {
    const title = params.title || '动态几何演示';
    const equations = params.equations || ['np.sin(x + t * 0.1)'];
    const colors = params.colors || ['blue'];
    
    // 使用第一个方程
    const mainEquation = equations[0] || 'np.sin(x + t * 0.1)';
    
    return `\`\`\`python
import matplotlib.pyplot as plt
import matplotlib.animation as animation
import numpy as np

# 设置中文字体支持
plt.rcParams['font.sans-serif'] = ['SimHei', 'DejaVu Sans']
plt.rcParams['axes.unicode_minus'] = False

# 设置图形尺寸
fig, ax = plt.subplots(figsize=(12, 8))
ax.set_xlim(-10, 10)
ax.set_ylim(-10, 10)
ax.set_aspect('equal')
ax.grid(True, linestyle='--', alpha=0.7)
ax.set_title('${title}', fontsize=14, fontweight='bold')

# 初始化图形元素
line, = ax.plot([], [], '${colors[0]}', linewidth=2)
point, = ax.plot([], [], 'ro', markersize=8)

def init():
    line.set_data([], [])
    point.set_data([], [])
    return line, point

def update(frame):
    x = np.linspace(-10, 10, 1000)
    t = frame
    y = ${mainEquation}
    line.set_data(x, y)
    point.set_data([x[500]], [y[500]])
    return line, point

# 创建动画
ani = animation.FuncAnimation(
    fig, update, frames=100, init_func=init,
    interval=50, blit=True
)

# 保存为GIF
ani.save('/tmp/animation.gif', writer='pillow', fps=20)
print("动画已保存到 /tmp/animation.gif")
\`\`\``;
  }

  // ==================== 生成抽象概念代码 ====================
  static generateAbstractCode(params) {
    const title = params.title || '抽象概念可视化';
    
    return `\`\`\`python
import matplotlib.pyplot as plt
import numpy as np

# 设置中文字体支持
plt.rcParams['font.sans-serif'] = ['SimHei', 'DejaVu Sans']
plt.rcParams['axes.unicode_minus'] = False

# 设置图形尺寸
fig, ax = plt.subplots(figsize=(12, 8))

# 绘制抽象概念图形
ax.set_title('${title}', fontsize=14, fontweight='bold')
ax.set_xlabel('X轴', fontsize=12)
ax.set_ylabel('Y轴', fontsize=12)
ax.grid(True, linestyle='--', alpha=0.7)

# 示例：绘制多个函数曲线展示抽象关系
x = np.linspace(-5, 5, 100)
ax.plot(x, x**2, 'r-', label='二次函数', linewidth=2)
ax.plot(x, np.exp(x), 'b-', label='指数函数', linewidth=2)
ax.plot(x, np.log(np.abs(x) + 1), 'g-', label='对数函数', linewidth=2)

ax.legend(fontsize=12)

# 保存图片
plt.tight_layout()
plt.savefig('/tmp/figure.png', dpi=150, bbox_inches='tight')
print("图片已保存到 /tmp/figure.png")
\`\`\``;
  }

  // ==================== 生成晶胞结构代码 ====================
  static generateCrystalCode(params) {
    const title = params.title || '晶胞结构';
    
    return `\`\`\`python
import matplotlib.pyplot as plt
from mpl_toolkits.mplot3d import Axes3D
import numpy as np

# 设置中文字体支持
plt.rcParams['font.sans-serif'] = ['SimHei', 'DejaVu Sans']
plt.rcParams['axes.unicode_minus'] = False

# 创建子图布局
fig = plt.figure(figsize=(18, 6))

# 3D晶胞结构
ax1 = fig.add_subplot(131, projection='3d')
ax1.set_title('晶胞三维结构', fontsize=12)
# 绘制简单立方晶胞
r = [0, 1]
for x in r:
    for y in r:
        for z in r:
            ax1.scatter(x, y, z, c='blue', s=100)
ax1.set_xlim(-0.5, 1.5)
ax1.set_ylim(-0.5, 1.5)
ax1.set_zlim(-0.5, 1.5)

# 前视图
ax2 = fig.add_subplot(132)
ax2.set_title('前视截面', fontsize=12)
ax2.set_aspect('equal')
ax2.grid(True, linestyle='--', alpha=0.7)
for x in r:
    for y in r:
        ax2.scatter(x, y, c='red', s=100)
ax2.set_xlim(-0.5, 1.5)
ax2.set_ylim(-0.5, 1.5)

# 俯视图
ax3 = fig.add_subplot(133)
ax3.set_title('俯视截面', fontsize=12)
ax3.set_aspect('equal')
ax3.grid(True, linestyle='--', alpha=0.7)
for x in r:
    for z in r:
        ax3.scatter(x, z, c='green', s=100)
ax3.set_xlim(-0.5, 1.5)
ax3.set_ylim(-0.5, 1.5)

# 保存图片
plt.tight_layout()
plt.savefig('/tmp/figure.png', dpi=150, bbox_inches='tight')
print("图片已保存到 /tmp/figure.png")
\`\`\``;
  }

  // ==================== 生成物理模拟代码 ====================
  static generatePhysicsCode(params) {
    const title = params.title || '物理模拟';
    
    return `\`\`\`python
import matplotlib.pyplot as plt
import numpy as np

# 设置中文字体支持
plt.rcParams['font.sans-serif'] = ['SimHei', 'DejaVu Sans']
plt.rcParams['axes.unicode_minus'] = False

# 物理参数定义
g = 9.8  # 重力加速度
v0 = 20  # 初始速度
theta = 45  # 发射角度（度）

# 设置图形
fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(16, 8))

# 左图：运动轨迹
ax1.set_xlim(0, 50)
ax1.set_ylim(0, 25)
ax1.set_aspect('auto')
ax1.grid(True, linestyle='--', alpha=0.7)
ax1.set_title('${title} - 运动轨迹', fontsize=14, fontweight='bold')
ax1.set_xlabel('水平距离 (m)', fontsize=12)
ax1.set_ylabel('高度 (m)', fontsize=12)

# 计算抛物线轨迹
t = np.linspace(0, 3, 100)
x = v0 * np.cos(np.radians(theta)) * t
y = v0 * np.sin(np.radians(theta)) * t - 0.5 * g * t**2
ax1.plot(x, y, 'b-', linewidth=2, label='抛体运动轨迹')
ax1.legend(fontsize=12)

# 右图：速度变化
ax2.set_xlabel('时间 (s)', fontsize=12)
ax2.set_ylabel('速度 (m/s)', fontsize=12)
ax2.set_title('速度变化曲线', fontsize=14, fontweight='bold')
ax2.grid(True, linestyle='--', alpha=0.7)

vx = v0 * np.cos(np.radians(theta)) * np.ones_like(t)
vy = v0 * np.sin(np.radians(theta)) - g * t
ax2.plot(t, vx, 'r-', label='水平速度', linewidth=2)
ax2.plot(t, vy, 'g-', label='竖直速度', linewidth=2)
ax2.legend(fontsize=12)

# 保存图片
plt.tight_layout()
plt.savefig('/tmp/figure.png', dpi=150, bbox_inches='tight')
print("图片已保存到 /tmp/figure.png")
\`\`\``;
  }

  // ==================== 第三层：收集结果并合成最终答案 ====================
  static async thirdLayerLLM(stepResults) {
    // 构建最终答案（先图片后步骤）
    let finalAnswer = '';
    const images = [];

    for (const step of stepResults) {
      // 如果有图片，先添加图片占位符
      if (step.imageData) {
        finalAnswer += `### 步骤 ${step.id}\n\n`;
        finalAnswer += `[IMAGE:${step.id}]\n\n`;
        images.push({
          stepId: step.id,
          imageData: step.imageData
        });
        // 然后添加步骤描述
        finalAnswer += `${step.description}\n\n`;
      } else {
        // 没有图片，直接添加步骤
        finalAnswer += `### 步骤 ${step.id}\n\n`;
        finalAnswer += `${step.description}\n\n`;
      }
    }

    return {
      finalAnswer,
      images
    };
  }

  // ==================== 对话标题生成 ====================
  static async generateConversationTitle(messages) {
    const systemPrompt = '你是一个标题生成助手。请根据对话内容生成一个简洁的对话标题，不超过20个字。';
    
    const messagesText = messages.map(m => `${m.role}: ${m.content}`).join('\n');
    
    const responseMessages = [
      {
        role: 'user',
        content: `请为以下对话生成一个简洁的标题（不超过20个字）：\n\n${messagesText}`
      }
    ];

    const result = await this.callDeepSeek(responseMessages, systemPrompt);
    return result.trim().replace(/["""'']/g, '');
  }

  // ==================== 获取所有模板信息 ====================
  static getTemplates() {
    return PROMPT_TEMPLATES;
  }
}

module.exports = LLMService;