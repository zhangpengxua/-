const LLMService = require('./utils/llmService');

// 测试用例1: 球体旋转动画
console.log('=== 测试用例1: 球体旋转动画 ===');
const sphereParams = {
  title: "观察球体",
  geometryType: "sphere",
  points: [{name: "O", x: 0, y: 0, z: 0}],
  radius: 1.5,
  animation: {
    type: "rotate_view",
    duration: 40
  }
};

const sphereCode = LLMService.generateGeometryAnimationCode(sphereParams);
console.log('生成的Python代码长度:', sphereCode.length);
console.log('代码预览:');
console.log(sphereCode.substring(0, 500) + '...');
console.log();

// 测试用例2: 球体生长动画
console.log('=== 测试用例2: 球体生长动画 ===');
const sphereGrowParams = {
  title: "球体生长过程",
  geometryType: "sphere",
  points: [{name: "O", x: 1, y: 1, z: 0}],
  radius: 2,
  animation: {
    type: "grow",
    duration: 30
  }
};

const sphereGrowCode = LLMService.generateGeometryAnimationCode(sphereGrowParams);
console.log('生成的Python代码长度:', sphereGrowCode.length);
console.log('代码预览:');
console.log(sphereGrowCode.substring(0, 500) + '...');
console.log();

// 测试用例3: 圆形绘制
console.log('=== 测试用例3: 圆形绘制 ===');
const circleParams = {
  title: "绘制圆形",
  geometryType: "circle",
  center: {x: 0, y: 0},
  radius: 2
};

const circleCode = LLMService.generateGeometryAnimationCode(circleParams);
console.log('生成的Python代码长度:', circleCode.length);
console.log('代码预览:');
console.log(circleCode.substring(0, 500) + '...');
console.log();

// 测试用例4: 四面体旋转（之前已支持）
console.log('=== 测试用例4: 四面体旋转 ===');
const tetrahedronParams = {
  title: "旋转观察四面体",
  points: [
    {name: "A", x: 1, y: 1, z: 0},
    {name: "B", x: 0, y: 0, z: 1.63},
    {name: "C", x: 2, y: 0, z: 0},
    {name: "D", x: 0, y: 2, z: 0}
  ],
  animation: {
    type: "rotate_view",
    duration: 40
  }
};

const tetraCode = LLMService.generateGeometryAnimationCode(tetrahedronParams);
console.log('生成的Python代码长度:', tetraCode.length);
console.log('代码预览:');
console.log(tetraCode.substring(0, 500) + '...');
console.log();

console.log('=== 所有测试用例生成完成 ===');
console.log('提示：将生成的Python代码保存为.py文件并运行即可查看效果');
console.log('需要安装依赖: pip install matplotlib numpy pillow');