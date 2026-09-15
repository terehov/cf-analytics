/**
 * Typsichere Hooks fuer die Ansichten.
 *
 * `generateHelpers` leitet Ein- und Ausgabetypen jedes Werkzeugs aus
 * `typeof app` ab — eine Ansicht, die eine Spalte liest, die es nicht mehr
 * gibt, faellt damit beim Typecheck auf und nicht im Chat.
 */
import { generateHelpers } from 'skybridge/web'
import type { AppType } from './server'

export const { useToolInfo, useCallTool } = generateHelpers<AppType>()
