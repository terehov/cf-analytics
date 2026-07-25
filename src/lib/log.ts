/** Logging über tslog in dessen Voreinstellung: menschenlesbar statt JSON.
 *
 *  Die Farbe entscheidet tslog selbst anhand der Umgebung — koloriert am
 *  interaktiven Terminal, ohne jedes Escape-Zeichen sobald umgeleitet wird.
 *  Genau das trennt Entwicklung von Produktion: im Container hängt an stdout
 *  kein TTY, Dokploy bekommt also reinen Text. Dafür ist hier bewusst nichts
 *  konfiguriert. `NO_COLOR` respektiert tslog zusätzlich. */
import { Logger, type ILogObj } from 'tslog'
import { config } from '../config'

/** tslog kennt die Stufennamen nur in Großschreibung; `LOG_LEVEL` ist klein. */
const minLevel = config.LOG_LEVEL.toUpperCase() as Uppercase<typeof config.LOG_LEVEL>

export const log: Logger<ILogObj> = new Logger({ minLevel })
