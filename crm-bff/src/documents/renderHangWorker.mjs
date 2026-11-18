/** Test-only worker that never finishes (for hard-kill timeout coverage). */
import { parentPort } from 'node:worker_threads'

const forever = () => {
  setTimeout(forever, 60_000)
}
forever()
// Keep parentPort referenced so the worker stays alive.
void parentPort
