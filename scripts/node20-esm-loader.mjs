// node20-esm-loader.mjs
// ESM resolve hook：把 import 'better-sqlite3' 重定向到 .test-deps 里为
// 系统 Node (ABI 115) 编译的副本。由 use-node20-better-sqlite3.cjs 注册。
export async function resolve(specifier, context, nextResolve) {
  if (specifier === 'better-sqlite3') {
    return {
      url: new URL('../.test-deps/node_modules/better-sqlite3/lib/index.js', import.meta.url).href,
      shortCircuit: true,
    };
  }
  return nextResolve(specifier, context);
}
