import type { Component } from 'vue'
import type { PrimeVueComponentType } from '@/interfaces/entities'
import AutoComplete from 'openvue/autocomplete'
import Calendar from 'openvue/calendar'
import Checkbox from 'openvue/checkbox'
import DataTable from 'openvue/datatable'
import DatePicker from 'openvue/datepicker'
import Dropdown from 'openvue/dropdown'
import Select from 'openvue/select'
import InputNumber from 'openvue/inputnumber'
import InputText from 'openvue/inputtext'
import MultiSelect from 'openvue/multiselect'
import Password from 'openvue/password'
import RadioButton from 'openvue/radiobutton'
import SelectButton from 'openvue/selectbutton'
import Textarea from 'openvue/textarea'
import ToggleSwitch from 'openvue/toggleswitch'
import CrmHtmlEditor from '@/core/ui-kit/CrmHtmlEditor.vue'

const PRIME_VUE_COMPONENT_MAP: Record<PrimeVueComponentType, Component> = {
  InputText,
  Textarea,
  Editor: CrmHtmlEditor,
  InputNumber,
  Password,
  Select,
  Dropdown,
  MultiSelect,
  DatePicker,
  Calendar,
  Checkbox,
  DataTable,
  RadioButton,
  ToggleSwitch,
  SelectButton,
  AutoComplete,
  CrmTreeTable: DataTable,
  // CrmScheduler is rendered by FormRenderer directly — never resolved as a PrimeVue component.
  CrmScheduler: undefined as unknown as Component,
  // Files attachment fields are rendered by FormRenderer — not PrimeVue components.
  Files: undefined as unknown as Component,
  // ChildLookup owns related-option loading and is rendered by FormRenderer directly.
  ChildLookup: undefined as unknown as Component,
  // CrmActivityLog is rendered by FormRendererLight directly — never resolved as a PrimeVue component.
  CrmActivityLog: undefined as unknown as Component,
  // CrmDocEngine is rendered by FormRendererLight / FormRenderer directly.
  CrmDocEngine: undefined as unknown as Component,
  // M2ABlocksField is rendered by FormRendererLight directly — never resolved as a PrimeVue component.
  M2ABuilder: undefined as unknown as Component,
  // CrmM2MMultiSelect is rendered by FormRenderer directly.
  M2MMultiSelect: undefined as unknown as Component,
  // Repeater is rendered by FormRenderer directly — never resolved as a PrimeVue component.
  Repeater: undefined as unknown as Component,
  // Address compound field is rendered by FormRenderer directly.
  Address: undefined as unknown as Component,
  // JSON list / raw editors are rendered by FormRenderer directly.
  JsonList: undefined as unknown as Component,
  JsonCode: undefined as unknown as Component,
  // Sensitivity matrix is rendered by FormRenderer directly.
  SensitivityMatrix: undefined as unknown as Component,
  // BlockLayout is a designer reference only — never resolved as a PrimeVue component.
  BlockLayout: undefined as unknown as Component,
}

export function resolvePrimeVueComponent(
  name: PrimeVueComponentType,
): Component | undefined {
  return PRIME_VUE_COMPONENT_MAP[name]
}
