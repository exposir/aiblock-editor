import { runCli } from './main'

void runCli(process.argv.slice(2)).then(code => { process.exitCode = code }).catch(error => {
  process.stderr.write(String(error) + '\n')
  process.exitCode = 1
})
