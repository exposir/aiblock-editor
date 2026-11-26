export type PaseoAgentStatus = 'running' | 'requiresAttention' | 'idle' | 'closed'

export interface PaseoAgent {
  readonly id: string
  readonly title: string
  readonly workspaceId: string
  readonly cwd: string
  readonly provider: string
  readonly model: string
  readonly lastStatus: string
  readonly requiresAttention: boolean
  readonly createdAt: string
  readonly lastActivityAt: string
  readonly updatedAt: string
}

export interface PaseoWorkspace {
  readonly workspaceId: string
  readonly projectId: string
  readonly title: string
  readonly displayName: string
  readonly cwd: string
  readonly parentWorkspaceId: string | null
  readonly pinnedAt: string | null
  readonly createdAt: string
  readonly lastActivityAt: string
  readonly updatedAt: string
  readonly agents: readonly PaseoAgent[]
}

export interface PaseoProject {
  readonly projectId: string
  readonly name: string
  readonly path: string
  readonly workspaces: readonly PaseoWorkspace[]
}

export interface PaseoTreeSnapshot {
  readonly available: boolean
  readonly projects: readonly PaseoProject[]
  readonly workspaces: readonly PaseoWorkspace[]
  readonly orphanAgents: readonly PaseoAgent[]
}

export interface PaseoLogItem {
  readonly type: string
  readonly text?: string
  readonly messageId?: string
  readonly callId?: string
  readonly name?: string
  readonly detail?: unknown
  readonly status?: string
  readonly error?: string
}

export interface PaseoAgentLogs {
  readonly agentId: string
  readonly items: readonly PaseoLogItem[]
}

export interface PaseoLogsOptions {
  readonly force?: boolean
}
