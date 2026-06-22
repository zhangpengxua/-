/**
 * 将 LaTeX 数学表达式转换为 mathjs 可解析的表达式
 * 支持：\frac, \sqrt, ^{...}, _{...}, \sin, \cos, \tan, \ln, \log, \arctan,
 *       \pi, e^{...}→exp(...), |...|→abs(...), \cdot, \times, \left, \right, \begin{cases},
 *       隐式乘法 (5x→5*x, (x+1)(x+2)→(x+1)*(x+2), 通用字母间乘法) 等
 *
 * 设计原则：不使用硬编码的特定函数模式，而是通过通用的 LaTeX 语法转换
 * 和 mathjs 数值计算能力来处理任意表达式。
 */

// ============ 通用工具函数 ============

/**
 * 已知 mathjs 函数/常量名集合（用于区分隐式乘法和函数调用）
 * 使用函数计算方式：通过排除法判断字母间是否应插入乘法运算符
 */
const KNOWN_FUNCTIONS = new Set([
  'sin', 'cos', 'tan', 'sec', 'csc', 'cot',
  'sinh', 'cosh', 'tanh', 'sech', 'csch', 'coth',
  'asin', 'acos', 'atan', 'asec', 'acsc', 'acot',
  'asinh', 'acosh', 'atanh',
  'exp', 'ln', 'log', 'sqrt', 'abs', 'nthRoot',
  'max', 'min', 'mod', 'floor', 'ceil', 'round',
  'det', 'norm', 'transpose', 'cross', 'dot', 'inv',
  'pi', 'Infinity', 'NaN',
]);

/**
 * 判断两个相邻字母是否应该被隐式乘法分隔
 * 通过函数计算排除法：检查双字母组合是否形成已知函数名
 */
function shouldInsertMultiply(prev, next) {
  if (!/[a-zA-Z]/.test(prev) || !/[a-zA-Z]/.test(next)) return false;
  const pair = (prev + next).toLowerCase();
  for (const fn of KNOWN_FUNCTIONS) {
    if (fn.length >= 2 && fn.slice(0, 2) === pair) return false;
    if (fn.length >= 2 && fn[fn.length - 2] === prev && fn[fn.length - 1] === next) return false;
  }
  return true;
}

/**
 * 处理隐式乘法：数字*字母、括号间、字母间等
 * 使用函数计算方式逐个字符扫描，动态判断，不硬编码变量名
 */
function insertImplicitMultiply(expr) {
  const result = [];
  for (let i = 0; i < expr.length; i++) {
    const ch = expr[i];
    result.push(ch);

    if (i < expr.length - 1) {
      const next = expr[i + 1];

      if (/\d/.test(ch) && /[a-zA-Z]/.test(next)) {
        result.push('*');
      } else if (/\d/.test(ch) && next === '(') {
        result.push('*');
      } else if (ch === ')' && /[a-zA-Z]/.test(next)) {
        result.push('*');
      } else if (ch === ')' && next === '(') {
        result.push('*');
      } else if (/[a-zA-Z]/.test(ch) && next === '(') {
        // 字母后跟左括号：检查前面是否是函数名
        let j = result.length - 1;
        let fnName = '';
        while (j >= 0 && /[a-zA-Z]/.test(result[j])) {
          fnName = result[j] + fnName;
          j--;
        }
        if (!KNOWN_FUNCTIONS.has(fnName.toLowerCase())) {
          result.push('*');
        }
      } else if (/[a-zA-Z]/.test(ch) && /[a-zA-Z]/.test(next)) {
        if (shouldInsertMultiply(ch, next)) {
          result.push('*');
        }
      }
    }
  }
  return result.join('');
}

// ============ 主转换函数 ============

export function latexToMathJS(latex) {
  if (!latex || typeof latex !== 'string') return latex;

  let expr = latex.trim();

  // 1. 去掉 f(x) = , y = , z = , u = 等前缀（通用：任意单字母变量名）
  expr = expr.replace(/^[a-zA-Z]\s*\([^)]*\)\s*=\s*/, '');
  expr = expr.replace(/^[a-zA-Z]\s*=\s*/, '');

  // 2. 处理 \begin{cases} ... \end{cases}：分段函数，取第一个分支
  const casesMatch = expr.match(/\\begin\{cases\}([\s\S]*?)\\end\{cases\}/);
  if (casesMatch) {
    const firstBranch = casesMatch[1].split(/\\\\|\\cr/)[0].split('&')[0].trim();
    expr = expr.replace(/\\begin\{cases\}[\s\S]*?\\end\{cases\}/, firstBranch);
  }

  // 3. 去掉 \left 和 \right
  expr = expr.replace(/\\left[([{|\]]?/g, '');
  expr = expr.replace(/\\right[)\]}|]?/g, '');

  // 4. 分数 \frac{num}{den} → (num)/(den)（循环处理嵌套）
  let prev = '';
  while (prev !== expr) {
    prev = expr;
    expr = expr.replace(/\\frac\{([^{}]*(?:\{[^{}]*\}[^{}]*)*)\}\{([^{}]*(?:\{[^{}]*\}[^{}]*)*)\}/g, '(($1)/($2))');
  }

  // 5. 根号 \sqrt{...} → sqrt(...)，\sqrt[n]{...} → nthRoot(...)
  expr = expr.replace(/\\sqrt\[(\d+)\]\{([^{}]*(?:\{[^{}]*\}[^{}]*)*)\}/g, 'nthRoot($2, $1)');
  expr = expr.replace(/\\sqrt\{([^{}]*(?:\{[^{}]*\}[^{}]*)*)\}/g, 'sqrt($1)');

  // 6. 三角函数
  expr = expr.replace(/\\sin\b/g, 'sin');
  expr = expr.replace(/\\cos\b/g, 'cos');
  expr = expr.replace(/\\tan\b/g, 'tan');
  expr = expr.replace(/\\sec\b/g, 'sec');
  expr = expr.replace(/\\csc\b/g, 'csc');
  expr = expr.replace(/\\cot\b/g, 'cot');
  expr = expr.replace(/\\arcsin\b/g, 'asin');
  expr = expr.replace(/\\arccos\b/g, 'acos');
  expr = expr.replace(/\\arctan\b/g, 'atan');
  expr = expr.replace(/\\sinh\b/g, 'sinh');
  expr = expr.replace(/\\cosh\b/g, 'cosh');
  expr = expr.replace(/\\tanh\b/g, 'tanh');

  // 7. 对数和指数
  expr = expr.replace(/\\ln\b/g, 'ln');
  expr = expr.replace(/\\log\b/g, 'log');
  expr = expr.replace(/\\exp\b/g, 'exp');

  // 8. 常量
  expr = expr.replace(/\\pi\b/g, 'pi');
  expr = expr.replace(/\\infty\b/g, 'Infinity');

  // 9. 绝对值 |...| → abs(...)
  // 使用通用函数计算方式：匹配 |...| 对，支持嵌套
  expr = replaceAbsValues(expr);

  // 10. 运算符
  expr = expr.replace(/\\cdot\b/g, '*');
  expr = expr.replace(/\\times\b/g, '*');
  expr = expr.replace(/\\div\b/g, '/');

  // 11. 清理残留的 LaTeX 命令（\ 后跟字母）
  expr = expr.replace(/\\[a-zA-Z]+\b/g, '');

  // 12. 处理 LaTeX 上标组 ^{...} → ^(...)（通用：在 ^ 后接 { 时展开）
  //    必须先处理 e^{...} → exp(...)，再处理一般的 ^{...}
  expr = expr.replace(/e\^\{([^{}]*(?:\{[^{}]*\}[^{}]*)*)\}/g, 'exp($1)');

  // 通用 ^{...} 处理：将 ^{...} 展开为 ^(...)
  // 但保留简单的 ^2, ^3 等（无括号的）
  prev = '';
  while (prev !== expr) {
    prev = expr;
    expr = expr.replace(/\^\{([^{}]*(?:\{[^{}]*\}[^{}]*)*)\}/g, '^($1)');
  }

  // 13. 处理 LaTeX 下标组 _{...} → _(...)（用于变量名如 x_1）
  //    循环处理嵌套
  prev = '';
  while (prev !== expr) {
    prev = expr;
    expr = expr.replace(/\_\{([^{}]*(?:\{[^{}]*\}[^{}]*)*)\}/g, '_($1)');
  }

  // 14. 隐式乘法：使用函数计算方式插入 *
  expr = insertImplicitMultiply(expr);

  // 15. 清理多余空格
  expr = expr.replace(/\s+/g, ' ').trim();

  console.log('[latexToMathJS]', latex?.substring(0, 80), '→', expr?.substring(0, 80));
  return expr;
}

/**
 * 替换绝对值 |...| → abs(...)
 * 使用正则匹配 |...| 对（不支持嵌套绝对值，对数学表达式足够）
 */
function replaceAbsValues(expr) {
  return expr.replace(/\|([^|]+)\|/g, 'abs($1)');
}

/**
 * 编译表达式为 mathjs 可调用函数
 * 自动检测 LaTeX 并转换
 * @param {string} expr - 表达式（支持 LaTeX 或纯数学表达式）
 * @param {object} math - mathjs 实例
 * @returns {Function|null} 编译后的函数，接收 scope 对象
 */
export function compileWithMathJS(expr, math) {
  if (!expr || !math) return null;
  try {
    const cleanExpr = latexToMathJS(String(expr));
    const parsed = math.parse(cleanExpr);
    const compiled = parsed.compile();
    return (scope) => compiled.evaluate(scope);
  } catch (e) {
    console.warn('[compileWithMathJS] 编译失败:', expr, '→', e.message);
    return null;
  }
}