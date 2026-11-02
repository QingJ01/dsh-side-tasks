/* Remote metadata for dsh-side-tasks; built on the public Typert protocol. */
import { z } from 'zod'

// Self-contained copy of the protocol's pure lazy Remote-info factory. The
// profile can resolve an older protocol package through hoisted third-party
// dependencies, so importing its /remote-info subpath is not reliable.
function createTypertRemoteInfo(spec, zod) {
  return new RemoteInfo(spec, zod)
}

class RemoteInfo {
  constructor(spec, zod) {
    this.spec = spec
    this.zod = zod
  }
  get package() { return this.spec.package }
  get descriptors() { return this.resolve().descriptors }
  get methods() { return this.resolve().methods }
  resolve() {
    if (this.index !== undefined) return this.index
    const zod = this.zod
    const descriptors = []
    const methods = Object.create(null)
    for (const [endpoint, definition] of Object.entries(this.spec.methods)) {
      const separator = endpoint.indexOf('/')
      const namespace = endpoint.slice(0, separator)
      const method = endpoint.slice(separator + 1)
      const parameters = definition.parameters.map(parameter => ({ ...parameter, wire: parameter.wire ?? parameter.name }))
      const descriptor = {
        ...definition,
        id: `${this.spec.package}#${endpoint}`,
        namespace,
        method,
        parameters,
        result: definition.result.description === undefined
          ? definition.result
          : new ResultValue(definition.result),
      }
      if (definition.invocation.kind === 'direct') {
        const inputs = []
        methods[endpoint] = Object.assign(descriptor, {
          input(options) {
            const strict = options?.strict === true
            return (inputs[strict ? 1 : 0] ??= new NamedInput(parameters, strict, zod))
          },
          invoke(remote, input, signal) {
            const values = parameters.map(parameter => input[parameter.wire])
            if (definition.cancellation !== undefined) values.push(signal)
            const receiver = Reflect.get(remote, namespace)
            return Reflect.get(receiver, method).apply(receiver, values)
          },
        })
      }
      descriptors.push(descriptor)
    }
    return (this.index = { descriptors, methods })
  }
}

class NamedInput {
  constructor(parameters, strict, zod) {
    this.parameters = parameters
    this.strict = strict
    this.zod = zod
    this.create = () => (this.schema ??= this.zod.strictObject(Object.fromEntries(this.parameters.map(parameter => {
      const value = this.codec(parameter).create()
      return [parameter.wire, this.optional(parameter) ? value.optional() : value.nonoptional()]
    }))))
  }
  codec(parameter) {
    return this.strict ? parameter.strictCodec : parameter.codec
  }
  optional(parameter) {
    return parameter.source === 'json' && parameter.acceptsUndefined === true
  }
  get jsonSchema() { return this.project().jsonSchema }
  get jsonSchemaError() { return this.project().jsonSchemaError }
  project() {
    if (this.projection !== undefined) return this.projection
    const unavailable = this.parameters.find(parameter => this.codec(parameter).jsonSchema === undefined)
    if (unavailable !== undefined) {
      return (this.projection = {
        jsonSchemaError: this.codec(unavailable).jsonSchemaError ?? `No JSON Schema for parameter ${unavailable.wire}`,
      })
    }
    return (this.projection = {
      jsonSchema: {
        type: 'object',
        properties: Object.fromEntries(this.parameters.map(parameter => [parameter.wire, {
          ...this.codec(parameter).jsonSchema,
          ...(parameter.description === undefined ? {} : { description: parameter.description }),
        }])),
        required: this.parameters.filter(parameter => !this.optional(parameter)).map(parameter => parameter.wire),
        additionalProperties: false,
      },
    })
  }
}

class ResultValue {
  constructor(spec) { this.spec = spec }
  get mode() { return this.spec.mode }
  get typeSymbol() { return this.spec.typeSymbol }
  get create() { return this.spec.create }
  get decode() { return this.spec.decode }
  get encode() { return this.spec.encode }
  get description() { return this.spec.description }
  get jsonSchemaError() { return this.spec.jsonSchemaError }
  get jsonSchema() {
    if (this.projection === undefined) {
      const schema = this.spec.jsonSchema
      this.projection = { value: schema === undefined ? undefined : { ...schema, description: this.spec.description } }
    }
    return this.projection.value
  }
}

const sessionId = () => z.string()
const request = () => z.object({ prompt: z.string().readonly() })
const strictRequest = () => z.strictObject({ prompt: z.string().readonly() })
const address = () => z.object({
  parentSessionId: z.string().readonly(),
  childSessionId: z.string().readonly(),
  mode: z.literal('continuable').readonly(),
})
const discardRequest = () => z.object({ childSessionId: z.string().readonly() })
const strictDiscardRequest = () => z.strictObject({ childSessionId: z.string().readonly() })
const discardResult = () => z.object({ discarded: z.literal(true).readonly() })

const $remote = createTypertRemoteInfo({
  package: 'dsh-side-tasks',
  methods: {
    'sideTasks/create': {
      service: 'sideTasks',
      description: 'Create a context-inheriting side task without creating an ordinary session.',
      invocation: { kind: 'direct' },
      cancellation: { parameter: 'signal' },
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
      sourceLocation: { file: 'packages/plugins/side-tasks/src/index.ts', line: 46, column: 3 },
    },
    'sideTasks/discard': {
      service: 'sideTasks',
      description: 'Stop and archive a side chat when its tab closes.',
      invocation: { kind: 'direct' },
      cancellation: { parameter: 'signal' },
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
          description: 'child session to discard.',
          source: 'json',
          codec: {
            mode: 'strict',
            typeSymbol: 'dsh-side-tasks#DiscardSideTaskRequest',
            create: discardRequest,
            jsonSchema: {
              type: 'object',
              properties: { childSessionId: { type: 'string' } },
              required: ['childSessionId'],
              additionalProperties: true,
            },
          },
          strictCodec: {
            mode: 'strict',
            typeSymbol: 'dsh-side-tasks#DiscardSideTaskRequest',
            create: strictDiscardRequest,
            jsonSchema: {
              type: 'object',
              properties: { childSessionId: { type: 'string' } },
              required: ['childSessionId'],
              additionalProperties: false,
            },
          },
        },
      ],
      result: {
        mode: 'strict',
        typeSymbol: 'dsh-side-tasks#DiscardSideTaskResult',
        create: discardResult,
        description: 'confirmation that the close lifecycle completed.',
        jsonSchema: {
          type: 'object',
          properties: { discarded: { type: 'boolean', enum: [true] } },
          required: ['discarded'],
          additionalProperties: true,
        },
      },
      sourceLocation: { file: 'packages/plugins/side-tasks/src/index.ts', line: 62, column: 3 },
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
      }, {
        kind: 'method',
        name: 'discard',
        signature: "@Remote('discard') async discard(agent: Agent, request: DiscardSideTaskRequest, signal: AbortSignal): Promise<DiscardSideTaskResult>",
        summary: 'Stop and archive one plugin-owned child when its tab closes.',
        jsDoc: '/** Stop and archive one plugin-owned child when its tab closes. */',
      }],
      types: [],
    }],
    events: [],
    objects: [],
  },
}
