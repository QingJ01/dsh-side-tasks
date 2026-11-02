/* Remote metadata for dsh-side-tasks; built on the public Typert protocol. */
import { z } from 'zod'
import { createTypertRemoteInfo } from '@deepseek-ai/dsh-typert-protocol/remote-info'

const sessionId = () => z.string()
const request = () => z.object({ prompt: z.string().readonly() })
const strictRequest = () => z.strictObject({ prompt: z.string().readonly() })
const address = () => z.object({
  parentSessionId: z.string().readonly(),
  childSessionId: z.string().readonly(),
  mode: z.literal('continuable').readonly(),
})

const $remote = createTypertRemoteInfo({
  package: 'dsh-side-tasks',
  methods: {
    'sideTasks/create': {
      service: 'sideTasks',
      description: 'Create a context-inheriting side task without creating an ordinary session.',
      invocation: { kind: 'direct' },
      scope: { context: 'agent', wire: 'agentId' },
      parameters: [
        {
          name: 'agent',
          wire: 'agentId',
          description: 'exact live parent agent.',
          source: 'lookup',
          lookup: 'agent',
          codec: {
            mode: 'strict',
            typeSymbol: '@deepseek-ai/dsh-session/types#SessionId',
            create: sessionId,
            jsonSchema: { type: 'string' },
          },
          strictCodec: {
            mode: 'strict',
            typeSymbol: '@deepseek-ai/dsh-session/types#SessionId',
            create: sessionId,
            jsonSchema: { type: 'string' },
          },
        },
        {
          name: 'request',
          description: 'first user message for the child.',
          source: 'json',
          codec: {
            mode: 'strict',
            typeSymbol: 'dsh-side-tasks#CreateSideTaskRequest',
            create: request,
            jsonSchema: {
              type: 'object',
              properties: { prompt: { type: 'string' } },
              required: ['prompt'],
              additionalProperties: true,
            },
          },
          strictCodec: {
            mode: 'strict',
            typeSymbol: 'dsh-side-tasks#CreateSideTaskRequest',
            create: strictRequest,
            jsonSchema: {
              type: 'object',
              properties: { prompt: { type: 'string' } },
              required: ['prompt'],
              additionalProperties: false,
            },
          },
        },
      ],
      result: {
        mode: 'strict',
        typeSymbol: 'dsh-side-tasks#SideTaskAddress',
        create: address,
        description: 'durable address used to open the child in the right sidebar.',
        jsonSchema: {
          type: 'object',
          properties: {
            parentSessionId: { type: 'string' },
            childSessionId: { type: 'string' },
            mode: { type: 'string', enum: ['continuable'] },
          },
          required: ['parentSessionId', 'childSessionId', 'mode'],
          additionalProperties: true,
        },
      },
      sourceLocation: { file: 'packages/plugins/side-tasks/src/index.ts', line: 32, column: 3 },
    },
  },
}, z)

export const TYPERT = {
  package: 'dsh-side-tasks',
  face: 'host',
  schemas: [],
  get invocations() { return $remote.descriptors },
  model: {
    services: [{
      description: 'Remote namespace and host lifecycle owner for side tasks.',
      summary: 'Remote namespace and host lifecycle owner for side tasks.',
      tags: [],
      jsDoc: '/** Remote namespace and host lifecycle owner for side tasks. */',
      key: 'sideTasks',
      exportName: 'SideTaskService',
      members: [{
        kind: 'method',
        name: 'create',
        signature: "@Remote('create') async create(agent: Agent, request: CreateSideTaskRequest, signal: AbortSignal): Promise<SideTaskAddress>",
        summary: 'Create one child without creating or selecting an ordinary session.',
        jsDoc: '/** Create one child without creating or selecting an ordinary session. */',
      }],
      types: [],
    }],
    events: [],
    objects: [],
  },
}
