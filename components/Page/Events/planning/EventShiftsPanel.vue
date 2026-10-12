<template>
  <section class="-mx-6 bg-white p-4 shadow-sm sm:mx-0 sm:rounded-xl sm:shadow-lg">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h2 class="text-lg font-semibold">{{ t('event.planning.shifts') }}</h2>
        <p class="text-sm text-base-500">{{ shiftModeHint }}</p>
      </div>

      <div class="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:justify-end">
        <PageAuditScopedHistoryButton v-if="eventId" :tables="['event_shift_slots', 'event_shift_type_descriptions', 'event_shift_members>event_shift_slots:event_id']" :parent-id="eventId" :context="t('event.planning.shifts')" />
        <div v-if="canManage" class="flex w-full rounded-lg bg-base-100 p-1 sm:inline-flex sm:w-auto">
          <button
            type="button"
            class="flex-1 rounded-md px-3 py-1.5 text-sm font-medium cursor-pointer sm:flex-none"
            :class="permissionMode === 'own' ? 'bg-white text-base-900 shadow-sm' : 'text-base-600'"
            @click="permissionMode = 'own'"
          >
            {{ t('event.planning.ownOnly') }}
          </button>
          <button
            type="button"
            class="flex-1 rounded-md px-3 py-1.5 text-sm font-medium cursor-pointer sm:flex-none"
            :class="permissionMode === 'manage' ? 'bg-white text-base-900 shadow-sm' : 'text-base-600'"
            @click="permissionMode = 'manage'"
          >
            {{ t('event.planning.manageAll') }}
          </button>
        </div>

        <button
          type="button"
          class="inline-flex flex-1 items-center justify-center gap-1.5 rounded-md border px-2.5 py-1.5 text-sm font-medium cursor-pointer sm:flex-none"
          :class="showUnderstaffedOnly ? 'border-warning-300 bg-warning-50 text-warning-800' : 'border-base-200 bg-white text-base-600 hover:bg-base-50'"
          :disabled="loading"
          @click="showUnderstaffedOnly = !showUnderstaffedOnly"
        >
          <Icon name="material-symbols:warning-rounded" />
          {{ t('event.planning.showUnderstaffedOnly') }}
        </button>
        <button
          type="button"
          class="inline-flex flex-1 items-center justify-center gap-1.5 rounded-md border px-2.5 py-1.5 text-sm font-medium cursor-pointer sm:flex-none"
          :class="showMyShiftsOnly ? 'border-info-300 bg-info-50 text-info-800' : 'border-base-200 bg-white text-base-600 hover:bg-base-50'"
          :disabled="loading"
          @click="showMyShiftsOnly = !showMyShiftsOnly"
        >
          <Icon name="material-symbols:person-rounded" />
          {{ t('event.planning.showMyShiftsOnly') }}
        </button>
        <button
          type="button"
          class="btn-secondary inline-flex flex-1 items-center justify-center gap-1.5 py-1.5 disabled:opacity-60 sm:flex-none h-8.5"
          :disabled="loading || !eventId"
          @click="pdfExportOpen = true"
        >
          <Icon name="material-symbols:download-rounded" />
          {{ t('event.planning.exportShiftPlanPdf') }}
        </button>
      </div>
    </div>

    <div v-if="permissionMode === 'manage' && canManage" class="mt-4 rounded-lg border border-base-200 bg-base-50 p-3">
      <div class="grid gap-3 sm:grid-cols-4 sm:items-end lg:grid-cols-3 lg:items-end xl:grid-cols-[minmax(10rem,1fr)_12rem_12rem_6rem_7rem_auto]">
        <div class="sm:col-span-4 lg:col-span-1">
          <label class="text-xs font-medium text-base-500">{{ t('event.planning.shiftName') }}</label>
          <input v-model="newShift.name" class="input mt-1" :disabled="disabled || saving">
        </div>
        <div class="sm:col-span-2 lg:col-span-1">
          <label class="text-xs font-medium text-base-500">{{ t('event.planning.startTime') }}</label>
          <CommonDateInput v-model="newShift.startsAt" mode="datetime" class="mt-1" :disabled="disabled || saving" />
        </div>
        <div class="sm:col-span-2 lg:col-span-1">
          <label class="text-xs font-medium text-base-500">{{ t('event.planning.endTime') }}</label>
          <CommonDateInput v-model="newShift.endsAt" mode="datetime" class="mt-1" :disabled="disabled || saving" />
        </div>
        <div class="sm:col-span-1">
          <label class="text-xs font-medium text-base-500">{{ t('event.planning.requiredPeople') }}</label>
          <input
            :value="newShift.requiredPeople"
            type="text"
            inputmode="numeric"
            pattern="[1-9][0-9]*"
            class="input mt-1"
            :disabled="disabled || saving"
            @input="newShift.requiredPeople = sanitizeIntegerInput(($event.target as HTMLInputElement).value)"
            @blur="newShift.requiredPeople = String(parseRequiredPeople(newShift.requiredPeople))"
          >
        </div>
        <div class="sm:col-span-1">
          <label class="text-xs font-medium text-base-500">{{ t('event.planning.splitIntoShifts') }}</label>
          <input
            :value="newShift.consecutiveCount"
            type="text"
            inputmode="numeric"
            pattern="[1-9][0-9]*"
            class="input mt-1"
            :disabled="disabled || saving"
            @input="newShift.consecutiveCount = sanitizeIntegerInput(($event.target as HTMLInputElement).value)"
            @blur="newShift.consecutiveCount = String(parseRequiredPeople(newShift.consecutiveCount))"
          >
        </div>
        <button
          type="button"
          class="btn-primary inline-flex items-center justify-center gap-2 h-9.5 sm:col-span-2 lg:col-span-1 lg:w-full xl:w-auto"
          :disabled="disabled || saving || !newShift.name.trim()"
          @click="addConsecutiveShiftsFromInput"
        >
          <Icon name="material-symbols:add-rounded" />
          {{ t('event.planning.addShift') }}
        </button>
        <div v-if="!newShiftMatchesExistingType" class="sm:col-span-4 lg:col-span-3 xl:col-span-full">
          <label class="text-xs font-medium text-base-500">{{ t('event.planning.shiftDescription') }}</label>
          <textarea
            v-model="newShift.description"
            class="input mt-1 min-h-16"
            :placeholder="t('event.planning.shiftTypeDescriptionPlaceholder')"
            :disabled="disabled || saving"
          />
        </div>
      </div>

      <div class="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          class="btn-secondary inline-flex items-center gap-2"
          :disabled="disabled || saving || shiftTemplates.length === 0"
          @click="templateBrowserOpen = true"
        >
          <Icon name="material-symbols:folder-open-rounded" />
          {{ t('event.planning.openShiftTemplates') }}
          <span class="rounded bg-white px-1.5 py-0.5 text-xs text-base-600">{{ shiftTemplates.length }}</span>
        </button>
        <button
          v-if="canSaveTemplates"
          type="button"
          class="inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium disabled:opacity-60 not-disabled:cursor-pointer disabled:cursor-not-allowed"
          :class="newShiftIsSavedAsTemplate ? 'border-success-200 bg-success-50 text-success-700' : 'border-base-200 bg-white text-base-700 hover:bg-base-50'"
          :disabled="disabled || saving || !newShift.name.trim() || newShiftIsSavedAsTemplate"
          @click="saveNewShiftAsTemplate"
        >
          <Icon name="material-symbols:bookmark-add-rounded" />
          {{ newShiftIsSavedAsTemplate ? t('event.planning.savedAsTemplate') : t('event.planning.saveAsTemplate') }}
        </button>
      </div>
    </div>

    <div class="mt-4 space-y-4">
      <div
        v-for="section in timetableSections"
        :key="section.key"
        class="overflow-hidden rounded-lg border border-base-200"
        :class="section.borderClass"
      >
        <div class="flex items-center justify-between gap-3 px-3 py-2" :class="section.headerClass">
          <div>
            <p class="text-sm font-semibold text-base-900">{{ section.label }}</p>
            <p class="text-xs text-base-500">{{ section.description }}</p>
          </div>
        </div>

        <div class="event-shift-scroll overflow-x-auto overscroll-x-none">
          <div class="min-w-full" :style="section.timetableStyle">
            <div class="grid border-y border-base-200 bg-base-100 text-xs font-semibold uppercase text-base-500" :style="section.timetableStyle">
              <span class="sticky left-0 z-20 bg-base-100 px-2 py-2 shadow-[2px_0_0_rgba(226,232,240,0.9)] sm:px-3">{{ t('event.planning.timeBlock') }}</span>
              <div
                v-for="column in section.columns"
                :key="column.key"
                class="min-w-0 border-l border-base-200 px-2 py-1.5"
              >
                <div class="flex items-start gap-1">
                  <button
                    type="button"
                    class="flex min-w-0 flex-1 gap-2 rounded px-1 py-0.5 text-left hover:bg-white cursor-pointer"
                    :class="column.collapsed ? 'min-h-12 flex-col items-stretch justify-between' : 'items-center justify-between'"
                    :title="column.collapsed ? t('event.planning.expandShiftColumn') : t('event.planning.collapseShiftColumn')"
                    @click="toggleColumn(section.key, column.key)"
                  >
                    <span class="min-w-0 w-full">
                      <span class="flex min-w-0 items-center gap-1">
                        <span class="block min-w-0 truncate" :class="column.collapsed ? 'text-[0.7rem] leading-tight' : ''">{{ column.label }}</span>
                        <Icon :name="column.collapsed ? 'material-symbols:unfold-more-rounded' : 'material-symbols:unfold-less-rounded'" class="shrink-0 text-base" />
                      </span>
                      <span class="block truncate text-[0.65rem] normal-case" :class="column.hasUnderstaffed ? 'text-warning-700' : 'text-success-700'">
                        {{ t('event.planning.staffedCount', { current: column.assignedPeople, required: column.requiredPeople }) }}
                      </span>
                    </span>
                  </button>
                  <button
                    v-if="!column.collapsed && canEditShiftDetails"
                    type="button"
                    class="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md border disabled:opacity-60 cursor-pointer"
                    :class="isColumnDescriptionExpanded(column.key) ? 'border-success-200 bg-success-50 text-success-700 hover:bg-success-100' : (typeDescriptionValue(column.key) ? 'border-info-200 bg-info-50 text-info-700 hover:bg-info-100' : 'border-base-200 bg-white text-base-500 hover:bg-base-100')"
                    :disabled="disabled || saving"
                    :title="isColumnDescriptionExpanded(column.key) ? t('actions.save') : t('event.planning.editShiftDescription')"
                    @click="isColumnDescriptionExpanded(column.key) ? commitAndCloseColumnDescription(column.key) : toggleColumnDescription(column.key)"
                  >
                    <Icon :name="isColumnDescriptionExpanded(column.key) ? 'material-symbols:save-rounded' : 'material-symbols:sticky-note-2-outline-rounded'" class="text-sm" />
                  </button>
                </div>
                <textarea
                  v-if="!column.collapsed && canEditShiftDetails && isColumnDescriptionExpanded(column.key)"
                  :value="columnDescriptionInputValue(column.key)"
                  class="input mt-1 min-h-10 w-full py-1 text-[0.65rem] font-normal normal-case"
                  :placeholder="t('event.planning.shiftTypeDescriptionPlaceholder')"
                  :disabled="disabled || saving"
                  @focus="startColumnDescriptionEdit(column.key)"
                  @input="setColumnDescriptionDraft(column.key, ($event.target as HTMLTextAreaElement).value)"
                />
                <button
                  v-else-if="!column.collapsed && columnDescriptionOverflows(typeDescriptionValue(column.key))"
                  type="button"
                  class="mt-1 flex w-full items-start gap-1 text-left text-[0.65rem] font-normal normal-case text-base-500 cursor-pointer"
                  @click="toggleColumnTextExpanded(column.key)"
                >
                  <span :class="isColumnTextExpanded(column.key) ? '' : 'line-clamp-2'">{{ typeDescriptionValue(column.key) }}</span>
                  <Icon
                    :name="isColumnTextExpanded(column.key) ? 'material-symbols:expand-less-rounded' : 'material-symbols:expand-more-rounded'"
                    class="mt-0.5 shrink-0 text-sm text-base-400"
                  />
                </button>
                <p
                  v-else-if="!column.collapsed && typeDescriptionValue(column.key)"
                  class="mt-1 text-[0.65rem] font-normal normal-case text-base-500"
                >
                  {{ typeDescriptionValue(column.key) }}
                </p>
              </div>
              <span v-if="showManageRail" class="sticky right-0 z-20 bg-base-100 px-3 py-2 text-right shadow-[-2px_0_0_rgba(226,232,240,0.9)]" aria-hidden="true" />
            </div>

            <div class="divide-y divide-base-200">
              <div
                v-for="group in section.groups"
                :key="group.key"
                class="grid"
                :class="section.rowClass"
                :style="section.timetableStyle"
              >
                <div class="sticky left-0 z-10 px-2 py-1.5 shadow-[2px_0_0_rgba(226,232,240,0.8)] sm:px-3" :class="section.rowClass">
                  <p class="text-sm font-semibold text-base-900">{{ group.label }}</p>
                  <p class="text-[0.7rem] text-base-500">{{ t('event.planning.parallelShiftCount', { count: group.shifts.length }) }}</p>
                </div>

                <div v-for="column in section.columns" :key="column.key" class="min-w-0 space-y-1 border-l border-base-200 p-1.5">
                  <div
                    v-for="shift in shiftsForColumn(group, column.key)"
                    :key="shift.id"
                    class="rounded-md border border-base-200 bg-base-50 p-1.5"
                    :class="[shiftStateClass(shift), shiftHighlightClass(shift)]"
                  >
                    <div v-if="column.collapsed" class="flex items-center justify-between gap-1">
                      <span class="text-[0.7rem] font-bold" :class="staffingClass(shift)">
                        {{ shift.memberIds.length }}/{{ shift.requiredPeople }}
                      </span>
                      <Icon
                        :name="isShiftFullyStaffed(shift) ? 'material-symbols:check-circle-rounded' : 'material-symbols:error-rounded'"
                        class="text-base"
                        :class="staffingIconClass(shift)"
                      />
                    </div>
                    <div v-else class="space-y-1">
                      <div class="grid grid-cols-[minmax(0,1fr)_auto_auto] items-start gap-2">
                        <div class="flex min-w-0 items-center gap-1">
                          <Icon
                            v-if="permissionMode === 'own' && isOwnShift(shift)"
                            name="material-symbols:person-pin-circle-rounded"
                            class="shrink-0 text-base text-info-600"
                            :title="t('event.planning.yourShift')"
                          />
                          <input
                            v-if="canManageShift(shift)"
                            :value="shiftNameInputValue(shift)"
                            class="input h-7 min-w-0 flex-1 py-0.5 text-sm font-medium"
                            @focus="startShiftNameEdit(shift)"
                            @input="setShiftNameDraft(shift.id, ($event.target as HTMLInputElement).value)"
                            @blur="commitShiftName(shift)"
                          >
                          <p v-else class="min-w-0 flex-1 truncate text-sm font-semibold text-base-800">{{ shift.name }}</p>
                        </div>

                        <div class="flex items-center gap-0.5 text-sm font-bold" :class="staffingClass(shift)">
                          <span>{{ shift.memberIds.length }}</span>
                          <span class="text-base-400">/</span>
                          <input
                            v-if="canEditShiftDetails"
                            :value="requiredPeopleInputValue(shift)"
                            type="text"
                            inputmode="numeric"
                            pattern="[1-9][0-9]*"
                            class="input h-7 w-7 px-1 py-0 text-center text-sm font-bold leading-none"
                            @focus="startRequiredPeopleEdit(shift)"
                            @input="setRequiredPeopleDraft(shift.id, ($event.target as HTMLInputElement).value)"
                            @blur="commitRequiredPeople(shift)"
                          >
                          <span v-else>{{ shift.requiredPeople }}</span>
                        </div>

                        <div class="flex items-start justify-end gap-1">
                          <button
                            v-if="permissionMode === 'own' && canSelfSignup"
                            type="button"
                            class="inline-flex h-7 w-7 items-center justify-center rounded-md border border-info-200 bg-info-100 text-info-700 hover:bg-info-200 disabled:opacity-60 cursor-pointer"
                            :disabled="disabled || saving || !currentMemberOption"
                            :title="t('event.planning.assignMe')"
                            @click="assignCurrentMember(shift)"
                          >
                            <Icon name="material-symbols:person-add-rounded" />
                          </button>
                          <button
                            v-if="canManageShift(shift) && isDescriptionExpanded(shift.id)"
                            type="button"
                            class="inline-flex h-7 w-7 items-center justify-center rounded-md border border-success-200 bg-success-50 text-success-700 hover:bg-success-100 disabled:opacity-60 cursor-pointer"
                            :disabled="disabled || saving"
                            :title="t('actions.save')"
                            @click="commitAndCloseShiftDescription(shift)"
                          >
                            <Icon name="material-symbols:save-rounded" />
                          </button>
                          <button
                            type="button"
                            class="inline-flex h-7 w-7 items-center justify-center rounded-md border border-base-200 bg-white text-base-600 hover:bg-base-100 cursor-pointer sm:hidden"
                            :title="isShiftDetailsExpanded(shift.id) ? t('event.planning.hideShiftDetails') : t('event.planning.showShiftDetails')"
                            @click="toggleShiftDetails(shift.id)"
                          >
                            <Icon :name="isShiftDetailsExpanded(shift.id) ? 'material-symbols:expand-less-rounded' : 'material-symbols:expand-more-rounded'" />
                          </button>
                          <MenuDropdown
                            v-if="canManageShift(shift)"
                            v-model="openShiftMenuId"
                            :id="shift.id"
                            :disabled="disabled || saving"
                            wrapper-class="relative shrink-0"
                          >
                            <template #trigger>
                              <button
                                type="button"
                                class="inline-flex h-7 w-7 items-center justify-center rounded-md border disabled:opacity-60 cursor-pointer"
                                :class="openShiftMenuId === shift.id ? 'border-base-300 bg-base-100 text-base-700' : 'border-base-200 bg-white text-base-500 hover:bg-base-100'"
                                :disabled="disabled || saving"
                                :title="t('actions.more')"
                              >
                                <Icon name="material-symbols:more-vert" />
                              </button>
                            </template>

                            <template #default="{ styling }">
                              <button
                                type="button"
                                :class="styling"
                                :disabled="disabled || saving"
                                @click="openShiftDescriptionEditor(shift.id)"
                              >
                                <Icon name="material-symbols:sticky-note-2-outline-rounded" class="shrink-0 text-base text-base-400" />
                                {{ t('event.planning.editShiftDescription') }}
                              </button>
                              <button
                                v-if="canSaveTemplates"
                                type="button"
                                :class="[styling, isShiftSavedAsTemplate(shift) ? 'text-success-600' : '']"
                                :disabled="disabled || saving || isShiftSavedAsTemplate(shift)"
                                @click="saveShiftAsTemplate(shift); openShiftMenuId = null"
                              >
                                <Icon
                                  name="material-symbols:bookmark-add-rounded"
                                  class="shrink-0 text-base"
                                  :class="isShiftSavedAsTemplate(shift) ? 'text-success-500' : 'text-base-400'"
                                />
                                {{ isShiftSavedAsTemplate(shift) ? t('event.planning.savedAsTemplate') : t('event.planning.saveAsTemplate') }}
                              </button>
                              <div class="my-1 border-t border-base-100" />
                              <button
                                type="button"
                                :class="styling"
                                class="text-danger-600 hover:bg-danger-50!"
                                :disabled="disabled || saving"
                                @click="removeShift(shift.id); openShiftMenuId = null"
                              >
                                <Icon name="material-symbols:delete-rounded" class="shrink-0 text-base" />
                                {{ t('actions.remove') }}
                              </button>
                            </template>
                          </MenuDropdown>
                        </div>
                      </div>

                      <textarea
                        v-if="canManageShift(shift) && isDescriptionExpanded(shift.id)"
                        :value="shiftDescriptionInputValue(shift)"
                        class="input min-h-14 w-full py-1 text-xs"
                        :placeholder="t('event.planning.shiftDescriptionPlaceholder')"
                        @focus="startShiftDescriptionEdit(shift)"
                        @input="setShiftDescriptionDraft(shift.id, ($event.target as HTMLTextAreaElement).value)"
                      />
                      <template v-else-if="shiftOwnDescription(shift)">
                        <p class="hidden whitespace-pre-line text-xs text-base-600 sm:block">{{ shiftOwnDescription(shift) }}</p>
                        <p v-if="isShiftDetailsExpanded(shift.id)" class="whitespace-pre-line text-xs text-base-600 sm:hidden">{{ shiftOwnDescription(shift) }}</p>
                      </template>

                      <div class="space-y-1">
                        <div class="hidden min-h-6 flex-wrap gap-1 sm:flex">
                          <span v-if="shift.memberIds.length === 0" class="rounded border border-dashed border-base-300 bg-white px-1.5 py-0.5 text-[0.7rem] font-medium text-base-500">
                            {{ t('event.planning.unassigned') }}
                          </span>
                          <span
                            v-for="memberId in shift.memberIds"
                            :key="memberId"
                            class="inline-flex items-center gap-1 rounded border border-base-300 bg-white px-1.5 py-0.5 text-[0.7rem] font-medium text-base-700"
                          >
                            {{ memberLabel(memberId) }}
                            <button
                              v-if="canRemoveShiftMember(memberId)"
                              type="button"
                              class="inline-flex h-4 w-4 items-center justify-center rounded text-base-500 hover:bg-danger-50 hover:text-danger-600 cursor-pointer"
                              :disabled="disabled || saving"
                              @click="removeShiftMember(shift.id, memberId)"
                            >
                              <Icon name="material-symbols:close-rounded" class="text-sm" />
                            </button>
                          </span>
                        </div>

                        <div v-if="isShiftDetailsExpanded(shift.id)" class="flex min-h-6 flex-wrap gap-1 sm:hidden">
                          <span v-if="shift.memberIds.length === 0" class="rounded border border-dashed border-base-300 bg-white px-1.5 py-0.5 text-[0.7rem] font-medium text-base-500">
                            {{ t('event.planning.unassigned') }}
                          </span>
                          <span
                            v-for="memberId in shift.memberIds"
                            :key="memberId"
                            class="inline-flex items-center gap-1 rounded border border-base-300 bg-white px-1.5 py-0.5 text-[0.7rem] font-medium text-base-700"
                          >
                            {{ memberLabel(memberId) }}
                            <button
                              v-if="canRemoveShiftMember(memberId)"
                              type="button"
                              class="inline-flex h-4 w-4 items-center justify-center rounded text-base-500 hover:bg-danger-50 hover:text-danger-600 cursor-pointer"
                              :disabled="disabled || saving"
                              @click="removeShiftMember(shift.id, memberId)"
                            >
                              <Icon name="material-symbols:close-rounded" class="text-sm" />
                            </button>
                          </span>
                        </div>

                        <CommonSearchSelect
                          v-if="permissionMode === 'manage' && !disabled && !saving"
                          class="event-shift-member-select"
                          :model-value="shift.memberQuery"
                          :options="shiftMemberOptions(shift.memberIds)"
                          :placeholder="t('event.planning.addMemberToShift')"
                          :empty-text="t('event.noMatchingMembers')"
                          menu-width="wide"
                          @update:model-value="updateShift(shift.id, { memberQuery: $event })"
                          @select="addShiftMember(shift.id, $event)"
                          @clear-selection="updateShift(shift.id, { memberQuery: '' })"
                        />
                      </div>
                    </div>
                  </div>
                </div>

                <div v-if="showManageRail" class="sticky right-0 z-10 flex justify-end px-3 py-1.5 shadow-[-2px_0_0_rgba(226,232,240,0.8)]" :class="section.rowClass">
                  <button
                    type="button"
                    class="inline-flex h-8 w-8 items-center justify-center rounded-md bg-base-100 text-base-600 hover:bg-base-200 disabled:opacity-60 cursor-pointer"
                    :disabled="disabled || saving"
                    :title="t('event.planning.addParallelShift')"
                    @click="addParallelShift(group)"
                  >
                    <Icon name="material-symbols:add-rounded" />
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div
        v-if="timetableSections.length === 0"
        class="rounded-lg border border-dashed border-base-300 bg-base-50 p-4 text-sm text-base-500"
      >
        {{ t('event.planning.noMatchingShifts') }}
      </div>
    </div>

    <CommonModal v-model="templateBrowserOpen" :title="t('event.planning.shiftTemplates')" width-class="max-w-lg">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <p class="text-sm text-base-500">{{ t('event.planning.shiftTemplateBrowserHint') }}</p>
        <PageAuditTableHistoryButton :tables="['event_shift_templates']" :return-meta="{ tab: 'shifts' }" />
      </div>
      <div class="space-y-2">
        <article
          v-for="template in shiftTemplates"
          :key="template.id"
          class="rounded-lg border border-base-200 bg-base-50 p-3"
        >
          <div class="flex items-start gap-2">
            <button
              type="button"
              class="min-w-0 flex-1 text-left cursor-pointer"
              :disabled="disabled || saving"
              @click="applyTemplate(template)"
            >
              <span class="flex items-start justify-between gap-3">
                <span class="min-w-0">
                  <span class="block truncate text-sm font-semibold text-base-900">{{ template.name }}</span>
                  <span class="mt-0.5 block line-clamp-2 text-xs text-base-500">{{ template.description || t('event.planning.noShiftDescription') }}</span>
                </span>
                <span class="inline-flex shrink-0 items-center gap-1 rounded-md bg-white px-2 py-1 text-xs font-semibold text-base-600">
                  <Icon name="material-symbols:group-rounded" />
                  {{ template.requiredPeople }}
                </span>
              </span>
            </button>
            <button
              v-if="canSaveTemplates"
              type="button"
              class="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-danger-200 bg-danger-50 text-danger-700 hover:bg-danger-100 disabled:opacity-60 cursor-pointer"
              :disabled="disabled || saving"
              :title="t('actions.remove')"
              @click="removeTemplate(template.id)"
            >
              <Icon name="material-symbols:delete-rounded" class="text-base" />
            </button>
          </div>
        </article>

        <p v-if="shiftTemplates.length === 0" class="rounded-lg border border-dashed border-base-300 p-3 text-sm text-base-500">
          {{ t('event.planning.noShiftTemplates') }}
        </p>
      </div>
    </CommonModal>

    <CommonModal v-model="pdfExportOpen" :title="t('event.planning.exportShiftPlanPdf')">
      <p class="text-sm text-base-500">{{ t('event.planning.exportShiftPlanPdfHint') }}</p>
      <p v-if="permissionMode === 'own'" class="flex items-center gap-1.5 text-sm text-info-700">
        <Icon name="material-symbols:person-pin-circle-rounded" class="text-base" />
        {{ t('event.planning.exportHighlightsOwnShifts') }}
      </p>
      <label class="flex cursor-pointer items-center gap-2 text-sm text-base-700">
        <input v-model="pdfIncludeDescriptions" type="checkbox" class="checkbox">
        {{ t('event.planning.exportWithDescriptions') }}
      </label>
      <template #footer>
        <button type="button" class="btn-secondary" :disabled="pdfDownloading" @click="pdfExportOpen = false">
          {{ t('actions.cancel') }}
        </button>
        <button
          type="button"
          class="btn-primary inline-flex items-center gap-2"
          :disabled="pdfDownloading || !eventId"
          @click="exportShiftPlanPdf"
        >
          <Icon name="material-symbols:download-rounded" />
          {{ t('event.planning.downloadShiftPlanPdf') }}
        </button>
      </template>
    </CommonModal>
  </section>
</template>

<script setup lang="ts">
import type { SearchSelectOption } from '~/components/Common/SearchSelect.vue'
import { useI18n } from '~/composables/useI18n'
import { useToast } from '~/composables/useToast'
import { downloadShiftPlanPdf } from '~/utils/shiftPlanPdfDownload'
import type { EventShiftTypeDescriptions, EventMemberOption } from '~/types/event'
import type { EventShiftPermissionMode, PlanningShiftSlot, PlanningShiftTemplate } from './types'
import { normalizeLocalDateTime, wallClockFrame } from '~/shared/time'
const { today: appToday } = useAppTimeZone()

type TimetableSectionKey = 'before' | 'during' | 'after'
type ShiftColumn = {
  key: string
  label: string
  firstStartsAt: string
  assignedPeople: number
  requiredPeople: number
  hasUnderstaffed: boolean
  collapsed: boolean
}

const props = defineProps<{
  members: EventMemberOption[]
  currentMemberId: number | null
  eventId?: number | null
  eventStartAt?: string
  eventEndAt?: string
  disabled?: boolean
  loading?: boolean
  saving?: boolean
  canManage?: boolean
  canSelfSignup?: boolean
  canSaveTemplates?: boolean
}>()

const emit = defineEmits<{
  (e: 'save', value: PlanningShiftSlot[]): void
  (e: 'save-templates', value: PlanningShiftTemplate[]): void
  (e: 'save-type-descriptions', value: EventShiftTypeDescriptions): void
  (e: 'assign-self', shiftId: number): void
  (e: 'remove-self', shiftId: number): void
}>()

const slots = defineModel<PlanningShiftSlot[]>('slots', { required: true })
const shiftTemplates = defineModel<PlanningShiftTemplate[]>('templates', { required: true })
const shiftTypeDescriptions = defineModel<EventShiftTypeDescriptions>('typeDescriptions', { required: true })
const permissionMode = defineModel<EventShiftPermissionMode>('permissionMode', { required: true })
const { t } = useI18n()
const toast = useToast()

const newShift = reactive({
  name: t('event.planning.newShift'),
  description: '',
  startsAt: '',
  endsAt: '',
  requiredPeople: '1',
  consecutiveCount: '1',
})
const showUnderstaffedOnly = ref(false)
const showMyShiftsOnly = ref(false)
const isNarrowViewport = ref(false)
const columnCollapsedOverrides = ref<Record<string, boolean>>({})
const expandedShiftDetailsIds = ref(new Set<number>())
const expandedDescriptionShiftIds = ref(new Set<number>())
const expandedColumnDescriptionKeys = ref(new Set<string>())
const expandedColumnTextKeys = ref(new Set<string>())
const shiftNameDrafts = ref<Record<number, string>>({})
const shiftDescriptionDrafts = ref<Record<number, string>>({})
const requiredPeopleDrafts = ref<Record<number, string>>({})
const columnDescriptionDrafts = ref<Record<string, string>>({})
const nextTemporaryShiftId = ref(-1)
const nextTemplateId = ref(-1)
const templateBrowserOpen = ref(false)
const openShiftMenuId = ref<number | null>(null)
const pdfExportOpen = ref(false)
const pdfIncludeDescriptions = ref(true)
const pdfDownloading = ref(false)

const loading = computed(() => Boolean(props.loading))
const saving = computed(() => Boolean(props.saving))
const canManage = computed(() => Boolean(props.canManage))
const canSelfSignup = computed(() => Boolean(props.canSelfSignup))
const canSaveTemplates = computed(() => Boolean(props.canSaveTemplates))
const eventId = computed(() => props.eventId ?? null)
const showManageRail = computed(() => canManage.value && permissionMode.value === 'manage')
const newShiftNameKey = computed(() => normalizeShiftColumnKey(newShift.name))
const newShiftMatchesExistingType = computed(() => {
  const key = newShiftNameKey.value
  if (!key) return false
  return slots.value.some(shift => normalizeShiftColumnKey(shift.name) === key)
})
const newShiftIsSavedAsTemplate = computed(() => isTemplateContentSaved({
  name: newShift.name,
  description: newShiftMatchesExistingType.value ? typeDescriptionValue(newShiftNameKey.value) : newShift.description,
  requiredPeople: parseRequiredPeople(newShift.requiredPeople),
}))
const shiftModeHint = computed(() => permissionMode.value === 'own'
  ? t('event.planning.shiftSelfSignupHint')
  : t('event.planning.shiftManageHint'))

let narrowViewportQuery: MediaQueryList | null = null
function updateNarrowViewport() {
  isNarrowViewport.value = narrowViewportQuery?.matches ?? false
}

onMounted(() => {
  if (typeof window === 'undefined') return
  narrowViewportQuery = window.matchMedia('(max-width: 639px)')
  updateNarrowViewport()
  narrowViewportQuery.addEventListener('change', updateNarrowViewport)
})

onBeforeUnmount(() => {
  narrowViewportQuery?.removeEventListener('change', updateNarrowViewport)
})

const currentMemberOption = computed(() => props.currentMemberId
  ? props.members.find(member => member.id === props.currentMemberId) ?? null
  : null)
const normalizedEndsAt = computed(() => {
  const normalizedEnd = normalizeDateTimeInput(newShift.endsAt)
  const normalizedStart = normalizeDateTimeInput(newShift.startsAt) ?? newShift.startsAt
  if (normalizedEnd && normalizedEnd > normalizedStart) return normalizedEnd
  return addMinutes(newShift.startsAt, 60) ?? newShift.startsAt
})
const eventStartAt = computed(() => normalizeDateTimeInput(props.eventStartAt))
const eventEndAt = computed(() => normalizeDateTimeInput(props.eventEndAt))
const visibleDayCount = computed(() => new Set(visibleSlots.value.map(shift => dayKeyForShift(shift))).size)

watch(
  () => [props.eventStartAt, props.eventEndAt] as const,
  () => {
    if (!newShift.startsAt) newShift.startsAt = normalizeDateTimeInput(props.eventStartAt) ?? defaultDateTimeInput('18:00')
    if (!newShift.endsAt) newShift.endsAt = normalizeDateTimeInput(props.eventEndAt) ?? addMinutes(newShift.startsAt, 60) ?? defaultDateTimeInput('19:00')
  },
  { immediate: true },
)

const sortedSlots = computed(() => [...slots.value].sort((left, right) => {
  return left.startsAt.localeCompare(right.startsAt)
    || left.endsAt.localeCompare(right.endsAt)
    || left.name.localeCompare(right.name, undefined, { sensitivity: 'base' })
}))
const visibleSlots = computed(() => sortedSlots.value.filter((shift) => {
  if (showUnderstaffedOnly.value && isShiftFullyStaffed(shift)) return false
  if (showMyShiftsOnly.value && (!props.currentMemberId || !shift.memberIds.includes(props.currentMemberId))) return false
  return true
}))
const canEditShiftDetails = computed(() => !props.disabled && !saving.value && canManage.value && permissionMode.value === 'manage')
const timetableSections = computed(() => {
  const baseSectionDefinitions: Array<{
    key: TimetableSectionKey
    label: string
    description: string
    rowClass: string
    headerClass: string
    borderClass: string
  }> = [
    {
      key: 'before',
      label: t('event.planning.timetableSections.before'),
      description: t('event.planning.timetableSections.beforeHint'),
      rowClass: 'bg-accent-50/70',
      headerClass: 'bg-accent-50',
      borderClass: 'border-accent-200',
    },
    {
      key: 'during',
      label: t('event.planning.timetableSections.during'),
      description: t('event.planning.timetableSections.duringHint'),
      rowClass: 'bg-white',
      headerClass: 'bg-base-50',
      borderClass: 'border-base-200',
    },
    {
      key: 'after',
      label: t('event.planning.timetableSections.after'),
      description: t('event.planning.timetableSections.afterHint'),
      rowClass: 'bg-accent-50/70',
      headerClass: 'bg-accent-50',
      borderClass: 'border-accent-200',
    },
  ]
  const dayKeys = Array.from(new Set(visibleSlots.value.map(shift => dayKeyForShift(shift)))).sort()
  const sectionDefinitions = dayKeys.flatMap(dayKey => baseSectionDefinitions.map(section => ({
    ...section,
    key: `${dayKey}:${section.key}`,
    sectionKey: section.key,
    dayKey,
    label: visibleDayCount.value > 1 ? `${formatDayLabel(dayKey)} · ${section.label}` : section.label,
  })))

  return sectionDefinitions
    .map((section) => {
      const sectionShifts = visibleSlots.value.filter(shift => dayKeyForShift(shift) === section.dayKey && sectionKeyForShift(shift) === section.sectionKey)
      const columns = buildShiftColumns(section.key, sectionShifts)
      const groups = buildTimeGroups(sectionShifts)
      const columnWidth = columns.map(column => column.collapsed ? '6rem' : 'minmax(15rem, 1fr)').join(' ') || 'minmax(15rem, 1fr)'
      const railWidth = showManageRail.value ? ' 3rem' : ''

      return {
        ...section,
        shifts: sectionShifts,
        columns,
        groups,
        timetableStyle: {
          gridTemplateColumns: `var(--shift-time-col, 8rem) ${columnWidth}${railWidth}`,
          minWidth: `calc(var(--shift-time-col, 8rem)${showManageRail.value ? ' + 3rem' : ''} + ${columns.reduce((total, column) => total + (column.collapsed ? 6 : 15), 0)}rem)`,
        },
      }
    })
    .filter(section => section.shifts.length > 0)
})

function buildShiftColumns(sectionKey: string, shifts: PlanningShiftSlot[]): ShiftColumn[] {
  const columns = new Map<string, ShiftColumn>()

  for (const shift of shifts) {
    const key = normalizeShiftColumnKey(shift.name)
    const existingColumn = columns.get(key)

    if (existingColumn) {
      existingColumn.assignedPeople += shift.memberIds.length
      existingColumn.requiredPeople += shift.requiredPeople
      existingColumn.hasUnderstaffed = existingColumn.hasUnderstaffed || !isShiftFullyStaffed(shift)
      continue
    }

    columns.set(key, {
      key,
      label: shift.name.trim() || t('event.planning.newShift'),
      firstStartsAt: shift.startsAt,
      assignedPeople: shift.memberIds.length,
      requiredPeople: shift.requiredPeople,
      hasUnderstaffed: !isShiftFullyStaffed(shift),
      collapsed: isColumnCollapsed(sectionKey, key),
    })
  }

  return Array.from(columns.values()).sort((left, right) => {
    return left.firstStartsAt.localeCompare(right.firstStartsAt)
      || left.label.localeCompare(right.label, undefined, { sensitivity: 'base' })
  })
}

function buildTimeGroups(shifts: PlanningShiftSlot[]) {
  const groups = new Map<string, PlanningShiftSlot[]>()

  for (const shift of shifts) {
    const key = `${shift.startsAt}-${shift.endsAt}`
    const group = groups.get(key) ?? []
    group.push(shift)
    groups.set(key, group)
  }

  return Array.from(groups.entries()).map(([key, shifts]) => ({
    key,
    startsAt: shifts[0]?.startsAt ?? '',
    endsAt: shifts[0]?.endsAt ?? '',
    label: formatShiftRangeLabel(shifts[0]?.startsAt ?? '', shifts[0]?.endsAt ?? ''),
    shifts,
  }))
}

function normalizeShiftColumnKey(value: string) {
  return (value.trim() || t('event.planning.newShift')).toLocaleLowerCase()
}

function sectionKeyForShift(shift: PlanningShiftSlot): TimetableSectionKey {
  if (eventStartAt.value && shift.endsAt <= eventStartAt.value) return 'before'
  if (eventEndAt.value && shift.startsAt >= eventEndAt.value) return 'after'
  return 'during'
}

function shiftsForColumn(group: { shifts: PlanningShiftSlot[] }, columnKey: string) {
  return group.shifts.filter(shift => normalizeShiftColumnKey(shift.name) === columnKey)
}

function columnStateKey(sectionKey: string, columnKey: string) {
  return `${sectionKey}:${columnKey}`
}

function isColumnCollapsed(sectionKey: string, columnKey: string) {
  const stateKey = columnStateKey(sectionKey, columnKey)
  return columnCollapsedOverrides.value[stateKey] ?? isNarrowViewport.value
}

function toggleColumn(sectionKey: string, columnKey: string) {
  const stateKey = columnStateKey(sectionKey, columnKey)
  columnCollapsedOverrides.value = {
    ...columnCollapsedOverrides.value,
    [stateKey]: !isColumnCollapsed(sectionKey, columnKey),
  }
}

function isShiftDetailsExpanded(shiftId: number) {
  return expandedShiftDetailsIds.value.has(shiftId)
}

function toggleShiftDetails(shiftId: number) {
  const nextIds = new Set(expandedShiftDetailsIds.value)

  if (nextIds.has(shiftId)) {
    nextIds.delete(shiftId)
  } else {
    nextIds.add(shiftId)
  }

  expandedShiftDetailsIds.value = nextIds
}

function isDescriptionExpanded(shiftId: number) {
  return expandedDescriptionShiftIds.value.has(shiftId)
}

function toggleDescription(shiftId: number) {
  const nextIds = new Set(expandedDescriptionShiftIds.value)

  if (nextIds.has(shiftId)) {
    nextIds.delete(shiftId)
  } else {
    nextIds.add(shiftId)
  }

  expandedDescriptionShiftIds.value = nextIds
}

function isColumnDescriptionExpanded(columnKey: string) {
  return expandedColumnDescriptionKeys.value.has(columnKey)
}

function toggleColumnDescription(columnKey: string) {
  const nextKeys = new Set(expandedColumnDescriptionKeys.value)

  if (nextKeys.has(columnKey)) {
    nextKeys.delete(columnKey)
  } else {
    nextKeys.add(columnKey)
  }

  expandedColumnDescriptionKeys.value = nextKeys
}

function isColumnTextExpanded(columnKey: string) {
  return expandedColumnTextKeys.value.has(columnKey)
}

function toggleColumnTextExpanded(columnKey: string) {
  const nextKeys = new Set(expandedColumnTextKeys.value)

  if (nextKeys.has(columnKey)) {
    nextKeys.delete(columnKey)
  } else {
    nextKeys.add(columnKey)
  }

  expandedColumnTextKeys.value = nextKeys
}

function memberLabel(memberId: number) {
  return props.members.find(member => member.id === memberId)?.full_name ?? String(memberId)
}

function shiftMemberOptions(selectedIds: number[]): SearchSelectOption<EventMemberOption>[] {
  return props.members
    .filter(member => !selectedIds.includes(member.id))
    .map(member => ({
      key: member.id,
      label: member.full_name,
      value: member,
      searchText: member.full_name,
    }))
}

function persistSlots(nextSlots: PlanningShiftSlot[]) {
  slots.value = nextSlots
  emit('save', nextSlots)
}

function assignCurrentMember(shift: PlanningShiftSlot) {
  if (!currentMemberOption.value) return
  if (permissionMode.value === 'own') {
    emit('assign-self', shift.id)
    return
  }

  addShiftMember(shift.id, currentMemberOption.value)
}

function addShiftMember(shiftId: number, value: unknown) {
  const member = value as EventMemberOption | null
  if (!member?.id) return

  const nextSlots = slots.value.map((shift) => {
    if (shift.id !== shiftId || shift.memberIds.includes(member.id)) return shift
    return { ...shift, memberIds: [...shift.memberIds, member.id], memberQuery: '' }
  })
  persistSlots(nextSlots)
}

function removeShiftMember(shiftId: number, memberId: number) {
  if (permissionMode.value === 'own') {
    if (memberId === props.currentMemberId) emit('remove-self', shiftId)
    return
  }

  const nextSlots = slots.value.map((shift) => {
    if (shift.id !== shiftId) return shift
    return { ...shift, memberIds: shift.memberIds.filter(id => id !== memberId) }
  })
  persistSlots(nextSlots)
}

function canRemoveShiftMember(memberId: number) {
  return permissionMode.value === 'manage' || memberId === props.currentMemberId
}

function persistNewShiftTypeDescription(name: string, wasNewType: boolean) {
  if (!wasNewType) return

  const description = newShift.description.trim()
  if (!description) return

  const key = normalizeShiftColumnKey(name)
  persistTypeDescriptions({ ...shiftTypeDescriptions.value, [key]: description })
}

function addParallelShift(group: { startsAt: string, endsAt: string }) {
  const name = newShift.name.trim() || t('event.planning.newShift')
  const wasNewType = !newShiftMatchesExistingType.value

  persistSlots([
    ...slots.value,
    createRegularShift(name, group.startsAt, group.endsAt, parseRequiredPeople(newShift.requiredPeople)),
  ])
  persistNewShiftTypeDescription(name, wasNewType)
}

function addConsecutiveShiftsFromInput() {
  const count = parseRequiredPeople(newShift.consecutiveCount)
  const startDate = parseDateTimeInput(normalizeDateTimeInput(newShift.startsAt) ?? '')
  const endDate = parseDateTimeInput(normalizedEndsAt.value)
  if (!startDate || !endDate || endDate.getTime() <= startDate.getTime()) return

  const totalMinutes = Math.floor((endDate.getTime() - startDate.getTime()) / 60000)
  const duration = Math.floor(totalMinutes / count)
  if (duration < 1) return

  const name = newShift.name.trim()
  const wasNewType = !newShiftMatchesExistingType.value
  const requiredPeople = parseRequiredPeople(newShift.requiredPeople)
  const nextShifts: PlanningShiftSlot[] = []

  for (let index = 0; index < count; index += 1) {
    const shiftStart = new Date(startDate.getTime() + (duration * index * 60000))
    const shiftEnd = index === count - 1
      ? endDate
      : new Date(startDate.getTime() + (duration * (index + 1) * 60000))
    const startsAt = formatDateTimeInput(shiftStart)
    const endsAt = formatDateTimeInput(shiftEnd)

    nextShifts.push(createRegularShift(name, startsAt, endsAt, requiredPeople))
  }

  if (!nextShifts.length) return

  persistSlots([
    ...slots.value,
    ...nextShifts,
  ])
  persistNewShiftTypeDescription(name, wasNewType)
}

function createRegularShift(name: string, startsAt: string, endsAt: string, requiredPeople: number, description = ''): PlanningShiftSlot {
  return {
    id: nextTemporaryShiftId.value--,
    name,
    description,
    startsAt,
    endsAt,
    requiredPeople: Math.max(Number(requiredPeople) || 1, 1),
    memberIds: [],
    memberQuery: '',
  }
}

function openShiftDescriptionEditor(shiftId: number) {
  if (!isDescriptionExpanded(shiftId)) toggleDescription(shiftId)
  openShiftMenuId.value = null
}

function removeShift(shiftId: number) {
  const nextSlots = slots.value.filter(shift => shift.id !== shiftId)
  const nextIds = new Set(expandedShiftDetailsIds.value)
  const nextDescriptionIds = new Set(expandedDescriptionShiftIds.value)
  const nextNameDrafts = { ...shiftNameDrafts.value }
  const nextDescriptionDrafts = { ...shiftDescriptionDrafts.value }
  const nextRequiredPeopleDrafts = { ...requiredPeopleDrafts.value }

  nextIds.delete(shiftId)
  nextDescriptionIds.delete(shiftId)
  delete nextNameDrafts[shiftId]
  delete nextDescriptionDrafts[shiftId]
  delete nextRequiredPeopleDrafts[shiftId]

  expandedShiftDetailsIds.value = nextIds
  expandedDescriptionShiftIds.value = nextDescriptionIds
  shiftNameDrafts.value = nextNameDrafts
  shiftDescriptionDrafts.value = nextDescriptionDrafts
  requiredPeopleDrafts.value = nextRequiredPeopleDrafts
  persistSlots(nextSlots)
}

function updateShift(shiftId: number, patch: Partial<PlanningShiftSlot>, persist = false) {
  const nextSlots = slots.value.map(shift => shift.id === shiftId ? { ...shift, ...patch } : shift)
  if (persist) {
    persistSlots(nextSlots)
  } else {
    slots.value = nextSlots
  }
}

function shiftNameInputValue(shift: PlanningShiftSlot) {
  return shiftNameDrafts.value[shift.id] ?? shift.name
}

function startShiftNameEdit(shift: PlanningShiftSlot) {
  setShiftNameDraft(shift.id, shift.name)
}

function setShiftNameDraft(shiftId: number, value: string) {
  shiftNameDrafts.value = { ...shiftNameDrafts.value, [shiftId]: value }
}

function commitShiftName(shift: PlanningShiftSlot) {
  const draft = shiftNameDrafts.value[shift.id]
  const nextName = draft?.trim() || t('event.planning.newShift')
  const nextDrafts = { ...shiftNameDrafts.value }

  delete nextDrafts[shift.id]
  shiftNameDrafts.value = nextDrafts
  updateShift(shift.id, { name: nextName }, true)
}

function shiftDescriptionInputValue(shift: PlanningShiftSlot) {
  return shiftDescriptionDrafts.value[shift.id] ?? shift.description
}

function startShiftDescriptionEdit(shift: PlanningShiftSlot) {
  setShiftDescriptionDraft(shift.id, shift.description)
}

function setShiftDescriptionDraft(shiftId: number, value: string) {
  shiftDescriptionDrafts.value = { ...shiftDescriptionDrafts.value, [shiftId]: value }
}

function commitShiftDescription(shift: PlanningShiftSlot) {
  const draft = shiftDescriptionDrafts.value[shift.id]
  const nextDescription = (draft ?? shift.description).trim()
  const nextDrafts = { ...shiftDescriptionDrafts.value }

  delete nextDrafts[shift.id]
  shiftDescriptionDrafts.value = nextDrafts
  if (nextDescription === shift.description) return
  updateShift(shift.id, { description: nextDescription }, true)
}

function commitAndCloseShiftDescription(shift: PlanningShiftSlot) {
  commitShiftDescription(shift)
  toggleDescription(shift.id)
}

function typeDescriptionValue(columnKey: string) {
  return shiftTypeDescriptions.value[columnKey] ?? ''
}

function columnDescriptionOverflows(text: string) {
  return text.trim().length > 80
}

function combinedTemplateDescription(name: string, ownDescription: string) {
  const typeValue = typeDescriptionValue(normalizeShiftColumnKey(name)).trim()
  const rowValue = ownDescription.trim()
  return [typeValue, rowValue].filter(Boolean).join('\n\n')
}

function shiftOwnDescription(shift: PlanningShiftSlot) {
  return shift.description.trim()
}

function columnDescriptionInputValue(columnKey: string) {
  return columnDescriptionDrafts.value[columnKey] ?? typeDescriptionValue(columnKey)
}

function startColumnDescriptionEdit(columnKey: string) {
  columnDescriptionDrafts.value = { ...columnDescriptionDrafts.value, [columnKey]: typeDescriptionValue(columnKey) }
}

function setColumnDescriptionDraft(columnKey: string, value: string) {
  columnDescriptionDrafts.value = { ...columnDescriptionDrafts.value, [columnKey]: value }
}

function commitColumnDescription(columnKey: string) {
  const draft = columnDescriptionDrafts.value[columnKey]
  const nextDrafts = { ...columnDescriptionDrafts.value }
  delete nextDrafts[columnKey]
  columnDescriptionDrafts.value = nextDrafts

  if (draft === undefined) return

  const nextValue = draft.trim()
  if (nextValue === typeDescriptionValue(columnKey)) return

  const nextEntries = { ...shiftTypeDescriptions.value }
  if (nextValue) {
    nextEntries[columnKey] = nextValue
  } else {
    delete nextEntries[columnKey]
  }
  persistTypeDescriptions(nextEntries)
}

function commitAndCloseColumnDescription(columnKey: string) {
  commitColumnDescription(columnKey)
  toggleColumnDescription(columnKey)
}

function persistTypeDescriptions(nextEntries: EventShiftTypeDescriptions) {
  shiftTypeDescriptions.value = nextEntries
  emit('save-type-descriptions', nextEntries)
}

function requiredPeopleInputValue(shift: PlanningShiftSlot) {
  return requiredPeopleDrafts.value[shift.id] ?? String(shift.requiredPeople)
}

function startRequiredPeopleEdit(shift: PlanningShiftSlot) {
  setRequiredPeopleDraft(shift.id, String(shift.requiredPeople))
}

function setRequiredPeopleDraft(shiftId: number, value: string) {
  requiredPeopleDrafts.value = { ...requiredPeopleDrafts.value, [shiftId]: sanitizeIntegerInput(value) }
}

function commitRequiredPeople(shift: PlanningShiftSlot) {
  const nextRequiredPeople = parseRequiredPeople(requiredPeopleDrafts.value[shift.id] ?? String(shift.requiredPeople))
  const nextDrafts = { ...requiredPeopleDrafts.value }

  delete nextDrafts[shift.id]
  requiredPeopleDrafts.value = nextDrafts
  updateShift(shift.id, { requiredPeople: nextRequiredPeople }, true)
}

function canManageShift(_shift: PlanningShiftSlot) {
  return canEditShiftDetails.value
}

// ---- Shift templates ----

watch(
  shiftTemplates,
  (value) => {
    const minimumId = Math.min(-1, ...value.map(template => template.id))
    nextTemplateId.value = Math.min(nextTemplateId.value, minimumId - 1)
  },
  { immediate: true, deep: true },
)

function templateSignature(template: { name: string, description: string, requiredPeople: number }) {
  const name = template.name.trim()
  if (!name) return ''

  return JSON.stringify({
    name,
    description: template.description.trim(),
    requiredPeople: template.requiredPeople,
  })
}

function isTemplateContentSaved(template: { name: string, description: string, requiredPeople: number }) {
  const signature = templateSignature(template)
  return Boolean(signature) && shiftTemplates.value.some(existing => templateSignature(existing) === signature)
}

function isShiftSavedAsTemplate(shift: PlanningShiftSlot) {
  return isTemplateContentSaved({
    name: shift.name,
    description: combinedTemplateDescription(shift.name, shift.description),
    requiredPeople: shift.requiredPeople,
  })
}

function persistTemplates(nextTemplates: PlanningShiftTemplate[]) {
  shiftTemplates.value = nextTemplates
  emit('save-templates', nextTemplates)
}

function saveNewShiftAsTemplate() {
  const name = newShift.name.trim()
  if (!name || newShiftIsSavedAsTemplate.value) return

  const description = newShiftMatchesExistingType.value
    ? typeDescriptionValue(newShiftNameKey.value)
    : newShift.description.trim()

  persistTemplates([
    {
      id: nextTemplateId.value--,
      name,
      description,
      requiredPeople: parseRequiredPeople(newShift.requiredPeople),
    },
    ...shiftTemplates.value,
  ])
}

function saveShiftAsTemplate(shift: PlanningShiftSlot) {
  if (isShiftSavedAsTemplate(shift)) return

  persistTemplates([
    {
      id: nextTemplateId.value--,
      name: shift.name.trim(),
      description: combinedTemplateDescription(shift.name, shift.description),
      requiredPeople: shift.requiredPeople,
    },
    ...shiftTemplates.value,
  ])
}

function removeTemplate(templateId: number) {
  persistTemplates(shiftTemplates.value.filter(template => template.id !== templateId))
}

function applyTemplate(template: PlanningShiftTemplate) {
  newShift.name = template.name
  newShift.description = template.description
  newShift.requiredPeople = String(template.requiredPeople)
  templateBrowserOpen.value = false
}

// ---- PDF export ----

async function exportShiftPlanPdf() {
  if (!eventId.value || pdfDownloading.value) return

  try {
    pdfDownloading.value = true
    const res = await downloadShiftPlanPdf(eventId.value, {
      includeDescriptions: pdfIncludeDescriptions.value,
      highlightOwn: permissionMode.value === 'own',
    })
    if (!res.ok) {
      toast.error(res.error || t('event.planning.failedExportShiftPlanPdf'))
      return
    }
    pdfExportOpen.value = false
  }
  catch {
    toast.error(t('event.planning.failedExportShiftPlanPdf'))
  }
  finally {
    pdfDownloading.value = false
  }
}

function parseRequiredPeople(value: string) {
  const parsed = Number(sanitizeIntegerInput(value))
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 1
}

function sanitizeIntegerInput(value: string) {
  return value.replace(/\D/g, '')
}

function parseDateTimeInput(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value ?? '')) return null
  const normalized = normalizeLocalDateTime(value)
  return normalized ? wallClockFrame(normalized) : null
}

function normalizeDateTimeInput(value?: string) {
  if (!value) return null
  const normalized = normalizeLocalDateTime(value)
  return normalized ? normalized.replace(' ', 'T').slice(0, 16) : null
}

function formatDateTimeInput(frame: Date) {
  return frame.toISOString().slice(0, 16)
}

function defaultDateTimeInput(time: string) {
  const date = eventStartAt.value?.slice(0, 10) ?? appToday()
  return `${date}T${time}`
}

function addMinutes(value: string, minutes: number) {
  const date = parseDateTimeInput(value)
  if (!date) return null
  return formatDateTimeInput(new Date(date.getTime() + (minutes * 60000)))
}

function dayKeyForShift(shift: PlanningShiftSlot) {
  return shift.startsAt.slice(0, 10) || 'unknown'
}

function formatDayLabel(dayKey: string) {
  if (dayKey === 'unknown') return t('event.planning.dateMissing')
  return new Intl.DateTimeFormat(undefined, { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${dayKey}T00:00:00Z`))
}

function formatTimeLabel(value: string) {
  return value.slice(11, 16) || value
}

function formatShiftRangeLabel(startsAt: string, endsAt: string) {
  if (!startsAt || !endsAt) return ''
  if (startsAt.slice(0, 10) === endsAt.slice(0, 10)) {
    return `${formatTimeLabel(startsAt)} - ${formatTimeLabel(endsAt)}`
  }

  return `${formatDayLabel(startsAt.slice(0, 10))} ${formatTimeLabel(startsAt)} - ${formatDayLabel(endsAt.slice(0, 10))} ${formatTimeLabel(endsAt)}`
}

function staffingClass(shift: PlanningShiftSlot) {
  if (isShiftFullyStaffed(shift)) return 'text-success-700'
  if (shift.memberIds.length === 0) return 'text-danger-700'
  return 'text-warning-700'
}

function staffingIconClass(shift: PlanningShiftSlot) {
  if (isShiftFullyStaffed(shift)) return 'text-success-600'
  if (shift.memberIds.length === 0) return 'text-danger-600'
  return 'text-warning-600'
}

function shiftStateClass(shift: PlanningShiftSlot) {
  if (isShiftFullyStaffed(shift)) {
    return 'border-l-4 border-l-success-500'
  }

  if (shift.memberIds.length === 0) {
    return 'border-l-4 border-l-danger-500'
  }

  return 'border-l-4 border-l-warning-500'
}

function isShiftFullyStaffed(shift: PlanningShiftSlot) {
  return shift.memberIds.length >= shift.requiredPeople
}

function isOwnShift(shift: PlanningShiftSlot) {
  return Boolean(props.currentMemberId) && shift.memberIds.includes(props.currentMemberId!)
}

function shiftHighlightClass(shift: PlanningShiftSlot) {
  return permissionMode.value === 'own' && isOwnShift(shift) ? 'bg-info-50' : ''
}
</script>

<style scoped>
.event-shift-scroll {
  --shift-time-col: 6.5rem;
  background:
    linear-gradient(to right, rgb(241 245 249) 0, rgb(241 245 249) var(--shift-time-col), transparent var(--shift-time-col)),
    white;
  scrollbar-width: thin;
  scrollbar-color: rgb(148 163 184) rgb(226 232 240);
}

@media (min-width: 640px) {
  .event-shift-scroll {
    --shift-time-col: 8rem;
  }
}

.event-shift-scroll::-webkit-scrollbar {
  height: 0.75rem;
}

.event-shift-scroll::-webkit-scrollbar-track {
  background: rgb(226 232 240);
}

.event-shift-scroll::-webkit-scrollbar-thumb {
  background: rgb(148 163 184);
  border: 0.2rem solid rgb(226 232 240);
  border-radius: 999px;
}

.event-shift-member-select :deep(input) {
  height: 1.75rem;
  padding-top: 0.125rem;
  padding-bottom: 0.125rem;
  font-size: 0.875rem;
  line-height: 1.25rem;
}
</style>
