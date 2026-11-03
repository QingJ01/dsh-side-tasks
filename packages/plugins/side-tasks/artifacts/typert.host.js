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
  mode: z.union([z.literal('independent'), z.literal('continuable')]).readonly(),
  contextThrough: z.number().int().min(-1).optional().readonly(),
})
const discardRequest = () => z.object({
  parentSessionId: z.string().readonly(),
  childSessionId: z.string().readonly(),
})
const strictDiscardRequest = () => z.strictObject({
  parentSessionId: z.string().readonly(),
  childSessionId: z.string().readonly(),
})
const configureRequest = (strict = false) => {
  const object = strict ? z.strictObject.bind(z) : z.object.bind(z)
  const ids = { parentSessionId: z.string().min(1), childSessionId: z.string().min(1) }
  return z.discriminatedUnion('kind', [
    object({ ...ids, kind: z.literal('model'), selection: object({
      provider: z.string().min(1), model: z.string().min(1), reasoningEffort: z.string().optional(),
    }) }),
    object({ ...ids, kind: z.literal('permission'), preset: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/) }),
  ])
}
const configureResult = () => z.object({ configured: z.literal(true).readonly() })
const discardResult = () => z.object({ discarded: z.literal(true).readonly() })
const capabilitiesResult = () => z.object({ supportsSideChatSessions: z.boolean().readonly() })

const $remote = createTypertRemoteInfo({
  package: 'dsh-side-tasks',
  methods: {
    'sideTasks/create': {
      service: 'sideTasks',
      description: 'Create an independent root side chat from read-only source context.',
      invocation: { kind: 'direct' },
      cancellation: { parameter: 'signal' },
      parameters: [
        {
          name: 'sourceSessionId',
          source: 'json',
          codec: {
            mode: 'strict',
            typeSymbol: '@deepseek-ai/dsh-session/types#SessionId',
            create: sessionId,
            jsonSchema: { type: 'string' },
          },
          strictCodec: { mode: 'strict', typeSymbol: '@deepseek-ai/dsh-session/types#SessionId', create: sessionId, jsonSchema: { type: 'string' } },
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
            mode: { type: 'string', enum: ['independent', 'continuable'] },
            contextThrough: { type: 'integer', minimum: -1 },
          },
          required: ['parentSessionId', 'childSessionId', 'mode'],
          additionalProperties: true,
        },
      },
      sourceLocation: { file: 'packages/plugins/side-tasks/src/index.ts', line: 61, column: 3 },
    },
    'sideTasks/discard': {
      service: 'sideTasks',
      description: 'Stop and archive a side chat when its tab closes.',
      invocation: { kind: 'direct' },
      cancellation: { parameter: 'signal' },
      parameters: [
        {
          name: 'request',
          description: 'parent/child pair to discard; the parent Agent may be offline.',
          source: 'json',
          codec: {
            mode: 'strict',
            typeSymbol: 'dsh-side-tasks#DiscardSideTaskRequest',
            create: discardRequest,
            jsonSchema: {
              type: 'object',
              properties: {
                parentSessionId: { type: 'string' },
                childSessionId: { type: 'string' },
              },
              required: ['parentSessionId', 'childSessionId'],
              additionalProperties: true,
            },
          },
          strictCodec: {
            mode: 'strict',
            typeSymbol: 'dsh-side-tasks#DiscardSideTaskRequest',
            create: strictDiscardRequest,
            jsonSchema: {
              type: 'object',
              properties: {
                parentSessionId: { type: 'string' },
                childSessionId: { type: 'string' },
              },
              required: ['parentSessionId', 'childSessionId'],
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
      sourceLocation: { file: 'packages/plugins/side-tasks/src/index.ts', line: 138, column: 3 },
    },
    'sideTasks/configure': {
      service: 'sideTasks',
      description: 'Change one owned child model or permission preset.',
      invocation: { kind: 'direct' },
      cancellation: { parameter: 'signal' },
      parameters: [{
        name: 'request', source: 'json',
        codec: { mode: 'strict', typeSymbol: 'dsh-side-tasks#ConfigureSideTaskRequest', create: () => configureRequest(false), jsonSchema: { type: 'object' } },
        strictCodec: { mode: 'strict', typeSymbol: 'dsh-side-tasks#ConfigureSideTaskRequest', create: () => configureRequest(true), jsonSchema: { type: 'object' } },
      }],
      result: { mode: 'strict', typeSymbol: 'dsh-side-tasks#ConfigureSideTaskResult', create: configureResult,
        jsonSchema: { type: 'object', properties: { configured: { const: true } }, required: ['configured'] } },
      sourceLocation: { file: 'packages/plugins/side-tasks/src/index.ts', line: 133, column: 3 },
    },
    'sideTasks/capabilities': {
      service: 'sideTasks',
      invocation: { kind: 'direct' },
      parameters: [],
      result: {
        mode: 'strict',
        typeSymbol: 'dsh-side-tasks#SideTaskCapabilities',
        create: capabilitiesResult,
        jsonSchema: {
          type: 'object',
          properties: { supportsSideChatSessions: { type: 'boolean' } },
          required: ['supportsSideChatSessions'],
        },
      },
      sourceLocation: { file: 'packages/plugins/side-tasks/src/index.ts', line: 128, column: 3 },
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
        kind: 'method', name: 'configure',
        signature: "@Remote({ name: 'configure', resources: { session: ... } }) configure(request: ConfigureSideTaskRequest, signal: AbortSignal): Promise<ConfigureSideTaskResult>",
        summary: 'Change one owned child model or permission preset.',
      }, {
        kind: 'method',
        name: 'create',
        signature: "@Remote({ name: 'create', resources: { session: ... } }) async create(sourceSessionId: SessionId, request: CreateSideTaskRequest, signal: AbortSignal): Promise<SideTaskAddress>",
        summary: 'Create one child without creating or selecting an ordinary session.',
        jsDoc: '/** Create one child without creating or selecting an ordinary session. */',
      }, {
        kind: 'method',
        name: 'capabilities',
        signature: "@Remote('capabilities') capabilities(): SideTaskCapabilities",
        summary: 'Report Host support for independent side-chat Sessions.',
      }, {
        kind: 'method',
        name: 'discard',
        signature: "@Remote({ name: 'discard', resources: { session: ... } }) discard(request: DiscardSideTaskRequest, signal: AbortSignal): Promise<DiscardSideTaskResult>",
        summary: 'Stop and archive one plugin-owned child when its tab closes.',
        jsDoc: '/** Stop and archive one plugin-owned child when its tab closes. */',
      }],
      types: [],
    }],
    events: [],
    objects: [],
  },
}
