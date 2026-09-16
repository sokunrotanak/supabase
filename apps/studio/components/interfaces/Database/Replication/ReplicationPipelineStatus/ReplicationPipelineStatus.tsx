import { useParams } from 'common'
import { Activity, ChevronDown, RotateCcw, Search, X } from 'lucide-react'
import Link from 'next/link'
import { parseAsString, useQueryState } from 'nuqs'
import { useMemo, useState } from 'react'
import {
  Button,
  Card,
  CardContent,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
  Table,
  TableBody,
  TableHead,
  TableHeader,
  TableRow,
} from 'ui'
import { Admonition } from 'ui-patterns/Admonition'
import { Input } from 'ui-patterns/DataInputs/Input'
import { EmptyStatePresentational } from 'ui-patterns/EmptyStatePresentational'
import { PageContainer } from 'ui-patterns/PageContainer'
import {
  PageSection,
  PageSectionContent,
  PageSectionMeta,
  PageSectionSummary,
  PageSectionTitle,
} from 'ui-patterns/PageSection'
import { GenericTableLoader, ShimmeringLoader } from 'ui-patterns/ShimmeringLoader'

import { BatchRestartDialog } from '../BatchRestartDialog'
import { ErrorDetailsDialog } from '../ErrorDetailsDialog'
import { getStatusName } from '../Pipeline.utils'
import { PipelineStatusName, STATUS_REFRESH_FREQUENCY_MS } from '../Replication.constants'
import { RestartTableDialog } from '../RestartTableDialog'
import { getPipelineStateNotice, getTableStatusEmptyState } from './PipelineOverview.utils'
import { getDisabledStateConfig } from './ReplicationPipelineStatus.utils'
import { SlotLagMetricsList } from './SlotLagMetrics'
import { SlotConnectionIndicator, SlotStatusBadge, SlotStatusLegend } from './SlotStatus'
import { TableReplicationRow } from './TableReplicationRow'
import { AlertError } from '@/components/ui/AlertError'
import { DropdownMenuItemTooltip } from '@/components/ui/DropdownMenuItemTooltip'
import { useReplicationPipelineByIdQuery } from '@/data/replication/pipeline-by-id-query'
import { useReplicationPipelineReplicationStatusQuery } from '@/data/replication/pipeline-replication-status-query'
import { useReplicationPipelineStatusQuery } from '@/data/replication/pipeline-status-query'
import {
  PipelineStatusRequestStatus,
  usePipelineRequestStatus,
} from '@/state/replication-pipeline-request-status'

const PipelineOverviewSkeleton = () => (
  <>
    <PageSection>
      <PageSectionMeta>
        <PageSectionSummary>
          <PageSectionTitle>Pipeline health</PageSectionTitle>
        </PageSectionSummary>
      </PageSectionMeta>
      <PageSectionContent>
        <Card>
          <CardContent className="pb-5">
            <div className="grid grid-cols-1 gap-x-10 gap-y-6 md:grid-cols-2" aria-hidden>
              {[0, 1, 2, 3, 4].map((index) => (
                <div key={index} className="space-y-2">
                  <ShimmeringLoader className="h-3 w-24 py-0" delayIndex={index} />
                  <ShimmeringLoader className="h-4 w-32 py-0" delayIndex={index} />
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </PageSectionContent>
    </PageSection>

    <PageSection>
      <PageSectionMeta>
        <PageSectionSummary>
          <PageSectionTitle>Replicated tables</PageSectionTitle>
        </PageSectionSummary>
      </PageSectionMeta>
      <PageSectionContent>
        <GenericTableLoader headers={['Table', 'Status', 'Details', null]} />
      </PageSectionContent>
    </PageSection>
  </>
)

/**
 * Component for displaying replication pipeline status and table replication details.
 * Supports both legacy 'error' state and new 'errored' state with retry policies.
 */
export const ReplicationPipelineStatus = () => {
  const { ref: projectRef, pipelineId: _pipelineId } = useParams()
  const [searchString, setSearchString] = useQueryState('search', parseAsString.withDefault(''))

  const [showErrorDialog, setShowErrorDialog] = useState(false)
  const [selectedTableError, setSelectedTableError] = useState<{
    tableName: string
    reason: string
    solution?: string
  } | null>(null)
  const [showRestartDialog, setShowRestartDialog] = useState(false)
  const [selectedTableForRestart, setSelectedTableForRestart] = useState<{
    id: number
    schema: string
    name: string
  } | null>(null)
  const [showBatchRestartDialog, setShowBatchRestartDialog] = useState(false)
  const [batchRestartMode, setBatchRestartMode] = useState<'all' | 'errored' | null>(null)
  const [restartingTableIds, setRestartingTableIds] = useState<Set<number>>(new Set())

  const pipelineId = Number(_pipelineId)
  const { getRequestStatus, setTableResetting } = usePipelineRequestStatus()
  const requestStatus = getRequestStatus(pipelineId)

  const {
    data: pipeline,
    error: pipelineError,
    isPending: isPipelineLoading,
    isError: isPipelineError,
  } = useReplicationPipelineByIdQuery({
    projectRef,
    pipelineId,
  })

  const { data: pipelineStatusData } = useReplicationPipelineStatusQuery(
    { projectRef, pipelineId },
    {
      enabled: !!pipelineId,
      refetchInterval: STATUS_REFRESH_FREQUENCY_MS,
    }
  )

  const {
    data: replicationStatusData,
    isPending: isStatusLoading,
    isError: isStatusError,
  } = useReplicationPipelineReplicationStatusQuery(
    { projectRef, pipelineId },
    {
      enabled: !!pipelineId,
      refetchInterval: STATUS_REFRESH_FREQUENCY_MS,
    }
  )

  const statusName = getStatusName(pipelineStatusData?.status)
  const config = getDisabledStateConfig({ requestStatus, statusName })

  // Sort tables by schema and name for consistent ordering (memoized)
  const tableStatuses = useMemo(
    () =>
      (replicationStatusData?.table_statuses || []).sort(
        (a, b) => a.schema.localeCompare(b.schema) || a.name.localeCompare(b.name)
      ),
    [replicationStatusData?.table_statuses]
  )

  const applyLagMetrics = replicationStatusData?.apply_lag

  // Filter tables based on search (memoized)
  const filteredTableStatuses = useMemo(
    () =>
      searchString.length === 0
        ? tableStatuses
        : tableStatuses.filter((table) =>
            `${table.schema}.${table.name}`.toLowerCase().includes(searchString.toLowerCase())
          ),
    [tableStatuses, searchString]
  )

  const erroredTables = useMemo(
    () => tableStatuses.filter((table) => table.state.name === 'error'),
    [tableStatuses]
  )

  const hasErroredTables = erroredTables.length > 0
  const isAnyRestartInProgress = restartingTableIds.size > 0

  const hasTableData = tableStatuses.length > 0
  const isPipelineActionable =
    statusName === PipelineStatusName.STARTED ||
    statusName === PipelineStatusName.STOPPED ||
    statusName === PipelineStatusName.FAILED
  const isEnablingDisabling =
    requestStatus === PipelineStatusRequestStatus.StartRequested ||
    requestStatus === PipelineStatusRequestStatus.StopRequested ||
    requestStatus === PipelineStatusRequestStatus.RestartRequested
  const isPipelineBusy = isEnablingDisabling || isAnyRestartInProgress
  const showDisabledState = isPipelineBusy || !isPipelineActionable
  const stateNotice = getPipelineStateNotice({ requestStatus, statusName, tableStatuses })
  const isSlotDisconnected =
    !isStatusError && statusName === PipelineStatusName.STARTED && applyLagMetrics?.active === false
  const logsUrl = `/project/${projectRef}/logs/replication-logs?f=${encodeURIComponent(
    JSON.stringify({ pipeline_id: pipelineId })
  )}`
  const emptyState = getTableStatusEmptyState({
    isDisabled: showDisabledState,
    disabledStateConfig: config,
    statusName,
  })

  return (
    <>
      <PageContainer size="large">
        <p className="sr-only" role="status" aria-live="polite">
          {isPipelineLoading || isStatusLoading ? 'Loading pipeline details' : ''}
        </p>

        {isPipelineError && (
          <PageSection>
            <PageSectionContent>
              <AlertError error={pipelineError} subject="Failed to retrieve pipeline information" />
            </PageSectionContent>
          </PageSection>
        )}

        {(isPipelineLoading || isStatusLoading) && <PipelineOverviewSkeleton />}

        {!isPipelineLoading && !isStatusLoading && (
          <PageSection>
            <PageSectionMeta>
              <PageSectionSummary>
                <PageSectionTitle>Pipeline health</PageSectionTitle>
              </PageSectionSummary>
            </PageSectionMeta>
            <PageSectionContent className="flex flex-col gap-y-4">
              {stateNotice !== undefined && (
                <Admonition
                  type={stateNotice.type}
                  layout="responsive"
                  title={stateNotice.title}
                  description={stateNotice.description}
                  actions={
                    stateNotice.showLogsLink ? (
                      <Button asChild variant="default">
                        <Link href={logsUrl}>View logs</Link>
                      </Button>
                    ) : undefined
                  }
                />
              )}

              {hasErroredTables && !showDisabledState && (
                <Admonition
                  type="destructive"
                  layout="responsive"
                  title={
                    erroredTables.length === 1
                      ? '1 table stopped replicating'
                      : `${erroredTables.length} tables stopped replicating`
                  }
                  description="The rest of the pipeline keeps running. Open a table’s error to see what went wrong, then reset it to resume."
                  actions={
                    <Button
                      variant="default"
                      icon={<RotateCcw />}
                      disabled={isAnyRestartInProgress || isPipelineError}
                      loading={isAnyRestartInProgress}
                      onClick={() => {
                        setBatchRestartMode('errored')
                        setShowBatchRestartDialog(true)
                      }}
                    >
                      Reset failed tables
                    </Button>
                  }
                />
              )}

              {isSlotDisconnected && (
                <Admonition
                  type="warning"
                  title="Pipeline disconnected"
                  description="The pipeline is running but isn’t connected to your database right now. It reconnects on its own; if this persists, check the logs."
                />
              )}

              {isStatusError && (
                <Admonition
                  type="warning"
                  title="Live updates paused"
                  description="We can’t reach this pipeline right now. Health below is the last we received, and we’re retrying automatically."
                />
              )}

              {applyLagMetrics && (
                <div className="border border-default rounded-lg bg-surface-100 px-4 py-4 space-y-3">
                  <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
                    <div>
                      <h4 className="text-sm font-semibold text-foreground">Pipeline metrics</h4>
                      <p className="text-xs text-foreground-light">
                        Live metrics on how this pipeline is doing right now.
                      </p>
                    </div>
                    <div className="flex items-center gap-x-2.5">
                      <SlotConnectionIndicator isActive={applyLagMetrics.active} />
                      <span className="h-3.5 w-px bg-border" />
                      <SlotStatusBadge status={applyLagMetrics.wal_status} />
                      <SlotStatusLegend />
                    </div>
                  </div>

                  <SlotLagMetricsList metrics={applyLagMetrics} />
                </div>
              )}
            </PageSectionContent>
          </PageSection>
        )}

        {!isPipelineLoading && !isStatusLoading && (
          <PageSection>
            <PageSectionMeta>
              <PageSectionSummary>
                <PageSectionTitle>Replicated tables</PageSectionTitle>
              </PageSectionSummary>
            </PageSectionMeta>
            <PageSectionContent className="flex flex-col gap-y-4">
              {hasTableData && (
                <div className="flex flex-col gap-y-3">
                  <div className="flex items-center justify-between">
                    <Input
                      icon={<Search />}
                      size="tiny"
                      className="text-xs w-52"
                      placeholder="Search for tables"
                      value={searchString}
                      disabled={isPipelineError}
                      onChange={(e) => setSearchString(e.target.value)}
                      actions={
                        searchString.length > 0 && [
                          <X
                            key="close"
                            className="mx-2 cursor-pointer text-foreground"
                            size={14}
                            strokeWidth={1.5}
                            onClick={() => setSearchString('')}
                          />,
                        ]
                      }
                    />
                    <div className="flex items-center">
                      <Button
                        size="tiny"
                        className="rounded-r-none hover:z-10 focus-visible:z-10 focus-visible:rounded-r-sm"
                        icon={<RotateCcw />}
                        disabled={isAnyRestartInProgress || showDisabledState || isPipelineError}
                        loading={isAnyRestartInProgress}
                        onClick={() => {
                          setBatchRestartMode('all')
                          setShowBatchRestartDialog(true)
                        }}
                      >
                        Restart all tables
                      </Button>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            aria-label="More restart options"
                            icon={<ChevronDown />}
                            className="shrink-0 rounded-l-none px-[4px] py-[5px] -ml-px focus-visible:z-10 focus-visible:rounded-l-sm"
                            disabled={showDisabledState || isPipelineError}
                          />
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-44">
                          <DropdownMenuItemTooltip
                            disabled={
                              !hasErroredTables || isAnyRestartInProgress || showDisabledState
                            }
                            onClick={() => {
                              setBatchRestartMode('errored')
                              setShowBatchRestartDialog(true)
                            }}
                            tooltip={{
                              content: {
                                side: 'left',
                                text: !hasErroredTables ? 'No failed tables' : undefined,
                              },
                            }}
                          >
                            Restart failed tables only
                          </DropdownMenuItemTooltip>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </div>

                  <Card>
                    <CardContent className="p-0">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead key="table">Table</TableHead>
                            <TableHead key="status">Status</TableHead>
                            <TableHead key="details">Details</TableHead>
                            <TableHead key="actions" />
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {filteredTableStatuses.map((table) => {
                            const isRestarting = restartingTableIds.has(table.id)
                            const isErrorState = table.state.name === 'error'
                            const errorReason =
                              isErrorState && 'reason' in table.state
                                ? table.state.reason
                                : undefined
                            const errorSolution =
                              isErrorState && 'solution' in table.state
                                ? (table.state.solution ?? undefined)
                                : undefined
                            return (
                              <TableReplicationRow
                                key={table.id}
                                table={table}
                                isRestarting={isRestarting}
                                showDisabledState={showDisabledState}
                                disabledStateMessage={config.message}
                                isAnyRestartInProgress={isAnyRestartInProgress}
                                isPipelineStopped={statusName === PipelineStatusName.STOPPED}
                                onSelectRestart={() => {
                                  setSelectedTableForRestart({
                                    id: table.id,
                                    schema: table.schema,
                                    name: table.name,
                                  })
                                  setShowRestartDialog(true)
                                }}
                                onSelectShowError={
                                  isErrorState && errorReason
                                    ? () => {
                                        setSelectedTableError({
                                          tableName: `${table.schema}.${table.name}`,
                                          reason: errorReason,
                                          solution: errorSolution,
                                        })
                                        setShowErrorDialog(true)
                                      }
                                    : () => {}
                                }
                              />
                            )
                          })}
                        </TableBody>
                      </Table>
                    </CardContent>
                  </Card>
                </div>
              )}

              {!hasTableData && (
                <EmptyStatePresentational
                  icon={Activity}
                  title={emptyState.title}
                  description={emptyState.description}
                />
              )}
            </PageSectionContent>
          </PageSection>
        )}
      </PageContainer>

      {/* Restart Table Confirmation Dialog */}
      {selectedTableForRestart && (
        <RestartTableDialog
          open={showRestartDialog}
          onOpenChange={setShowRestartDialog}
          table={selectedTableForRestart}
          tableSyncCopy={pipeline?.config.table_sync_copy}
          sourceId={pipeline?.source_id}
          publicationName={pipeline?.config.publication_name}
          pipelineStatusName={statusName}
          onRestartStart={() => {
            setTableResetting(pipelineId, true)
            setRestartingTableIds((prev) => new Set(prev).add(selectedTableForRestart.id))
          }}
          onRestartComplete={() => {
            setTableResetting(pipelineId, false)
            setRestartingTableIds((prev) => {
              const next = new Set(prev)
              next.delete(selectedTableForRestart.id)
              return next
            })
          }}
        />
      )}

      {/* Error Details Dialog */}
      {selectedTableError && (
        <ErrorDetailsDialog
          open={showErrorDialog}
          onOpenChange={setShowErrorDialog}
          tableName={selectedTableError.tableName}
          reason={selectedTableError.reason}
          solution={selectedTableError.solution}
        />
      )}

      {/* Batch Restart Dialog */}
      {batchRestartMode && (
        <BatchRestartDialog
          open={showBatchRestartDialog}
          onOpenChange={setShowBatchRestartDialog}
          mode={batchRestartMode}
          tables={tableStatuses}
          sourceId={pipeline?.source_id}
          publicationName={pipeline?.config.publication_name}
          tableSyncCopy={pipeline?.config.table_sync_copy}
          pipelineStatusName={statusName}
          onRestartStart={(tableIds) => {
            setTableResetting(pipelineId, true)
            setRestartingTableIds((prev) => new Set([...prev, ...tableIds]))
          }}
          onRestartComplete={(tableIds) => {
            setTableResetting(pipelineId, false)
            setRestartingTableIds((prev) => {
              const next = new Set(prev)
              tableIds.forEach((id) => next.delete(id))
              return next
            })
          }}
        />
      )}
    </>
  )
}
