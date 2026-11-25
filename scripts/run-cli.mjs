// pnpm forwards the argument separator to package scripts.
if (process.argv[2] === '--') process.argv.splice(2, 1)
await import('../dist-cli/aiblock-doc.mjs')
