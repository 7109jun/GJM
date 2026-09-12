import readline from 'node:readline';

export type ToolHandler = (args: any) => Promise<McpResult> | McpResult;
export type ResourceHandler = (uri: URL) => Promise<any> | any;
export type PromptHandler = (args: any) => Promise<any> | any;

export interface McpResult {
  content: Array<Record<string, unknown>>;
  isError?: boolean;
  [key: string]: unknown;
}

function json(value: unknown): string { return JSON.stringify(value); }

export class McpServer {
  private tools = new Map<string, any>();
  private resources = new Map<string, any>();
  private prompts = new Map<string, any>();
  private connected = false;

  constructor(private readonly serverInfo: { name: string; version: string }, private readonly options: { instructions?: string } = {}) {}

  registerTool(name: string, definition: any, handler: ToolHandler): void {
    this.tools.set(name, { name, ...definition, handler });
  }

  registerResource(name: string, uriTemplate: string, definition: any, handler: ResourceHandler): void {
    this.resources.set(name, { name, uriTemplate, ...definition, handler });
  }

  registerPrompt(name: string, definition: any, handler: PromptHandler): void {
    this.prompts.set(name, { name, ...definition, handler });
  }

  private toolList() {
    return [...this.tools.values()].map((tool) => ({
      name: tool.name,
      title: tool.title,
      description: tool.description,
      inputSchema: tool.inputSchema?.toJSONSchema?.() ?? tool.inputSchema ?? { type: 'object', properties: {} },
      annotations: tool.annotations
    }));
  }

  private resourceList() {
    return [...this.resources.values()].map((resource) => ({
      uri: resource.uriTemplate,
      name: resource.name,
      title: resource.title,
      description: resource.description,
      mimeType: resource.mimeType
    }));
  }

  private promptList() {
    return [...this.prompts.values()].map((prompt) => ({
      name: prompt.name,
      title: prompt.title,
      description: prompt.description,
      arguments: prompt.argsSchema ? schemaArguments(prompt.argsSchema) : []
    }));
  }

  async handle(message: any): Promise<any> {
    if (message?.jsonrpc !== '2.0') return null;
    const id = message.id;
    const method = message.method;
    const params = message.params ?? {};

    if (method === 'initialize') {
      this.connected = true;
      return response(id, {
        protocolVersion: '2026-07-28',
        capabilities: {
          tools: { listChanged: false },
          resources: { subscribe: false, listChanged: false },
          prompts: { listChanged: false }
        },
        serverInfo: this.serverInfo,
        instructions: this.options.instructions
      });
    }

    if (method === 'notifications/initialized') return null;
    if (method === 'ping') return response(id, {});
    if (!this.connected) return errorResponse(id, -32002, 'Server is not initialized');

    try {
      if (method === 'tools/list') return response(id, { tools: this.toolList() });
      if (method === 'resources/list') return response(id, { resources: this.resourceList() });
      if (method === 'prompts/list') return response(id, { prompts: this.promptList() });

      if (method === 'tools/call') {
        const tool = this.tools.get(params.name);
        if (!tool) return errorResponse(id, -32602, `Unknown tool: ${params.name}`);
        const args = tool.inputSchema?.parse ? tool.inputSchema.parse(params.arguments ?? {}) : (params.arguments ?? {});
        return response(id, await tool.handler(args));
      }

      if (method === 'resources/read') {
        const raw = String(params.uri ?? '');
        const resource = [...this.resources.values()].find((candidate) => raw.startsWith(candidate.uriTemplate));
        if (!resource) return errorResponse(id, -32002, `Resource not found: ${raw}`);
        return response(id, await resource.handler(new URL(raw)));
      }

      if (method === 'prompts/get') {
        const prompt = this.prompts.get(params.name);
        if (!prompt) return errorResponse(id, -32602, `Unknown prompt: ${params.name}`);
        const args = prompt.argsSchema?.parse ? prompt.argsSchema.parse(params.arguments ?? {}) : (params.arguments ?? {});
        return response(id, await prompt.handler(args));
      }

      return errorResponse(id, -32601, `Method not found: ${method}`);
    } catch (error) {
      return errorResponse(id, -32602, error instanceof Error ? error.message : String(error));
    }
  }

  async connectStdio(): Promise<void> {
    const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
    for await (const line of rl) {
      if (!line.trim()) continue;
      let message: any;
      try { message = JSON.parse(line); } catch { process.stderr.write('[GJM] invalid JSON-RPC input\n'); continue; }
      const result = await this.handle(message);
      if (result !== null) process.stdout.write(json(result) + '\n');
    }
  }

  debugTools(): string[] { return [...this.tools.keys()]; }
  debugResources(): string[] { return [...this.resources.values()].map((r) => r.uriTemplate); }
  debugPrompts(): string[] { return [...this.prompts.keys()]; }
}

function schemaArguments(schema: any) {
  const raw = schema?.toJSONSchema?.() ?? {};
  return Object.entries(raw.properties ?? {}).map(([name, item]: [string, any]) => ({
    name,
    description: item.description,
    required: (raw.required ?? []).includes(name)
  }));
}

function response(id: unknown, result: unknown) { return { jsonrpc: '2.0', id, result }; }
function errorResponse(id: unknown, code: number, message: string) { return { jsonrpc: '2.0', id, error: { code, message } }; }
