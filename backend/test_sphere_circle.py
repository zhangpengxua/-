#!/usr/bin/env python3
"""
测试脚本：球体旋转和圆形动画效果
运行方式：python test_sphere_circle.py
需要安装依赖：pip install matplotlib numpy pillow
"""

import matplotlib.pyplot as plt
from mpl_toolkits.mplot3d import Axes3D
import matplotlib.animation as animation
import numpy as np
import os

plt.rcParams['font.sans-serif'] = ['SimHei', 'DejaVu Sans']
plt.rcParams['axes.unicode_minus'] = False

# 获取临时目录（兼容Windows和Linux）
TEMP_DIR = os.path.join(os.path.expanduser('~'), 'temp')
os.makedirs(TEMP_DIR, exist_ok=True)

def test_sphere_rotation():
    """测试1：球体旋转动画"""
    fig = plt.figure(figsize=(12, 8), facecolor='white')
    ax = fig.add_subplot(111, projection='3d')
    ax.set_facecolor('#fafafa')
    
    # 绘制球体
    u = np.linspace(0, 2 * np.pi, 100)
    v = np.linspace(0, np.pi, 100)
    x = 0 + 1.5 * np.outer(np.cos(u), np.sin(v))
    y = 0 + 1.5 * np.outer(np.sin(u), np.sin(v))
    z = 0 + 1.5 * np.outer(np.ones(np.size(u)), np.cos(v))
    ax.plot_surface(x, y, z, color='#1a237e', alpha=0.6)
    ax.scatter(0, 0, 0, c='#ff1744', s=80, edgecolors='white')
    ax.text(0+0.1, 0+0.1, 0+0.1, 'O', fontsize=12, fontweight='bold')
    
    ax.set_title('球体旋转动画', fontsize=16, fontweight='bold', pad=20, color='#1a237e')
    ax.set_xlabel('X', fontsize=12, fontweight='bold')
    ax.set_ylabel('Y', fontsize=12, fontweight='bold')
    ax.set_zlabel('Z', fontsize=12, fontweight='bold')
    ax.set_xlim(-2.5, 2.5)
    ax.set_ylim(-2.5, 2.5)
    ax.set_zlim(-2.5, 2.5)
    ax.grid(True, linestyle=':', alpha=0.4)
    
    def update(frame):
        ax.view_init(elev=30, azim=frame * 9)
        return []
    
    ani = animation.FuncAnimation(fig, update, frames=40, interval=100, blit=True)
    ani.save(os.path.join(TEMP_DIR, 'sphere_rotation.gif'), writer='pillow', fps=20, dpi=100)
    print("OK: 球体旋转动画已保存")

def test_sphere_grow():
    """测试2：球体生长动画"""
    fig = plt.figure(figsize=(12, 8), facecolor='white')
    ax = fig.add_subplot(111, projection='3d')
    ax.set_facecolor('#fafafa')
    
    def update(frame):
        r = 2 * min(frame * 0.05, 1)
        ax.cla()
        u = np.linspace(0, 2 * np.pi, 100)
        v = np.linspace(0, np.pi, 100)
        x = 1 + r * np.outer(np.cos(u), np.sin(v))
        y = 1 + r * np.outer(np.sin(u), np.sin(v))
        z = 0 + r * np.outer(np.ones(np.size(u)), np.cos(v))
        ax.plot_surface(x, y, z, color='#1a237e', alpha=0.6)
        ax.set_xlim(-3, 5)
        ax.set_ylim(-3, 5)
        ax.set_zlim(-3, 3)
        ax.set_title('球体生长动画', fontsize=16, fontweight='bold')
        return ax,
    
    ani = animation.FuncAnimation(fig, update, frames=30, interval=100)
    ani.save(os.path.join(TEMP_DIR, 'sphere_grow.gif'), writer='pillow', fps=20, dpi=100)
    print("OK: 球体生长动画已保存")

def test_circle():
    """测试3：圆形绘制"""
    fig, ax = plt.subplots(figsize=(12, 8))
    ax.set_aspect('equal')
    ax.set_facecolor('#fafafa')
    
    # 绘制圆形
    circle = plt.Circle((0, 0), 2, color='#1a237e', fill=False, linewidth=3)
    ax.add_artist(circle)
    ax.scatter(0, 0, c='#ff1744', s=60, edgecolors='white')
    ax.text(0.1, 0.1, 'O', fontsize=12, fontweight='bold')
    
    ax.set_title('圆形绘制', fontsize=16, fontweight='bold', pad=20, color='#1a237e')
    ax.set_xlabel('X', fontsize=12, fontweight='bold')
    ax.set_ylabel('Y', fontsize=12, fontweight='bold')
    ax.set_xlim(-3, 3)
    ax.set_ylim(-3, 3)
    ax.grid(True, linestyle=':', alpha=0.4)
    
    plt.tight_layout()
    plt.savefig(os.path.join(TEMP_DIR, 'circle.png'), dpi=150, bbox_inches='tight')
    print("OK: 圆形图像已保存")

def test_tetrahedron_rotation():
    """测试4：四面体旋转动画"""
    fig = plt.figure(figsize=(12, 8), facecolor='white')
    ax = fig.add_subplot(111, projection='3d')
    ax.set_facecolor('#fafafa')
    
    # 定义点坐标
    A = np.array([1, 1, 0])
    B = np.array([0, 0, 1.63])
    C = np.array([2, 0, 0])
    D = np.array([0, 2, 0])
    
    # 绘制基础线条（四面体6条棱）
    baseLines = [['A', 'B'], ['A', 'C'], ['A', 'D'], ['B', 'C'], ['B', 'D'], ['C', 'D']]
    pointsDict = {'A': A, 'B': B, 'C': C, 'D': D}
    
    for i, line in enumerate(baseLines):
        p1, p2 = pointsDict[line[0]], pointsDict[line[1]]
        color = '#1a237e' if i < 2 else '#3949ab' if i < 4 else '#7b1fa2'
        ax.plot([p1[0], p2[0]], [p1[1], p2[1]], [p1[2], p2[2]], color=color, linewidth=2.5, linestyle='-')
    
    # 绘制点
    ax.scatter(1, 1, 0, c='#1a237e', s=60, edgecolors='white', linewidths=1.5)
    ax.text(1+0.1, 1+0.1, 0+0.1, 'A', fontsize=11, fontweight='bold', color='#1a237e')
    ax.scatter(0, 0, 1.63, c='#1a237e', s=60, edgecolors='white', linewidths=1.5)
    ax.text(0+0.1, 0+0.1, 1.63+0.1, 'B', fontsize=11, fontweight='bold', color='#1a237e')
    ax.scatter(2, 0, 0, c='#1a237e', s=60, edgecolors='white', linewidths=1.5)
    ax.text(2+0.1, 0+0.1, 0+0.1, 'C', fontsize=11, fontweight='bold', color='#1a237e')
    ax.scatter(0, 2, 0, c='#1a237e', s=60, edgecolors='white', linewidths=1.5)
    ax.text(0+0.1, 2+0.1, 0+0.1, 'D', fontsize=11, fontweight='bold', color='#1a237e')
    
    ax.set_title('四面体旋转观察', fontsize=16, fontweight='bold', pad=20, color='#1a237e')
    ax.set_xlabel('X', fontsize=12, fontweight='bold')
    ax.set_ylabel('Y', fontsize=12, fontweight='bold')
    ax.set_zlabel('Z', fontsize=12, fontweight='bold')
    ax.set_xlim(-1, 3)
    ax.set_ylim(-1, 3)
    ax.set_zlim(-1, 3)
    ax.grid(True, linestyle=':', alpha=0.4)
    
    def update(frame):
        ax.view_init(elev=30, azim=frame * 9)
        return []
    
    ani = animation.FuncAnimation(fig, update, frames=40, interval=100, blit=True)
    ani.save(os.path.join(TEMP_DIR, 'tetrahedron_rotation.gif'), writer='pillow', fps=20, dpi=100)
    print("OK: 四面体旋转动画已保存")

if __name__ == '__main__':
    print("=== 开始测试几何动画生成 ===")
    print()
    
    try:
        test_sphere_rotation()
    except Exception as e:
        print("ERROR: 球体旋转测试失败:", str(e)[:100])
    
    try:
        test_sphere_grow()
    except Exception as e:
        print("ERROR: 球体生长测试失败:", str(e)[:100])
    
    try:
        test_circle()
    except Exception as e:
        print("ERROR: 圆形测试失败:", str(e)[:100])
    
    try:
        test_tetrahedron_rotation()
    except Exception as e:
        print("ERROR: 四面体旋转测试失败:", str(e)[:100])
    
    print()
    print("=== 测试完成 ===")
    print("生成的文件保存在:", TEMP_DIR)
    print("  - sphere_rotation.gif   (球体旋转动画)")
    print("  - sphere_grow.gif        (球体生长动画)")
    print("  - circle.png             (圆形图像)")
    print("  - tetrahedron_rotation.gif (四面体旋转动画)")