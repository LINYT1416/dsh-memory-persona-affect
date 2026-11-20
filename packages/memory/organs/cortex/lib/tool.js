// 工具封装：和 DSH 的 tool 形状一致。
export function makeTool(name, description, properties, required, handler) {
  return {
    name,
    description,
    parameters: { type: 'object', properties, required, additionalProperties: false },
    output: {
      schema: { type: 'object' },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    isConcurrencySafe: () => false,
    async execute(args, exec) {
      const out = await handler(args || {}, exec || {})
      return { content: [{ type: 'text', text: JSON.stringify(out ?? {}, null, 2) }] }
    },
  }
}
