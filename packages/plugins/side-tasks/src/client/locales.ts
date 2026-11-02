export const NS = 'sideTasks'

export const zh = {
  'action.label': '侧边任务',
  'action.open': '新建或恢复侧边任务',
  'modal.title': '侧边任务',
  'modal.description': '继承当前会话已完成回合的上下文，在右侧栏独立运行。关闭侧栏不会结束任务，也不会创建新会话。',
  'prompt.label': '第一个任务',
  'prompt.placeholder': '例如：检查这个分支的测试失败原因，先不要修改代码',
  'prompt.required': '请输入任务内容。',
  'create': '创建并在右侧打开',
  'create.pending': '正在创建…',
  'create.failed': '创建失败：{message}',
  'cancel': '取消',
  'close': '关闭',
  'existing': '重新打开',
  'existing.empty': '当前会话还没有侧边任务。',
  'open.aria': '在右侧栏重新打开 {label}',
} as const

export type SideTaskKey = keyof typeof zh

export const en: Record<SideTaskKey, string> = {
  'action.label': 'Side tasks',
  'action.open': 'Create or reopen a side task',
  'modal.title': 'Side tasks',
  'modal.description': 'Inherits this session’s completed-turn context and runs independently in the right sidebar. Closing the panel neither stops the task nor creates another session.',
  'prompt.label': 'First task',
  'prompt.placeholder': 'For example: investigate these test failures without changing code yet',
  'prompt.required': 'Enter a task first.',
  'create': 'Create and open aside',
  'create.pending': 'Creating…',
  'create.failed': 'Could not create the side task: {message}',
  'cancel': 'Cancel',
  'close': 'Close',
  'existing': 'Reopen',
  'existing.empty': 'No side tasks in this session yet.',
  'open.aria': 'Reopen {label} in the right sidebar',
}
