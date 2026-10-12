export type ToastType = 'success' | 'error' | 'info'

export interface ToastAction {
  label: string
  handler: () => void
}

export interface ToastItem {
  id: string
  message: string
  type: ToastType
  duration: number
  /** Optional inline button; clicking it runs the handler and closes the toast. */
  action?: ToastAction
}

const DEFAULT_DURATION = 10000

export function useToast() {
  const toasts = useState<ToastItem[]>('toast-items', () => [])

  function show(message: string, type: ToastType = 'info', duration = DEFAULT_DURATION, action?: ToastAction) {
    const normalizedMessage = String(message ?? '').trim()
    if (!normalizedMessage) return ''

    const toast: ToastItem = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      message: normalizedMessage,
      type,
      duration,
      ...(action ? { action } : {}),
    }

    toasts.value = [...toasts.value, toast]
    return toast.id
  }

  function remove(id: string) {
    toasts.value = toasts.value.filter(toast => toast.id !== id)
  }

  function clear() {
    toasts.value = []
  }

  return {
    toasts,
    show,
    remove,
    clear,
    success: (message: string, duration?: number) => show(message, 'success', duration),
    error: (message: string, duration?: number) => show(message, 'error', duration),
    info: (message: string, duration?: number) => show(message, 'info', duration),
  }
}
