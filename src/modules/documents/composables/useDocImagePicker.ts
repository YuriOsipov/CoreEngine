import { reactive } from 'vue'
import type { ImageValue } from '@/core/fileImageValue'

export interface DocImagePickerRequest {
  title: string
  value: ImageValue
  collection?: string
  recordId?: string
  resolve: (value: ImageValue) => void
  reject: (error: Error) => void
}

const state = reactive<{
  visible: boolean
  request: DocImagePickerRequest | null
}>({
  visible: false,
  request: null,
})

export function openDocImagePicker(options: {
  title: string
  value: ImageValue
  collection?: string
  recordId?: string
}): Promise<ImageValue> {
  return new Promise((resolve, reject) => {
    state.request = {
      title: options.title,
      value: options.value,
      collection: options.collection,
      recordId: options.recordId,
      resolve,
      reject,
    }
    state.visible = true
  })
}

export function useDocImagePicker() {
  return state
}

export function closeDocImagePicker(): void {
  state.visible = false
  state.request = null
}
