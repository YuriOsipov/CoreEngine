<script lang="ts">
export default {
  name: 'ScheduleSetupPage',
}
</script>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { RouterLink } from 'vue-router'
import { useTranslation } from '@/core/translation'
import ScheduleSlotGenerator from '@/core/ui-kit/ScheduleSlotGenerator.vue'
import CrmNotFoundState from '@/core/ui-kit/CrmNotFoundState.vue'
import {
  SCHEDULE_SLOT_COLLECTION,
  SCHEDULE_TEMPLATE_COLLECTION,
} from '@/core/scheduleGeneration'
import { scheduleFeatureAvailable } from '../services/scheduleFeature'

const { t } = useTranslation()
const generatorVisible = ref(false)
const ready = ref(false)
const scheduleAvailable = ref(false)

onMounted(() => {
  void scheduleFeatureAvailable().then((available) => {
    scheduleAvailable.value = available
    ready.value = true
  })
})
</script>

<template>
  <section class="setup-tab-content">
    <CrmNotFoundState
      v-if="ready && !scheduleAvailable"
      :title="t('schedule.notFoundTitle', 'Schedule not available')"
      :detail="
        t(
          'schedule.notFoundDetail',
          'Schedule collections are not installed in this organization.',
        )
      "
      :back-label="t('setup.generalTab', 'General')"
      back-to="/setup/general"
    />

    <template v-else-if="ready">
      <h2>{{ t('schedule.setupTitle', 'Schedule') }}</h2>
      <p class="text-muted-color m-0">
        {{
          t(
            'schedule.setupSubtitle',
            'Manage provider work-time templates and generate real time slots for a period.',
          )
        }}
      </p>

      <div class="grid gap-3 grid-cols-[repeat(auto-fit,minmax(240px,1fr))] mt-4">
        <div class="border border-surface-200 rounded-lg flex flex-col gap-3 p-4">
          <div class="flex flex-col gap-1">
            <h3 class="text-[0.95rem] m-0">
              {{ t('schedule.generateTitle', 'Generate schedule slots') }}
            </h3>
            <p class="text-muted-color text-[0.8rem] m-0">
              {{
                t(
                  'schedule.setupGenerateHint',
                  'Expand published templates into dated slots for the chosen period.',
                )
              }}
            </p>
          </div>
          <Button
            class="self-start"
            :label="t('schedule.generate', 'Generate slots')"
            icon="pi pi-calendar-plus"
            @click="generatorVisible = true"
          />
        </div>

        <div class="border border-surface-200 rounded-lg flex flex-col gap-3 p-4">
          <div class="flex flex-col gap-1">
            <h3 class="text-[0.95rem] m-0">
              {{ t('schedule.templatesTitle', 'Schedule templates') }}
            </h3>
            <p class="text-muted-color text-[0.8rem] m-0">
              {{
                t(
                  'schedule.templatesHint',
                  'Define recurring work-time rules per provider (intake / block).',
                )
              }}
            </p>
          </div>
          <RouterLink
            class="self-start"
            :to="{ name: 'object-list', params: { collection: SCHEDULE_TEMPLATE_COLLECTION } }"
          >
            <Button
              :label="t('schedule.openTemplates', 'Open templates')"
              icon="pi pi-list"
              severity="secondary"
              outlined
            />
          </RouterLink>
        </div>

        <div class="border border-surface-200 rounded-lg flex flex-col gap-3 p-4">
          <div class="flex flex-col gap-1">
            <h3 class="text-[0.95rem] m-0">
              {{ t('schedule.slotsTitle', 'Generated slots') }}
            </h3>
            <p class="text-muted-color text-[0.8rem] m-0">
              {{
                t(
                  'schedule.slotsHint',
                  'Review, move or delete the materialized slots after generation.',
                )
              }}
            </p>
          </div>
          <RouterLink
            class="self-start"
            :to="{ name: 'object-list', params: { collection: SCHEDULE_SLOT_COLLECTION } }"
          >
            <Button
              :label="t('schedule.openSlots', 'Open slots')"
              icon="pi pi-calendar"
              severity="secondary"
              outlined
            />
          </RouterLink>
        </div>
      </div>

      <ScheduleSlotGenerator v-model:visible="generatorVisible" />
    </template>
  </section>
</template>
