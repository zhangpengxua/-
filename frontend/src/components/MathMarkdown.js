import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';

// 公共数学文本组件：保留 $$...$$ 展示数学的换行行为，学习历史与训练题共用。
export default function MathMarkdown({ children }) {
  return (
    <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>
      {(children || '').replace(/\$\$([\s\S]*?)\$\$/g, (_, math) => `$$\n${math.trim()}\n$$`)}
    </ReactMarkdown>
  );
}
