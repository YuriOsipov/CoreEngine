export const typeDefs = /* GraphQL */ `
  scalar JSON

  enum BackendTarget {
    DIRECTUS
    STRAPI
    PAYLOAD
    SUPABASE
    PLATFORM
    HASURA
  }

  enum RelationKind {
    M2O
    O2M
    M2M
    M2A
  }

  type Language {
    code: String!
    label: String!
    isDefault: Boolean!
    isActive: Boolean!
    sort: Int!
  }

  type TranslationEntry {
    key: String!
    language: String!
    value: String!
    namespace: String!
  }

  type LocalizedLabel {
    language: String!
    label: String!
  }

  type Field {
    id: ID!
    apiName: String!
    label: String!
    type: String!
    interface: String!
    options: JSON
    displayOptions: JSON
    labelTranslations: [LocalizedLabel!]!
    required: Boolean!
    readonly: Boolean!
    hidden: Boolean!
    sort: Int!
    isSystem: Boolean!
    """Single-column uniqueness flag (crm_schema unique index)."""
    isUnique: Boolean!
    """Optional btree index on crm_schema column (Lookups always indexed)."""
    isIndexed: Boolean!
  }

  type Relation {
    id: ID!
    kind: RelationKind!
    fieldApiName: String!
    relatedEntityApiName: String
    junctionEntityApiName: String
    allowedEntityApiNames: [String!]!
    meta: JSON
  }

  type EntitySyncSummary {
    lastSyncedVersion: Int
    lastSyncedAt: String
    status: String!
    lastError: String
  }

  """Composite or named unique group (Directus-style avoid-duplicates)."""
  type EntityUniqueGroup {
    name: String!
    fields: [String!]!
  }

  input EntityUniqueGroupInput {
    name: String!
    fields: [String!]!
  }

  """Same-record condition for a record automation rule."""
  type EntityRecordAutomationCondition {
    field: String!
    operator: String!
    value: JSON
    """literal (default) | field"""
    valueSource: String!
    """Other field api_name when valueSource=field"""
    compareField: String
  }

  input EntityRecordAutomationConditionInput {
    field: String!
    operator: String!
    value: JSON
    valueSource: String
    compareField: String
  }

  """Admin rule: on create/update/delete, when conditions match, set fields and/or run actions."""
  type EntityRecordAutomationAction {
    """notify | break | trigger_flow"""
    type: String!
    """info | warn (notify only)"""
    severity: String
    """Toast message (notify only)"""
    message: String
    """app_flow_triggers key (trigger_flow only)"""
    flowKey: String
  }

  input EntityRecordAutomationActionInput {
    type: String!
    severity: String
    message: String
    flowKey: String
  }

  type EntityRecordAutomation {
    id: String!
    name: String!
    enabled: Boolean!
    """Lower number runs first."""
    sort: Int!
    """create, update, and/or delete"""
    triggers: [String!]!
    """and | or"""
    logic: String!
    conditions: [EntityRecordAutomationCondition!]!
    """Fields that must change in this write for the rule to run."""
    requireChanged: [String!]!
    """Field → value. Special tokens: $NOW, $NULL, or {{DATE_ADD_DAYS(...)}} templates"""
    setFields: JSON!
    """Side effects: notify (toast), trigger_flow (after save), break (stop later rules)."""
    actions: [EntityRecordAutomationAction!]!
  }

  input EntityRecordAutomationInput {
    id: String
    name: String!
    enabled: Boolean
    sort: Int
    triggers: [String!]
    logic: String
    conditions: [EntityRecordAutomationConditionInput!]
    requireChanged: [String!]
    setFields: JSON
    actions: [EntityRecordAutomationActionInput!]
  }

  """Create/update registry field (Fields & Relationships)."""
  input RegistryFieldInput {
    apiName: String
    label: String
    type: String
    interface: String
    required: Boolean
    readonly: Boolean
    hidden: Boolean
    sort: Int
    options: JSON
    displayOptions: JSON
    isUnique: Boolean
    isIndexed: Boolean
    """M2O and M2M supported for create; O2M/M2A create not yet."""
    relationKind: RelationKind
    relatedEntity: String
    junctionEntity: String
    relationMeta: JSON
  }

  type Entity {
    id: ID!
    apiName: String!
    label: String!
    """Optional description (stored in backend_config.note)."""
    note: String
    icon: String
    singleton: Boolean!
    group: String
    displayTemplate: String
    """SUPABASE | PLATFORM | HASURA | DIRECTUS (STRAPI/PAYLOAD reserved)."""
    backendTarget: BackendTarget!
    """Storage + uniqueGroups + note/accountability JSON from public.entities.backend_config."""
    backendConfig: JSON!
    """Effective unique groups (backend_config.uniqueGroups + fields.is_unique)."""
    uniqueGroups: [EntityUniqueGroup!]!
    """Record automations from backend_config.automations (field updates on save)."""
    automations: [EntityRecordAutomation!]!
    labelTranslations: [LocalizedLabel!]!
    hidden: Boolean!
    """all | activity | null (do not track). Default all when unset."""
    accountability: String
    """Platform / internal object — hidden from Object Manager pickers."""
    internal: Boolean!
    fields: [Field!]!
    relations: [Relation!]!
    syncState: EntitySyncSummary
  }

  input UpdateEntityMetaInput {
    label: String
    note: String
    icon: String
    displayTemplate: String
    hidden: Boolean
    singleton: Boolean
    internal: Boolean
    """Pass null to disable tracking. Use \"all\" or \"activity\"."""
    accountability: String
  }

  """Create a new registry object (Object Manager)."""
  input CreateRegistryEntityInput {
    apiName: String!
    label: String!
    note: String
    icon: String
    singleton: Boolean
    hidden: Boolean
    displayTemplate: String
    group: String
  }

  type LayoutSetting {
    id: ID!
    entityApiName: String!
    groupKey: String!
    subGroup: String
    roleId: ID
    payload: JSON!
    createdAt: String
    updatedAt: String
  }

  input UpsertLayoutSettingInput {
    settingId: String
    entityApiName: String!
    groupKey: String!
    subGroup: String
    roleId: ID
    name: String
    body: JSON!
  }

  """Directus-compatible dashboard row (public id = backend_dashboard_id)."""
  type Dashboard {
    id: ID!
    name: String!
    icon: String
    note: String
    color: String
  }

  input UpsertDashboardInput {
    id: ID
    name: String!
    icon: String
    note: String
    color: String
  }

  """Directus-compatible panel row (public id = backend_panel_id)."""
  type Panel {
    id: ID!
    dashboard: ID!
    name: String
    icon: String
    color: String
    show_header: Boolean
    note: String
    type: String!
    position_x: Int
    position_y: Int
    width: Int
    height: Int
    options: JSON
  }

  input UpsertPanelInput {
    id: ID
    dashboard: ID!
    name: String
    icon: String
    color: String
    show_header: Boolean
    note: String
    type: String!
    position_x: Int
    position_y: Int
    width: Int
    height: Int
    options: JSON
  }

  type RecordPage {
    nodes: [JSON!]!
    totalCount: Int!
  }

  type Health {
    ok: Boolean!
    service: String!
    registryEntities: Int!
    translationEntries: Int!
    layoutSettings: Int!
  }

  type RecordActivity {
    id: ID!
    entityApiName: String!
    recordId: ID!
    action: String!
    userId: ID
    comment: String
    createdAt: String!
    revisionIds: [ID!]!
  }

  type RecordActivityPage {
    nodes: [RecordActivity!]!
    totalCount: Int!
  }

  type RecordRevision {
    id: ID!
    activityId: ID
    entityApiName: String!
    recordId: ID!
    snapshot: JSON!
    parentRevisionId: ID
    createdAt: String!
  }

  type SchemaDriftItem {
    kind: String!
    entityApiName: String!
    fieldApiName: String
    registryValue: String
    backendValue: String
    message: String!
  }

  type EntityDriftReport {
    entityId: ID!
    entityApiName: String!
    backendTarget: String!
    status: String!
    drift: [SchemaDriftItem!]!
  }

  type EntitySyncState {
    entityId: ID!
    entityApiName: String!
    lastSyncedVersion: Int
    lastSyncedAt: String
    status: String!
    lastError: String
    backendSnapshot: JSON!
    updatedAt: String!
  }

  type SyncJob {
    id: ID!
    entityId: ID
    jobType: String!
    status: String!
    payload: JSON!
    result: JSON!
    error: String
    createdAt: String!
    startedAt: String
    finishedAt: String
  }

  type Query {
    health: Health!
    languages: [Language!]!
    translations(
      language: String!
      namespace: String
      prefix: String
      limit: Int = 5000
    ): [TranslationEntry!]!
    translate(key: String!, language: String!, fallback: String): String!
    entities(includeHidden: Boolean = false): [Entity!]!
    entity(apiName: String!): Entity
    entitySchema(apiName: String!, language: String): Entity!
    """Full registry snapshot for Vue metadata caches (collections/fields/relations)."""
    registrySnapshot(includeHidden: Boolean = true): [Entity!]!
    layoutSettings(
      entity: String
      groupKey: String
      subGroup: String
    ): [LayoutSetting!]!
    record(entity: String!, id: ID!, fields: [String!]): JSON
    records(
      entity: String!
      filter: JSON
      fields: [String!]
      sort: [String!]
      search: String
      limit: Int = 50
      offset: Int = 0
      includeDeleted: Boolean = false
    ): RecordPage!
    recordActivities(
      entity: String!
      recordId: ID!
      actions: [String!]
      limit: Int = 50
      offset: Int = 0
    ): RecordActivityPage!
    recordRevisions(
      entity: String!
      recordId: ID!
      limit: Int = 500
    ): [RecordRevision!]!
    """File metadata by id from public.files (Supabase Storage)."""
    file(id: ID!, fields: [String!]): JSON
    """File metadata by ids from public.files."""
    files(ids: [ID!]!, fields: [String!]): [JSON!]!
    """Files attached to any CRM record (shared Files object)."""
    recordFiles(collection: String!, recordId: ID!, fields: [String!]): [JSON!]!
    schemaDrift(entity: String): [EntityDriftReport!]!
    entitySyncStates: [EntitySyncState!]!
    syncJobs(limit: Int = 20): [SyncJob!]!
    userSetting(
      userId: ID!
      collection: String!
      groupKey: String!
      key: String!
    ): JSON
    """Org-wide setting (e.g. company_profile locale / address)."""
    orgSetting(key: String!): JSON
    recentRecordViews(
      userId: ID!
      collection: String!
      limit: Int = 100
      offset: Int = 0
    ): RecentRecordPage!
    """App roles for layout/role pickers from app_roles (id = backend_role_id)."""
    roles: [Role!]!
    """Admin list of all app_roles (id = app_roles.id)."""
    appRolesAdmin: [AppRoleAdmin!]!
    """Admin list of app_users (includes inactive)."""
    appUsersAdmin(search: String, includeInactive: Boolean = true): [AppUserAdmin!]!
    """Permission matrix rows for a role (app_roles.id or backend_role_id)."""
    rolePermissions(roleId: ID!): [RolePermission!]!
    """Entities available for the role permission matrix."""
    permissionEntities: [PermissionEntity!]!
    """CRUD flags for the authenticated user's role (admins get full access)."""
    myRolePermissions: [RolePermission!]!
    """Current user from app_users (BFF JWT verified locally)."""
    me: CurrentUser!
    """App users for activity labels and user pickers."""
    users(
      ids: [ID!]
      search: String
      fields: [String!]
      limit: Int
      sort: [String!]
    ): [JSON!]!
    """Bookmark presets for document remote lists (app_presets)."""
    presets(
      fields: [String!]
      filter: JSON
      sort: [String!]
      limit: Int = -1
    ): [JSON!]!
    """Dashboard metadata (app_dashboards)."""
    dashboards(
      fields: [String!]
      sort: [String!]
      limit: Int = -1
    ): [JSON!]!
    """Panel metadata (app_panels)."""
    panels(
      fields: [String!]
      filter: JSON
      sort: [String!]
      limit: Int = -1
    ): [JSON!]!
    """Aggregate query for dashboard panels over CRM entity tables (crm_schema)."""
    aggregateRecords(
      entity: String!
      aggregate: JSON!
      groupBy: [String!]
      filter: JSON
      limit: Int = -1
    ): [JSON!]!
    """Admin: cron jobs owned by the BFF scheduler."""
    scheduledTasks: [ScheduledTask!]!
    scheduledTaskRuns(taskId: ID!, limit: Int = 20): [ScheduledTaskRun!]!
    """Admin: local flow triggers (app_flow_triggers) — key → http/update_record."""
    flowTriggers: [FlowTrigger!]!
    """
    Group hierarchy with nested prices (exact group-field match per node).
    config is required: collections + parent/group/scope field paths from Tree settings.
    Always returns { tree, rows, sections }. When flatten is false, rows is [].
    """
    itemGroupPriceTree(
      priceGroupId: ID
      filter: JSON
      fields: [String!]
      flatten: Boolean = true
      config: JSON
    ): JSON
  }

  type ScheduledTask {
    id: ID!
    key: String!
    name: String!
    jobType: String!
    cron: String!
    schedule: JSON!
    timezone: String!
    enabled: Boolean!
    params: JSON!
    description: String
    lastRunAt: String
    nextRunAt: String
    lastStatus: String
    lastError: String
    createdAt: String!
    updatedAt: String!
  }

  type ScheduledTaskRun {
    id: ID!
    taskId: ID!
    status: String!
    trigger: String!
    payload: JSON!
    result: JSON
    error: String
    startedAt: String!
    finishedAt: String
    createdAt: String!
  }

  type GenerateScheduleResult {
    templatesProcessed: Int!
    created: Int!
    skipped: Int!
  }

  """
  Server-side DocEngine generation for automations / n8n.
  Contract: docs/generate-document-api.md — implementation phased.
  """
  input GenerateDocumentInput {
    """Entity api_name (e.g. opportunity). Aligns with automation payload collection."""
    collectionName: String!
    """Record id to fill the template from."""
    recordId: ID!
    templateId: ID!
    """pdf | html (default pdf)"""
    outputFormat: String = "pdf"
    """completed | draft (default completed)"""
    documentStatus: String = "completed"
    """Create/update doc_value (default true)"""
    persist: Boolean = true
    """Render file and set output_file (default true; Phase 2)"""
    renderOutput: Boolean = true
    """Merge/override mapped values"""
    valuesOverride: JSON
    """always_create | update_latest_draft (default always_create)"""
    upsertMode: String = "always_create"
  }

  type GenerateDocumentResult {
    docValueId: ID
    templateId: ID!
    templateSnapshotId: ID
    collectionName: String!
    recordId: ID!
    documentStatus: String!
    outputFormat: String!
    outputFileId: ID
    downloadUrl: String
    values: JSON
  }

  input UpsertScheduledTaskInput {
    id: ID
    key: String
    name: String!
    jobType: String!
    cron: String
    schedule: JSON
    timezone: String
    enabled: Boolean
    params: JSON
    description: String
  }

  """Local app_flow_triggers row — maps a key used by automations/actions to a handler."""
  type FlowTrigger {
    key: String!
    """http | update_record"""
    handler: String!
    enabled: Boolean!
    """http: { url, method, headers, auth? }. update_record: { collection, recordId?, patch? }."""
    config: JSON!
    description: String
    updatedAt: String!
  }

  input UpsertFlowTriggerInput {
    key: String!
    handler: String!
    enabled: Boolean
    config: JSON
    description: String
  }

  type Role {
    id: ID!
    name: String!
  }

  type AppRoleAdmin {
    id: ID!
    name: String!
    isAdmin: Boolean!
    backendRoleId: String
    userCount: Int!
  }

  type AppUserAdmin {
    id: ID!
    backendUserId: String
    email: String
    firstName: String
    lastName: String
    roleId: ID
    roleName: String
    isActive: Boolean!
    hasPassword: Boolean!
  }

  type RolePermission {
    entityApiName: String!
    canCreate: Boolean!
    canRead: Boolean!
    canUpdate: Boolean!
    canDelete: Boolean!
    canImport: Boolean!
    canExport: Boolean!
  }

  type PermissionEntity {
    apiName: String!
    label: String!
    hidden: Boolean!
  }

  input RolePermissionInput {
    entityApiName: String!
    canCreate: Boolean!
    canRead: Boolean!
    canUpdate: Boolean!
    canDelete: Boolean!
    canImport: Boolean!
    canExport: Boolean!
  }

  input CreateAppRoleInput {
    name: String!
    isAdmin: Boolean = false
  }

  input UpdateAppRoleInput {
    name: String
    isAdmin: Boolean
  }

  input CreateAppUserInput {
    email: String!
    firstName: String
    lastName: String
    roleId: ID
    password: String
    isActive: Boolean = true
  }

  input UpdateAppUserInput {
    email: String
    firstName: String
    lastName: String
    roleId: ID
    isActive: Boolean
  }

  type CurrentUser {
    id: ID
    firstName: String
    lastName: String
    email: String
    adminAccess: Boolean!
    roleId: ID
    roleName: String
    roleAdminAccess: Boolean!
    mustChangePassword: Boolean!
  }

  type RecentRecordView {
    id: ID!
    userId: ID!
    collection: String!
    recordId: String!
    viewedAt: String!
  }

  type RecentRecordPage {
    ids: [ID!]!
    views: [RecentRecordView!]!
    totalCount: Int!
  }

  """Result of bulkUpdateRelatedFromAction (sourcePath × multiplier → targetField)."""
  type BulkUpdateRelatedResult {
    createdCount: Int!
    updatedCount: Int!
    skippedCount: Int!
  }

  type Mutation {
    upsertLayoutSetting(input: UpsertLayoutSettingInput!): LayoutSetting!
    deleteLayoutSetting(settingId: String!): Boolean!
    upsertDashboard(input: UpsertDashboardInput!): Dashboard!
    deleteDashboard(id: ID!): Boolean!
    upsertPanel(input: UpsertPanelInput!): Panel!
    deletePanel(id: ID!): Boolean!
    createRecord(entity: String!, data: JSON!, fields: [String!]): JSON!
    updateRecord(entity: String!, id: ID!, data: JSON!, fields: [String!]): JSON!
    softDeleteRecord(entity: String!, id: ID!): JSON!
    """Hard-delete a row (junction rows, etc.). Prefer softDeleteRecord for business records."""
    deleteRecord(entity: String!, id: ID!): Boolean!
    restoreRecord(entity: String!, id: ID!): JSON!
    runSchemaDriftCheck(entity: String): SyncJob!
    """Apply registry→crm_schema DDL (ADD COLUMN, backfill, indexes, FKs) + unique indexes. dryRun defaults to true."""
    runSchemaSync(entity: String!, dryRun: Boolean = true): SyncJob!
    """Replace entities.backend_config.uniqueGroups and apply UNIQUE indexes when typed."""
    upsertEntityUniqueGroups(
      entity: String!
      groups: [EntityUniqueGroupInput!]!
      applyIndexes: Boolean = true
    ): [EntityUniqueGroup!]!
    """Replace entities.backend_config.automations (record field-update rules)."""
    upsertEntityAutomations(
      entity: String!
      automations: [EntityRecordAutomationInput!]!
    ): [EntityRecordAutomation!]!
    """Update entity label/icon/template/hidden/singleton + note/accountability in backend_config."""
    updateEntityMeta(entity: String!, input: UpdateEntityMetaInput!): Entity!
    """Create a registry object (+ system fields). applyDdl creates crm_schema table."""
    createRegistryEntity(
      input: CreateRegistryEntityInput!
      applyDdl: Boolean = true
    ): Entity!
    """Soft-delete a registry object (does not DROP crm_schema table)."""
    deleteRegistryEntity(entity: String!): Boolean!
    createAppRole(input: CreateAppRoleInput!): AppRoleAdmin!
    updateAppRole(id: ID!, input: UpdateAppRoleInput!): AppRoleAdmin!
    deleteAppRole(id: ID!): Boolean!
    createAppUser(input: CreateAppUserInput!): AppUserAdmin!
    updateAppUser(id: ID!, input: UpdateAppUserInput!): AppUserAdmin!
    setAppUserPassword(id: ID!, password: String!): Boolean!
    """Replace the full CRUD permission matrix for a role."""
    replaceRolePermissions(
      roleId: ID!
      permissions: [RolePermissionInput!]!
    ): [RolePermission!]!
    """Toggle fields.is_unique and optionally refresh UNIQUE indexes."""
    setFieldIsUnique(
      entity: String!
      field: String!
      isUnique: Boolean!
      applyIndexes: Boolean = true
    ): Boolean!
    """Create a registry field (+ optional M2O). applyDdl promotes crm_schema column."""
    createRegistryField(
      entity: String!
      input: RegistryFieldInput!
      applyDdl: Boolean = true
    ): Field!
    """Update a registry field by id. applyDdl runs DDL sync for the entity."""
    updateRegistryField(
      id: ID!
      input: RegistryFieldInput!
      applyDdl: Boolean = true
    ): Field!
    """Delete a non-system registry field (does not DROP physical column)."""
    deleteRegistryField(
      entity: String!
      field: String!
      applyDdl: Boolean = false
    ): Boolean!
    upsertUserSetting(
      userId: ID!
      collection: String!
      groupKey: String!
      key: String!
      value: JSON
    ): Boolean!
    upsertOrgSetting(key: String!, value: JSON): Boolean!
    upsertRecentRecordView(
      userId: ID!
      collection: String!
      recordId: ID!
      viewedAt: String
    ): RecentRecordView!
    upsertScheduledTask(input: UpsertScheduledTaskInput!): ScheduledTask!
    deleteScheduledTask(id: ID!): Boolean!
    runScheduledTask(id: ID!): ScheduledTaskRun!
    upsertFlowTrigger(input: UpsertFlowTriggerInput!): FlowTrigger!
    deleteFlowTrigger(key: String!): Boolean!
    """
    Generate a DocEngine document for a parent record (populate → optional PDF/HTML).
    See docs/generate-document-api.md. Stub until Phase 1 implementation.
    """
    generateDocument(input: GenerateDocumentInput!): GenerateDocumentResult!
    generateScheduleSlots(
      rangeStart: String!
      rangeEnd: String!
      providerIds: [ID!]
      facilityIds: [ID!]
    ): GenerateScheduleResult!
    """
    For each related row under the parent record, set targetField from a custom formula.
    formula uses {{source}} (sourcePath value) and {{prompt}} (multiplier), e.g.
    "{{source}} * (1 - {{prompt}} / 100)". Legacy presets multiply / percentOff still work.
    When sourceCollection + sourceLinkField are set, upserts related rows from the source
    collection (optionally active only) before applying the formula.
    Used by Record Action behavior bulkUpdateRelated.
    """
    bulkUpdateRelatedFromAction(
      collection: String!
      recordId: ID!
      relatedCollection: String!
      targetField: String!
      sourcePath: String!
      multiplier: Float!
      formula: String = "{{source}} * {{prompt}}"
      sourceCollection: String
      sourceLinkField: String
      activeSourcesOnly: Boolean = true
    ): BulkUpdateRelatedResult!
    """
    Patch rows in a list collection matching filter or explicit ids using a custom formula.
    Used by List View Action behavior bulkUpdate (filtered / visible scope).
    """
    bulkUpdateFilteredFromAction(
      collection: String!
      targetField: String!
      sourcePath: String!
      multiplier: Float!
      formula: String = "{{source}} * {{prompt}}"
      filter: JSON
      recordIds: [ID!]
    ): BulkUpdateRelatedResult!
  }
`
