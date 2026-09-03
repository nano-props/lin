import type { Ref, VNodeRef } from 'vue'

export type ElementRef<T> = Ref<T | null> | ((value: T | null) => void)

export function toButtonVNodeRef(target: ElementRef<HTMLButtonElement> | undefined): VNodeRef | undefined {
  if (!target) return undefined
  return (value) => {
    const element = value instanceof HTMLButtonElement ? value : null
    if (typeof target === 'function') target(element)
    else target.value = element
  }
}

export function toDivVNodeRef(target: ElementRef<HTMLDivElement> | undefined): VNodeRef | undefined {
  if (!target) return undefined
  return (value) => {
    const element = value instanceof HTMLDivElement ? value : null
    if (typeof target === 'function') target(element)
    else target.value = element
  }
}
