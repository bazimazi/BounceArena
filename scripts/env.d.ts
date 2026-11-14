// The dev scripts run under vite-node; this is all of Node they use, without pulling in @types/node.
declare const process: { argv: string[]; env: Record<string, string | undefined> }
