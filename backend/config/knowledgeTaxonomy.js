// 稳定知识点字典（首版 math-v1）。
// 模型只能引用这里的 ID；未覆盖内容输出 unmappedTopics 候选名称，由后端标记“暂未归类”，
// 不进入稳定统计与训练映射。可借鉴 firstLayerLLM 题型列表扩展，但题型 ≠ 知识点。
const TAXONOMY_VERSION = 'math-v1';

const KNOWLEDGE_POINTS = [
  // 基础代数
  { id: 'math.algebra.fraction_operations', name: '分式与分式运算', path: ['数学', '代数', '分式'], aliases: ['分式', '通分', '约分', '分式化简'] },
  { id: 'math.algebra.equation_solving', name: '方程求解与根的判定', path: ['数学', '代数', '方程'], aliases: ['一元一次方程', '一元二次方程', '求根公式', '判别式', '解方程'] },
  { id: 'math.algebra.inequalities', name: '不等式与基本不等式', path: ['数学', '代数', '不等式'], aliases: ['不等式', '均值不等式', '基本不等式', '解不等式'] },
  { id: 'math.algebra.absolute_value', name: '绝对值与含参化简', path: ['数学', '代数', '绝对值'], aliases: ['绝对值', '去绝对值', '绝对值方程'] },
  { id: 'math.algebra.exponent_logarithm', name: '指数与对数运算', path: ['数学', '代数', '指数对数'], aliases: ['指数', '对数', '换底公式', '对数运算'] },
  // 函数
  { id: 'math.function.domain_range', name: '函数定义域与值域', path: ['数学', '函数', '定义域与值域'], aliases: ['定义域', '值域', '求定义域', '取值范围'] },
  { id: 'math.function.properties', name: '函数性质（单调性/奇偶性/周期性）', path: ['数学', '函数', '性质'], aliases: ['单调性', '奇偶性', '周期性', '函数性质'] },
  { id: 'math.function.trigonometric', name: '三角函数与恒等变换', path: ['数学', '函数', '三角函数'], aliases: ['三角函数', '诱导公式', '正弦定理', '余弦定理', '三角恒等变换'] },
  { id: 'math.function.inverse_composite', name: '复合函数与反函数', path: ['数学', '函数', '复合与反函数'], aliases: ['复合函数', '反函数', '复合函数求导准备'] },
  { id: 'math.function.graphs', name: '函数图像与变换', path: ['数学', '函数', '图像'], aliases: ['函数图像', '图像平移', '图像变换', '图像对称'] },
  // 平面几何与解析几何
  { id: 'math.geometry.plane.similarity', name: '相似三角形与比例', path: ['数学', '几何', '平面几何', '相似关系'], aliases: ['相似三角形', '相似比', '比例', '位似'] },
  { id: 'math.geometry.plane.area', name: '平面图形面积计算', path: ['数学', '几何', '平面几何', '面积'], aliases: ['面积', '三角形面积', '圆面积', '面积公式'] },
  { id: 'math.geometry.plane.circle', name: '圆的性质与计算', path: ['数学', '几何', '平面几何', '圆'], aliases: ['圆', '切线', '圆周角', '弧长'] },
  { id: 'math.geometry.coordinate.line_curve', name: '直线与曲线方程', path: ['数学', '几何', '解析几何'], aliases: ['直线方程', '曲线方程', '距离公式', '斜率'] },
  // 立体几何
  { id: 'math.geometry.solid.cone_section', name: '圆锥截面与相似关系', path: ['数学', '几何', '立体几何', '截面'], aliases: ['圆锥截面', '轴截面', '截面面积', '圆锥'] },
  { id: 'math.geometry.solid.volume_surface', name: '立体体积与表面积', path: ['数学', '几何', '立体几何', '体积面积'], aliases: ['体积', '表面积', '侧面积', '体积公式'] },
  { id: 'math.geometry.solid.section_height', name: '立体几何中的高度与距离', path: ['数学', '几何', '立体几何', '高度距离'], aliases: ['高', '高度', '点到平面距离', '锥高'] },
  { id: 'math.geometry.solid.spatial_relations', name: '空间位置关系（平行/垂直）', path: ['数学', '几何', '立体几何', '位置关系'], aliases: ['线面平行', '线面垂直', '面面垂直', '异面直线'] },
  { id: 'math.geometry.solid.projection', name: '投影与三视图', path: ['数学', '几何', '立体几何', '投影'], aliases: ['投影', '三视图', '正投影'] },
  // 导数与微分
  { id: 'math.calculus.derivative.definition', name: '导数定义与几何意义', path: ['数学', '微积分', '导数'], aliases: ['导数定义', '切线斜率', '导数几何意义', '可导'] },
  { id: 'math.calculus.derivative.chain_rule', name: '链式法则与求导法则', path: ['数学', '微积分', '导数', '求导法则'], aliases: ['链式法则', '复合函数求导', '乘法法则', '除法法则'] },
  { id: 'math.calculus.derivative.partial', name: '偏导数与全微分', path: ['数学', '微积分', '多元微分'], aliases: ['偏导数', '全微分', '多元函数求导', '隐函数求导'] },
  { id: 'math.calculus.derivative.applications', name: '导数应用（单调性/极值/最值）', path: ['数学', '微积分', '导数', '应用'], aliases: ['极值', '最值', '单调区间', '凹凸性', '拐点'] },
  // 积分
  { id: 'math.calculus.integral.indefinite', name: '不定积分与积分技巧', path: ['数学', '微积分', '积分'], aliases: ['不定积分', '换元积分', '分部积分', '凑微分'] },
  { id: 'math.calculus.integral.definite_limits', name: '定积分与积分限', path: ['数学', '微积分', '积分', '定积分'], aliases: ['定积分', '积分上下限', '变限积分', '牛顿莱布尼茨公式'] },
  { id: 'math.calculus.integral.multiple', name: '重积分与积分区域', path: ['数学', '微积分', '积分', '重积分'], aliases: ['二重积分', '三重积分', '积分区域', '交换积分次序'] },
  { id: 'math.calculus.integral.line_surface', name: '曲线积分与曲面积分', path: ['数学', '微积分', '积分', '线面积分'], aliases: ['曲线积分', '曲面积分', '格林公式', '高斯公式', '斯托克斯公式'] },
  // 微分方程
  { id: 'math.ode.separable', name: '可分离变量与一阶线性微分方程', path: ['数学', '微分方程', '一阶方程'], aliases: ['可分离变量', '一阶线性微分方程', '齐次方程', '常数变易法'] },
  { id: 'math.ode.bernoulli_exact', name: '伯努利方程与全微分方程', path: ['数学', '微分方程', '特殊类型'], aliases: ['伯努利方程', '全微分方程', '恰当方程'] },
  { id: 'math.ode.second_order', name: '二阶常系数线性微分方程', path: ['数学', '微分方程', '高阶方程'], aliases: ['二阶常系数', '特征根', '待定系数法', '特解'] },
  // 级数
  { id: 'math.series.convergence', name: '级数敛散性判别', path: ['数学', '级数', '敛散性'], aliases: ['敛散性', '比较判别法', '比值判别法', '交错级数', '条件收敛', '绝对收敛'] },
  { id: 'math.series.power_series', name: '幂级数与泰勒展开', path: ['数学', '级数', '幂级数'], aliases: ['幂级数', '收敛域', '泰勒展开', '麦克劳林展开'] },
  { id: 'math.series.fourier', name: '傅里叶级数', path: ['数学', '级数', '傅里叶级数'], aliases: ['傅里叶级数', '傅里叶展开', '傅里叶系数'] },
  // 通用
  { id: 'math.general.problem_reading', name: '题意理解与条件转化', path: ['数学', '通用', '审题'], aliases: ['审题', '条件转化', '题意理解'] },
];

const byId = new Map(KNOWLEDGE_POINTS.map((p) => [p.id, p]));
const byName = new Map();
for (const p of KNOWLEDGE_POINTS) {
  byName.set(p.name, p);
  for (const alias of p.aliases) {
    if (!byName.has(alias)) byName.set(alias, p);
  }
}

function isValidId(id) {
  return typeof id === 'string' && byId.has(id);
}

function getPoint(id) {
  return byId.get(id) || null;
}

// 精确名称/别名匹配，用于把历史材料中的自由词映射到稳定 ID（不保证命中）。
function findByName(name) {
  if (typeof name !== 'string') return null;
  return byName.get(name.trim()) || null;
}

function listForPrompt() {
  return KNOWLEDGE_POINTS.map((p) => ({ id: p.id, name: p.name, path: p.path }));
}

module.exports = {
  version: TAXONOMY_VERSION,
  points: KNOWLEDGE_POINTS,
  isValidId,
  getPoint,
  findByName,
  listForPrompt,
};
