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

  // ==================== 第二层：根据步骤生成Python代码 ====================
  static async secondLayerLLM(stepDescription, imageType) {
    // 根据图像类型选择模板
    const templates = {
      MATH_STATIC_EQUATION: {
        name: '数学静态图形（解析式）',
        systemPrompt: `你是一个数学图形生成专家。请根据题目描述生成Python代码，使用matplotlib绘制静态图形。

**代码规范：**
1. 必须使用 matplotlib 和 numpy 库
2. 图形尺寸统一为 12x8 英寸
3. 必须包含：标题、坐标轴标签、网格
4. 使用 plt.savefig() 保存图片，不要使用 plt.show()
5. 保存路径为 '/tmp/figure.png'
6. 代码必须完整可运行，不要省略任何部分

**输出格式：**
仅输出Python代码，使用 \`\`\`python ... \`\`\` 包裹`,
        codeTemplate: `\`\`\`python
import matplotlib.pyplot as plt
import numpy as np

# 设置中文字体支持
plt.rcParams['font.sans-serif'] = ['SimHei', 'DejaVu Sans']
plt.rcParams['axes.unicode_minus'] = False

# 设置图形尺寸（统一标准）
fig, ax = plt.subplots(figsize=(12, 8))

# 定义变量范围
x = np.linspace(-10, 10, 1000)

# 在此处添加你的绘图代码
# y = ...

# 图形设置
ax.set_title('图形标题', fontsize=14, fontweight='bold')
ax.set_xlabel('X轴', fontsize=12)
ax.set_ylabel('Y轴', fontsize=12)
ax.grid(True, linestyle='--', alpha=0.7)
ax.legend(fontsize=12)

# 保存图片
plt.tight_layout()
plt.savefig('/tmp/figure.png', dpi=150, bbox_inches='tight')
print("图片已保存到 /tmp/figure.png")
\`\`\``
      },
      
      MATH_DYNAMIC_GEOMETRY: {
        name: '数学动态图形（几何描述）',
        systemPrompt: `你是一个数学动态图形生成专家。请根据几何描述生成Python动画代码，使用matplotlib的animation模块。

**代码规范：**
1. 必须使用 matplotlib, numpy, matplotlib.animation 库
2. 图形尺寸统一为 12x8 英寸
3. 动画需要清晰展示几何变化过程
4. 使用 FuncAnimation 创建动画
5. 保存为GIF格式，路径为 '/tmp/animation.gif'
6. 代码必须完整可运行

**输出格式：**
仅输出Python代码，使用 \`\`\`python ... \`\`\` 包裹`,
        codeTemplate: `\`\`\`python
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
ax.set_title('动态几何演示', fontsize=14, fontweight='bold')

# 初始化图形元素
line, = ax.plot([], [], 'b-', linewidth=2)
point, = ax.plot([], [], 'ro', markersize=8)

def init():
    line.set_data([], [])
    point.set_data([], [])
    return line, point

def update(frame):
    # 动画更新逻辑
    x = np.linspace(-10, 10, 1000)
    y = np.sin(x + frame * 0.1)  # 示例：正弦波动画
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
\`\`\``
      },
      
      MATH_STATIC_ABSTRACT: {
        name: '数学静态图形（抽象函数）',
        systemPrompt: `你是一个抽象数学概念可视化专家。请为抽象数学概念生成可视化代码，使用matplotlib绘制示意性图形。

**代码规范：**
1. 必须使用 matplotlib 和 numpy 库
2. 图形尺寸统一为 12x8 英寸
3. 添加必要的标注和说明
4. 使用 plt.savefig() 保存图片，路径为 '/tmp/figure.png'
5. 代码必须完整可运行

**输出格式：**
仅输出Python代码，使用 \`\`\`python ... \`\`\` 包裹`,
        codeTemplate: `\`\`\`python
import matplotlib.pyplot as plt
import numpy as np

# 设置中文字体支持
plt.rcParams['font.sans-serif'] = ['SimHei', 'DejaVu Sans']
plt.rcParams['axes.unicode_minus'] = False

# 设置图形尺寸
fig, ax = plt.subplots(figsize=(12, 8))

# 抽象概念可视化代码
# 在此处添加你的绘图代码

# 图形设置
ax.set_title('抽象概念可视化', fontsize=14, fontweight='bold')
ax.set_xlabel('X轴', fontsize=12)
ax.set_ylabel('Y轴', fontsize=12)
ax.grid(True, linestyle='--', alpha=0.7)

# 保存图片
plt.tight_layout()
plt.savefig('/tmp/figure.png', dpi=150, bbox_inches='tight')
print("图片已保存到 /tmp/figure.png")
\`\`\``
      },
      
      CHEMISTRY_CRYSTAL: {
        name: '化学晶胞模型',
        systemPrompt: `你是一个化学晶体结构可视化专家。请根据分子结构描述生成Python代码，使用matplotlib绘制晶胞结构和截面图。

**代码规范：**
1. 必须使用 matplotlib, numpy, mpl_toolkits.mplot3d 库
2. 图形尺寸统一为 18x6 英寸（三个子图）
3. 从多个角度展示：3D结构、前视截面、俯视截面
4. 使用 plt.savefig() 保存图片，路径为 '/tmp/figure.png'
5. 代码必须完整可运行

**输出格式：**
仅输出Python代码，使用 \`\`\`python ... \`\`\` 包裹`,
        codeTemplate: `\`\`\`python
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
# 在此处添加3D绘图代码

# 前视图
ax2 = fig.add_subplot(132)
ax2.set_title('前视截面', fontsize=12)
ax2.set_aspect('equal')
ax2.grid(True, linestyle='--', alpha=0.7)
# 在此处添加前视图代码

# 俯视图
ax3 = fig.add_subplot(133)
ax3.set_title('俯视截面', fontsize=12)
ax3.set_aspect('equal')
ax3.grid(True, linestyle='--', alpha=0.7)
# 在此处添加俯视图代码

# 保存图片
plt.tight_layout()
plt.savefig('/tmp/figure.png', dpi=150, bbox_inches='tight')
print("图片已保存到 /tmp/figure.png")
\`\`\``
      },
      
      PHYSICS_ENGINE: {
        name: '物理模拟引擎',
        systemPrompt: `你是一个物理模拟专家。请根据物理问题描述生成Python模拟代码，使用matplotlib进行可视化。

**代码规范：**
1. 必须使用 matplotlib, numpy 库，可选使用 matplotlib.animation
2. 图形尺寸统一为 12x8 英寸
3. 展示：初始状态、运动过程、关键参数变化
4. 添加必要的物理量标注
5. 使用 plt.savefig() 保存图片，路径为 '/tmp/figure.png'
6. 代码必须完整可运行

**输出格式：**
仅输出Python代码，使用 \`\`\`python ... \`\`\` 包裹`,
        codeTemplate: `\`\`\`python
import matplotlib.pyplot as plt
import numpy as np

# 设置中文字体支持
plt.rcParams['font.sans-serif'] = ['SimHei', 'DejaVu Sans']
plt.rcParams['axes.unicode_minus'] = False

# 物理参数定义
# 在此处定义物理参数

# 设置图形
fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(16, 8))

# 左图：运动轨迹
ax1.set_xlim(0, 100)
ax1.set_ylim(0, 100)
ax1.set_aspect('equal')
ax1.grid(True, linestyle='--', alpha=0.7)
ax1.set_title('运动轨迹', fontsize=14, fontweight='bold')
ax1.set_xlabel('X位置', fontsize=12)
ax1.set_ylabel('Y位置', fontsize=12)

# 右图：参数变化
ax2.set_xlabel('时间 (s)', fontsize=12)
ax2.set_ylabel('参数值', fontsize=12)
ax2.set_title('参数变化曲线', fontsize=14, fontweight='bold')
ax2.grid(True, linestyle='--', alpha=0.7)

# 在此处添加物理模拟代码

# 保存图片
plt.tight_layout()
plt.savefig('/tmp/figure.png', dpi=150, bbox_inches='tight')
print("图片已保存到 /tmp/figure.png")
\`\`\``
      },
      
      DEFAULT: {
        name: '默认图形',
        systemPrompt: `你是一个图形生成专家。请根据描述生成Python可视化代码。

**代码规范：**
1. 使用 matplotlib 和 numpy 库
2. 图形尺寸统一为 12x8 英寸
3. 使用 plt.savefig() 保存图片，路径为 '/tmp/figure.png'
4. 代码必须完整可运行

**输出格式：**
仅输出Python代码，使用 \`\`\`python ... \`\`\` 包裹`,
        codeTemplate: `\`\`\`python
import matplotlib.pyplot as plt
import numpy as np

plt.rcParams['font.sans-serif'] = ['SimHei', 'DejaVu Sans']
plt.rcParams['axes.unicode_minus'] = False

fig, ax = plt.subplots(figsize=(12, 8))

# 在此处添加绘图代码

ax.set_title('图形标题', fontsize=14, fontweight='bold')
ax.grid(True, linestyle='--', alpha=0.7)

plt.tight_layout()
plt.savefig('/tmp/figure.png', dpi=150, bbox_inches='tight')
print("图片已保存到 /tmp/figure.png")
\`\`\``
      }
    };

    const template = templates[imageType] || templates.DEFAULT;
    
    const messages = [
      {
        role: 'user',
        content: `请根据以下步骤描述生成Python可视化代码：

步骤描述：${stepDescription}

图像类型：${template.name}

请生成完整、可运行的Python代码。`
      }
    ];

    const result = await this.callDeepSeek(messages, template.systemPrompt);
    return result;
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