#!/usr/bin/env python3
"""
测试脚本：验证模糊动画类型描述的映射
"""

# 模拟模糊动画类型映射逻辑
def resolve_anim_type(anim_type):
    """将模糊的动画类型描述映射到具体类型"""
    anim_type = anim_type or ''
    
    if '旋转' in anim_type or '视角' in anim_type:
        return 'rotate_view'
    elif '扩展线' in anim_type or '延长线' in anim_type:
        return 'extend_line'
    elif '扩展面' in anim_type or '扩大面' in anim_type:
        return 'extend_plane'
    elif '高亮' in anim_type or '突出' in anim_type or '显示' in anim_type:
        return 'highlight_plane'
    elif '绘制' in anim_type or '画' in anim_type:
        return 'draw_plane'
    elif '移动' in anim_type or '平移' in anim_type:
        return 'slide_move'
    else:
        return 'rotate_view'  # 默认旋转视角

# 测试用例
test_cases = [
    "从不同角度观察几何体",
    "旋转观察正方体",
    "扩展AB边来扩展底面",
    "延长线段CD",
    "高亮显示前面BCC1B1",
    "突出显示底面",
    "绘制一个新平面",
    "画出辅助线",
    "平移几何体",
    "向右移动图形",
    "扩展平面到指定位置",
    "扩大三角形面",
    "随便动一动",  # 未匹配，应该返回默认
]

print("=== 测试模糊动画类型映射 ===")
print()

for test in test_cases:
    resolved = resolve_anim_type(test)
    print(f"输入: '{test}'")
    print(f"输出: {resolved}")
    print()

print("=== 测试完成 ===")
