#!/usr/bin/env python3
"""
测试脚本：验证所有动画类型
运行方式：python test_all_animations.py
需要安装依赖：pip install matplotlib numpy pillow
"""

import matplotlib.pyplot as plt
from mpl_toolkits.mplot3d import Axes3D
import matplotlib.animation as animation
import numpy as np
import os

plt.rcParams['font.sans-serif'] = ['SimHei', 'DejaVu Sans']
plt.rcParams['axes.unicode_minus'] = False

TEMP_DIR = os.path.join(os.path.expanduser('~'), 'temp')
os.makedirs(TEMP_DIR, exist_ok=True)

def test_rotate_view():
    """测试1：旋转视角动画（正方体）"""
    fig = plt.figure(figsize=(12, 8), facecolor='white')
    ax = fig.add_subplot(111, projection='3d')
    ax.set_facecolor('#fafafa')
    
    # 正方体顶点
    A = np.array([0, 0, 0])
    B = np.array([2, 0, 0])
    C = np.array([0, 2, 0])
    D = np.array([2, 2, 0])
    A1 = np.array([0, 0, 2])
    B1 = np.array([2, 0, 2])
    C1 = np.array([0, 2, 2])
    D1 = np.array([2, 2, 2])
    
    # 绘制边
    edges = [(A,B), (B,D), (D,C), (C,A),
             (A1,B1), (B1,D1), (D1,C1), (C1,A1),
             (A,A1), (B,B1), (C,C1), (D,D1)]
    
    for edge in edges:
        ax.plot([edge[0][0], edge[1][0]], 
                [edge[0][1], edge[1][1]], 
                [edge[0][2], edge[1][2]], 
                color='#1a237e', linewidth=2.5)
    
    ax.set_xlim(-1, 4)
    ax.set_ylim(-1, 4)
    ax.set_zlim(-1, 3)
    ax.set_title('旋转视角动画', fontsize=16, fontweight='bold')
    
    def update(frame):
        ax.view_init(elev=30, azim=frame * 9)
        return []
    
    ani = animation.FuncAnimation(fig, update, frames=40, interval=100, blit=True)
    ani.save(os.path.join(TEMP_DIR, 'rotate_view.gif'), writer='pillow', fps=20, dpi=100)
    print("OK: 旋转视角动画")

def test_highlight_plane():
    """测试2：高亮平面动画"""
    fig = plt.figure(figsize=(12, 8), facecolor='white')
    ax = fig.add_subplot(111, projection='3d')
    ax.set_facecolor('#fafafa')
    
    # 正方体顶点
    A = np.array([0, 0, 0])
    B = np.array([2, 0, 0])
    C = np.array([0, 2, 0])
    D = np.array([2, 2, 0])
    A1 = np.array([0, 0, 2])
    B1 = np.array([2, 0, 2])
    C1 = np.array([0, 2, 2])
    D1 = np.array([2, 2, 2])
    
    # 绘制边
    edges = [(A,B), (B,D), (D,C), (C,A),
             (A1,B1), (B1,D1), (D1,C1), (C1,A1),
             (A,A1), (B,B1), (C,C1), (D,D1)]
    
    for edge in edges:
        ax.plot([edge[0][0], edge[1][0]], 
                [edge[0][1], edge[1][1]], 
                [edge[0][2], edge[1][2]], 
                color='#1a237e', linewidth=2.5)
    
    # 高亮前面 BCC1B1
    from mpl_toolkits.mplot3d.art3d import Poly3DCollection
    verts = [[B[0], B[1], B[2]], [C[0], C[1], C[2]], [C1[0], C1[1], C1[2]], [B1[0], B1[1], B1[2]]]
    plane = Poly3DCollection([verts], alpha=0, facecolor='#e1bee7', edgecolor='#1a237e', linewidth=2)
    ax.add_collection3d(plane)
    
    ax.set_xlim(-1, 4)
    ax.set_ylim(-1, 4)
    ax.set_zlim(-1, 3)
    ax.set_title('高亮平面动画', fontsize=16, fontweight='bold')
    
    def update(frame):
        alpha = min(frame * 0.02, 0.4)
        plane.set_alpha(alpha)
        return ax,
    
    ani = animation.FuncAnimation(fig, update, frames=20, interval=150, blit=False)
    ani.save(os.path.join(TEMP_DIR, 'highlight_plane.gif'), writer='pillow', fps=20, dpi=100)
    print("OK: 高亮平面动画")

def test_extend_line():
    """测试3：扩展线动画"""
    fig = plt.figure(figsize=(12, 8), facecolor='white')
    ax = fig.add_subplot(111, projection='3d')
    ax.set_facecolor('#fafafa')
    
    # 正方体顶点
    A = np.array([0, 0, 0])
    B = np.array([2, 0, 0])
    C = np.array([0, 2, 0])
    D = np.array([2, 2, 0])
    A1 = np.array([0, 0, 2])
    B1 = np.array([2, 0, 2])
    
    # 绘制边
    edges = [(A,B), (B,D), (D,C), (C,A), (A,A1), (B,B1)]
    for edge in edges:
        ax.plot([edge[0][0], edge[1][0]], 
                [edge[0][1], edge[1][1]], 
                [edge[0][2], edge[1][2]], 
                color='#1a237e', linewidth=2.5)
    
    # 扩展线
    extend_line, = ax.plot([], [], [], color='#ff5722', linewidth=3.5)
    
    ax.set_xlim(-2, 6)
    ax.set_ylim(-1, 3)
    ax.set_zlim(-1, 3)
    ax.set_title('扩展线动画', fontsize=16, fontweight='bold')
    
    def init():
        extend_line.set_data([], [])
        extend_line.set_3d_properties([])
        return extend_line,
    
    def update(frame):
        progress = frame * 0.05
        if progress > 1:
            progress = 1
        x_ext = B[0] + (B[0] - A[0]) * progress * 0.5
        y_ext = B[1] + (B[1] - A[1]) * progress * 0.5
        z_ext = B[2]
        extend_line.set_data([A[0], x_ext], [A[1], y_ext])
        extend_line.set_3d_properties([A[2], z_ext])
        return extend_line,
    
    ani = animation.FuncAnimation(fig, update, init_func=init, frames=40, interval=100, blit=True)
    ani.save(os.path.join(TEMP_DIR, 'extend_line.gif'), writer='pillow', fps=20, dpi=100)
    print("OK: 扩展线动画")

def test_draw_plane():
    """测试4：绘制平面动画"""
    fig = plt.figure(figsize=(12, 8), facecolor='white')
    ax = fig.add_subplot(111, projection='3d')
    ax.set_facecolor('#fafafa')
    
    # 平面顶点
    A = np.array([0, 0, 0])
    B = np.array([2, 0, 0])
    C = np.array([0, 2, 0])
    D = np.array([2, 2, 0])
    
    from mpl_toolkits.mplot3d.art3d import Poly3DCollection
    verts = [[A[0], A[1], A[2]], [B[0], B[1], B[2]], [D[0], D[1], D[2]], [C[0], C[1], C[2]]]
    plane = Poly3DCollection([verts], alpha=0, facecolor='#e1bee7', edgecolor='#1a237e', linewidth=2)
    ax.add_collection3d(plane)
    
    line1, = ax.plot([], [], [], color='#1a237e', linewidth=2)
    line2, = ax.plot([], [], [], color='#1a237e', linewidth=2)
    line3, = ax.plot([], [], [], color='#1a237e', linewidth=2)
    line4, = ax.plot([], [], [], color='#1a237e', linewidth=2)
    
    ax.set_xlim(-1, 4)
    ax.set_ylim(-1, 4)
    ax.set_zlim(-1, 2)
    ax.set_title('绘制平面动画', fontsize=16, fontweight='bold')
    
    def init():
        line1.set_data([], []); line1.set_3d_properties([])
        line2.set_data([], []); line2.set_3d_properties([])
        line3.set_data([], []); line3.set_3d_properties([])
        line4.set_data([], []); line4.set_3d_properties([])
        plane.set_alpha(0)
        return line1, line2, line3, line4, plane
    
    def update(frame):
        if frame < 6:
            t = frame / 5.0
            line1.set_data([A[0] + (B[0]-A[0])*t], [A[1] + (B[1]-A[1])*t])
            line1.set_3d_properties([A[2] + (B[2]-A[2])*t])
        elif frame < 12:
            t = (frame-6) / 5.0
            line2.set_data([B[0] + (D[0]-B[0])*t], [B[1] + (D[1]-B[1])*t])
            line2.set_3d_properties([B[2] + (D[2]-B[2])*t])
        elif frame < 18:
            t = (frame-12) / 5.0
            line3.set_data([D[0] + (C[0]-D[0])*t], [D[1] + (C[1]-D[1])*t])
            line3.set_3d_properties([D[2] + (C[2]-D[2])*t])
        elif frame < 24:
            t = (frame-18) / 5.0
            line4.set_data([C[0] + (A[0]-C[0])*t], [C[1] + (A[1]-C[1])*t])
            line4.set_3d_properties([C[2] + (A[2]-C[2])*t])
        else:
            t = (frame-24) / 5.0
            plane.set_alpha(min(t, 0.3))
        return line1, line2, line3, line4, plane
    
    ani = animation.FuncAnimation(fig, update, init_func=init, frames=30, interval=100, blit=False)
    ani.save(os.path.join(TEMP_DIR, 'draw_plane.gif'), writer='pillow', fps=20, dpi=100)
    print("OK: 绘制平面动画")

def test_extend_plane():
    """测试5：扩展平面动画"""
    fig = plt.figure(figsize=(12, 8), facecolor='white')
    ax = fig.add_subplot(111, projection='3d')
    ax.set_facecolor('#fafafa')
    
    # 平面顶点
    A = np.array([0.5, 0.5, 0])
    B = np.array([1.5, 0.5, 0])
    C = np.array([0.5, 1.5, 0])
    D = np.array([1.5, 1.5, 0])
    
    from mpl_toolkits.mplot3d.art3d import Poly3DCollection
    verts = [[A[0], A[1], A[2]], [B[0], B[1], B[2]], [D[0], D[1], D[2]], [C[0], C[1], C[2]]]
    plane = Poly3DCollection([verts], alpha=0.3, facecolor='#e1bee7', edgecolor='#1a237e', linewidth=2)
    ax.add_collection3d(plane)
    
    ax.set_xlim(-2, 5)
    ax.set_ylim(-2, 5)
    ax.set_zlim(-1, 2)
    ax.set_title('扩展平面动画', fontsize=16, fontweight='bold')
    
    def update(frame):
        factor = 1 + frame * 0.05
        cx = (A[0] + B[0] + C[0] + D[0]) / 4
        cy = (A[1] + B[1] + C[1] + D[1]) / 4
        extended_verts = [
            [cx + (A[0]-cx)*factor, cy + (A[1]-cy)*factor, A[2]],
            [cx + (B[0]-cx)*factor, cy + (B[1]-cy)*factor, B[2]],
            [cx + (D[0]-cx)*factor, cy + (D[1]-cy)*factor, D[2]],
            [cx + (C[0]-cx)*factor, cy + (C[1]-cy)*factor, C[2]]
        ]
        plane.set_verts([extended_verts])
        return ax,
    
    ani = animation.FuncAnimation(fig, update, frames=20, interval=100, blit=False)
    ani.save(os.path.join(TEMP_DIR, 'extend_plane.gif'), writer='pillow', fps=20, dpi=100)
    print("OK: 扩展平面动画")

def test_sphere_rotation():
    """测试6：球体旋转动画"""
    fig = plt.figure(figsize=(12, 8), facecolor='white')
    ax = fig.add_subplot(111, projection='3d')
    ax.set_facecolor('#fafafa')
    
    u = np.linspace(0, 2 * np.pi, 100)
    v = np.linspace(0, np.pi, 100)
    x = 0 + 1.5 * np.outer(np.cos(u), np.sin(v))
    y = 0 + 1.5 * np.outer(np.sin(u), np.sin(v))
    z = 0 + 1.5 * np.outer(np.ones(np.size(u)), np.cos(v))
    ax.plot_surface(x, y, z, color='#1a237e', alpha=0.6)
    
    ax.set_xlim(-3, 3)
    ax.set_ylim(-3, 3)
    ax.set_zlim(-3, 3)
    ax.set_title('球体旋转动画', fontsize=16, fontweight='bold')
    
    def update(frame):
        ax.view_init(elev=30, azim=frame * 9)
        return []
    
    ani = animation.FuncAnimation(fig, update, frames=40, interval=100, blit=True)
    ani.save(os.path.join(TEMP_DIR, 'sphere_rotation.gif'), writer='pillow', fps=20, dpi=100)
    print("OK: 球体旋转动画")

if __name__ == '__main__':
    print("=== 开始测试所有动画类型 ===")
    print()
    
    try:
        test_rotate_view()
    except Exception as e:
        print(f"ERROR: 旋转视角动画失败: {str(e)[:80]}")
    
    try:
        test_highlight_plane()
    except Exception as e:
        print(f"ERROR: 高亮平面动画失败: {str(e)[:80]}")
    
    try:
        test_extend_line()
    except Exception as e:
        print(f"ERROR: 扩展线动画失败: {str(e)[:80]}")
    
    try:
        test_draw_plane()
    except Exception as e:
        print(f"ERROR: 绘制平面动画失败: {str(e)[:80]}")
    
    try:
        test_extend_plane()
    except Exception as e:
        print(f"ERROR: 扩展平面动画失败: {str(e)[:80]}")
    
    try:
        test_sphere_rotation()
    except Exception as e:
        print(f"ERROR: 球体旋转动画失败: {str(e)[:80]}")
    
    print()
    print("=== 测试完成 ===")
    print(f"生成的文件保存在: {TEMP_DIR}")