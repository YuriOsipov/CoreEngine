import { createApp } from 'vue'
import PrimeVue from 'openvue/config'
import ConfirmationService from 'openvue/confirmationservice'
import ToastService from 'openvue/toastservice'
import Aura from '@openvue/themes/aura'
import FloatingVue from 'floating-vue'
import App from './App.vue'
import { router } from './core/router'
import {
  getTranslationLanguage,
  preloadTranslations,
  type TranslationLanguage,
} from './core/translation'
import '@/core/docengine/registerDocEngineFields'
import './style.css'
import '@fontsource/inter/400.css'
import '@fontsource/inter/500.css'
import '@fontsource/inter/600.css'
import '@fontsource/inter/700.css'
import 'primeicons/primeicons.css'
import 'floating-vue/dist/style.css'
import 'quill/dist/quill.snow.css'

void bootstrap()

async function bootstrap(): Promise<void> {
  const language = getTranslationLanguage()
  await preloadTranslations(language)

  const app = createApp(App)

  app.use(PrimeVue, {
    theme: {
      preset: Aura,
    },
    locale: primeVueLocale(language),
  })

  app.use(ConfirmationService)
  app.use(ToastService)
  app.use(FloatingVue)
  app.use(router)

  await router.isReady()
  app.mount('#app')
}

function primeVueLocale(language: TranslationLanguage) {
  if (language === 'uk-UA') {
    return {
      firstDayOfWeek: 1,
      dayNames: [
        'неділя',
        'понеділок',
        'вівторок',
        'середа',
        'четвер',
        'п’ятниця',
        'субота',
      ],
      dayNamesShort: ['нд', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'],
      dayNamesMin: ['Нд', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'],
      monthNames: [
        'січень',
        'лютий',
        'березень',
        'квітень',
        'травень',
        'червень',
        'липень',
        'серпень',
        'вересень',
        'жовтень',
        'листопад',
        'грудень',
      ],
      monthNamesShort: [
        'січ.',
        'лют.',
        'бер.',
        'квіт.',
        'трав.',
        'черв.',
        'лип.',
        'серп.',
        'вер.',
        'жовт.',
        'лист.',
        'груд.',
      ],
      today: 'Сьогодні',
      clear: 'Очистити',
      weekHeader: 'Тиж',
      dateFormat: 'dd.mm.yy',
    }
  }

  return {
    firstDayOfWeek: 0,
    dayNames: [
      'Sunday',
      'Monday',
      'Tuesday',
      'Wednesday',
      'Thursday',
      'Friday',
      'Saturday',
    ],
    dayNamesShort: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
    dayNamesMin: ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'],
    monthNames: [
      'January',
      'February',
      'March',
      'April',
      'May',
      'June',
      'July',
      'August',
      'September',
      'October',
      'November',
      'December',
    ],
    monthNamesShort: [
      'Jan',
      'Feb',
      'Mar',
      'Apr',
      'May',
      'Jun',
      'Jul',
      'Aug',
      'Sep',
      'Oct',
      'Nov',
      'Dec',
    ],
    today: 'Today',
    clear: 'Clear',
    weekHeader: 'Wk',
    dateFormat: 'mm/dd/yy',
  }
}
