/** Collection holding the recurrence rule templates. */
export const SCHEDULE_TEMPLATE_COLLECTION = 'crm_schedule_template'
/** Collection holding the materialized, dated slots. */
export const SCHEDULE_SLOT_COLLECTION = 'crm_schedule'
/** JSON field on the template collection storing a single recurrence rule. */
export const SCHEDULE_TEMPLATE_RULE_FIELD = 'template'
/** M2O field on the slot collection linking back to the source template record. */
export const SCHEDULE_SLOT_TEMPLATE_FIELD = 'template'
