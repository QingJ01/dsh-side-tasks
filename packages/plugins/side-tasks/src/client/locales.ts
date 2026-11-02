export const NS = 'sideTasks'

export const zh = {
  'action.label': '侧边聊天',
  'action.open': '新建侧边聊天',
  'prompt.label': '第一个任务',
  'prompt.placeholder': '例如：检查这个分支的测试失败原因，先不要修改代码',
  'prompt.required': '请输入任务内容。',
  'create': '创建并在右侧打开',
  'create.pending': '正在创建…',
  'create.failed': '创建失败：{message}',
  'loading': '正在加载侧边聊天…',
  'load.failed': '无法打开侧边聊天：{message}',
  'empty.title': '侧边聊天',
  'empty.description': '侧边聊天是临时聊天，关闭标签后会结束并归档。',
  'guide.description': '继承当前会话上下文，创建临时侧边聊天',
  'create.blocked': '当前会话是子会话或已归档，不能创建侧边聊天。',
} as const

export type SideTaskKey = keyof typeof zh

export const en: Record<SideTaskKey, string> = {
  'action.label': 'Side chat',
  'action.open': 'Create a side chat',
  'prompt.label': 'First task',
  'prompt.placeholder': 'For example: investigate these test failures without changing code yet',
  'prompt.required': 'Enter a task first.',
  'create': 'Create and open',
  'create.pending': 'Creating…',
  'create.failed': 'Could not create the side task: {message}',
  'loading': 'Loading the side chat…',
  'load.failed': 'Could not open the side chat: {message}',
  'empty.title': 'Side chat',
  'empty.description': 'Side chat is temporary. Closing its tab ends and archives it.',
  'guide.description': 'Start a temporary side chat with this session’s context',
  'create.blocked': 'This session is a child or is archived, so it cannot start a side chat.',
}
