import type { PageName } from '~/types/page'
import { usePage } from '~/composables/usePage'
import { buildReturnTarget, useReturnTarget } from '~/composables/useReturnTarget'

export function useLinkedRecord(currentPage: PageName, defaultPage: PageName) {
  const { pageMeta } = usePage()
  const { returnTarget, goToReturnTarget, setPageWithReturnTarget } = useReturnTarget(defaultPage)

  function openLinkedRecord(page: PageName, metaKey: string, id: number) {
    // Coming from this record: go back so its unsaved draft is kept
    if (returnTarget.value.page === page && Number(returnTarget.value.meta?.[metaKey]) === id) {
      goToReturnTarget()
      return
    }

    setPageWithReturnTarget(
      page,
      pageMeta.value?.forceReadonly ? { [metaKey]: id, forceReadonly: true } : { [metaKey]: id },
      buildReturnTarget(currentPage, pageMeta.value),
    )
  }

  return { openLinkedRecord }
}
