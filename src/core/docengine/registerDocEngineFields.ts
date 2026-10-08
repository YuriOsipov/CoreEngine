import { registerField } from '@docengine/editor'
import { registerDateField } from '@docengine/field-date'

/** Salesforce DocEngine palette includes Date; the core editor does not ship it. */
registerDateField({ registerField })
