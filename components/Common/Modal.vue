<template>
  <Teleport :to="teleportTo">
    <div
      v-if="modelValue"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-3 sm:p-4"
      role="dialog"
      aria-modal="true"
      :aria-labelledby="titleId"
      @mousedown="onBackdropMousedown"
      @click.self="handleBackdropClick"
    >
      <section
        ref="panelRef"
        tabindex="-1"
        :class="[
          'w-full rounded-xl bg-white shadow-xl max-h-[calc(100vh-2rem)]',
          stickyFooter ? 'flex flex-col overflow-hidden py-4 sm:py-6' : 'scroll-panel overflow-y-auto overscroll-none p-4 sm:p-6',
          widthClass,
          panelClass,
        ]"
      >
        <header v-if="$slots.title || title" :class="[headerClass, stickyFooter ? 'shrink-0 px-4 sm:px-6' : '']">
          <slot name="title">
            <h3 :id="titleId" class="text-lg font-semibold text-base-900">
              {{ title }}
            </h3>
          </slot>
        </header>

        <div
          :class="[
            bodyClass,
            stickyFooter ? 'scroll-panel mr-1 min-h-0 flex-1 overflow-y-auto overscroll-contain pb-1 pl-4 pr-1 pointer-coarse:pr-3 sm:mr-2 sm:pl-6 sm:pr-2 sm:pointer-coarse:pr-4' : '',
          ]"
        >
          <slot />
        </div>

        <footer
          v-if="$slots.footer"
          :class="[footerClass, stickyFooter ? 'shrink-0 border-t border-base-100 mt-4! px-4 pt-4 sm:px-6' : '']"
        >
          <slot name="footer" />
        </footer>
      </section>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, toRef, useId, watch } from 'vue'
import { useBodyScrollLock } from '~/composables/useBodyScrollLock'

const props = withDefaults(defineProps<{
  modelValue: boolean
  title?: string
  widthClass?: string
  panelClass?: string
  headerClass?: string
  bodyClass?: string
  footerClass?: string
  closeOnBackdrop?: boolean
  closeOnEscape?: boolean
  teleportTo?: string
  /** Keep header and footer in view and scroll only the body, so the footer buttons never scroll away. */
  stickyFooter?: boolean
}>(), {
  title: '',
  widthClass: 'max-w-md',
  panelClass: '',
  headerClass: '',
  bodyClass: 'mt-4 space-y-4',
  footerClass: 'mt-6 flex justify-end gap-3',
  closeOnBackdrop: true,
  closeOnEscape: true,
  teleportTo: 'body',
  stickyFooter: false,
})

const emit = defineEmits<{
  (event: 'update:modelValue', value: boolean): void
  (event: 'close'): void
}>()

const titleId = `modal-title-${useId()}`

const panelRef = ref<HTMLElement | null>(null)
let previouslyFocused: HTMLElement | null = null

function tabbableElements(): HTMLElement[] {
  if (!panelRef.value) return []
  const selector = 'a[href], button, input, select, textarea, [tabindex]'
  return Array.from(panelRef.value.querySelectorAll<HTMLElement>(selector))
    .filter(el => !el.hasAttribute('disabled')
      && el.getAttribute('tabindex') !== '-1'
      && el.getAttribute('aria-hidden') !== 'true'
      && (el.offsetParent !== null || el === document.activeElement))
}

function focusFirstElement() {
  const [first] = tabbableElements()
  if (first) first.focus()
  else panelRef.value?.focus()
}

function trapTab(event: KeyboardEvent) {
  const elements = tabbableElements()
  if (elements.length === 0) {
    event.preventDefault()
    panelRef.value?.focus()
    return
  }

  const first = elements[0]!
  const last = elements[elements.length - 1]!
  const active = document.activeElement as HTMLElement | null

  if (event.shiftKey && (active === first || !panelRef.value?.contains(active))) {
    event.preventDefault()
    last.focus()
    return
  }

  if (!event.shiftKey && (active === last || !panelRef.value?.contains(active))) {
    event.preventDefault()
    first.focus()
  }
}

async function captureAndFocus() {
  previouslyFocused = document.activeElement as HTMLElement | null
  await nextTick()
  focusFirstElement()
}

watch(() => props.modelValue, (open) => {
  if (!import.meta.client) return

  if (open) {
    captureAndFocus()
    return
  }

  previouslyFocused?.focus?.()
  previouslyFocused = null
})

let backdropMousedownOnSelf = false

useBodyScrollLock(toRef(props, 'modelValue'))

function close() {
  emit('update:modelValue', false)
  emit('close')
}

function onBackdropMousedown(event: MouseEvent) {
  backdropMousedownOnSelf = event.target === event.currentTarget
}

function handleBackdropClick() {
  if (props.closeOnBackdrop && backdropMousedownOnSelf) close()
}

function handleKeydown(event: KeyboardEvent) {
  if (!props.modelValue) return

  if (event.key === 'Tab') {
    trapTab(event)
    return
  }

  if (!props.closeOnEscape || event.key !== 'Escape') return
  close()
}

onMounted(() => {
  window.addEventListener('keydown', handleKeydown)
  if (props.modelValue) captureAndFocus()
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', handleKeydown)
})
</script>
