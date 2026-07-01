import { create } from 'zustand'
import { Modal, ModalFooter } from './Modal'

export interface ConfirmOptions {
  title?: string
  message: string
  confirmText?: string
  cancelText?: string
  /** 危险操作（删除/清空等）用红色确认按钮 */
  danger?: boolean
}

interface ConfirmState {
  open: boolean
  opts: ConfirmOptions | null
  resolve: ((ok: boolean) => void) | null
  request: (opts: ConfirmOptions) => Promise<boolean>
  settle: (ok: boolean) => void
}

const useConfirmStore = create<ConfirmState>((set, get) => ({
  open: false,
  opts: null,
  resolve: null,
  request: (opts) =>
    new Promise<boolean>((resolve) => {
      // 若已有未决确认，先以取消结算，避免 resolver 丢失。
      const prev = get().resolve
      if (prev) prev(false)
      set({ open: true, opts, resolve })
    }),
  settle: (ok) => {
    const { resolve } = get()
    resolve?.(ok)
    set({ open: false, opts: null, resolve: null })
  },
}))

/**
 * 品牌风格全局确认框，替代内置 window.confirm。
 * 用法：`if (await confirm({ message: '确认删除？', danger: true })) { ... }`
 */
export function confirm(opts: ConfirmOptions): Promise<boolean> {
  return useConfirmStore.getState().request(opts)
}

const cancelBtnStyle: React.CSSProperties = {
  background: 'none',
  border: '1px solid var(--border-strong)',
  borderRadius: 'var(--radius-pill)',
  padding: '6px 16px',
  fontSize: 'var(--text-sm)',
  color: 'var(--text-secondary)',
  cursor: 'pointer',
  fontFamily: 'var(--font-sans)',
}

function confirmBtnStyle(danger: boolean): React.CSSProperties {
  return {
    background: danger ? 'var(--danger)' : 'var(--accent)',
    border: `1px solid ${danger ? 'var(--danger)' : 'var(--accent)'}`,
    borderRadius: 'var(--radius-pill)',
    padding: '6px 16px',
    fontSize: 'var(--text-sm)',
    color: 'var(--on-accent)',
    cursor: 'pointer',
    fontFamily: 'var(--font-sans)',
  }
}

/** 挂在应用根部一次即可（见 AppPage）。 */
export function ConfirmHost() {
  const { open, opts, settle } = useConfirmStore()
  const danger = opts?.danger ?? false
  return (
    <Modal open={open} onClose={() => settle(false)} title={opts?.title ?? '确认操作'} maxWidth={420}>
      <p
        style={{
          margin: 0,
          fontSize: 'var(--text-sm)',
          color: 'var(--text-secondary)',
          lineHeight: 1.6,
          whiteSpace: 'pre-wrap',
        }}
      >
        {opts?.message}
      </p>
      <ModalFooter>
        <button onClick={() => settle(false)} style={cancelBtnStyle}>
          {opts?.cancelText ?? '取消'}
        </button>
        <button onClick={() => settle(true)} style={confirmBtnStyle(danger)}>
          {opts?.confirmText ?? '确认'}
        </button>
      </ModalFooter>
    </Modal>
  )
}
