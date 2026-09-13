/**
 * Der Bau der Ansichten.
 *
 * Das Skybridge-Plugin findet die Ansichten in `src/views/` (eine Datei je
 * registriertem `view.component`, Dateiname in Kebab-Schreibweise) und
 * erzeugt daraus `.skybridge/views.d.ts` — die Typdatei, die
 * `useToolInfo<'werkzeug'>()` in den Ansichten ueberhaupt erst typsicher
 * macht.
 *
 * Ohne diese Datei startet der Server nicht, sobald ein Werkzeug eine
 * Ansicht traegt.
 */
import { defineConfig } from 'vite'
import { skybridge } from '@skybridge/vite-plugin'

export default defineConfig({
  plugins: [skybridge()],
})
