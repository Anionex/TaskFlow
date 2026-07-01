/**
 * Markdown — 渲染助理回复。支持 GFM（表格、删除线、任务列表等）。
 * react-markdown 默认不渲染原始 HTML，天然防 XSS。样式见 app.css 的 .tf-md。
 */
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

export function Markdown({ text }: { text: string }) {
  return (
    <div className="tf-md">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          // 外链新窗打开并加安全 rel
          a: ({ node: _node, ...props }) => (
            <a {...props} target="_blank" rel="noopener noreferrer" />
          ),
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  )
}
