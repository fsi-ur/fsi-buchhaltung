/** Upper bounds for list payloads (SEC-07) — far above real use, low enough to stop abuse. */
export const MAX_RECORD_POSITIONS = 500
export const MAX_RECIPIENT_IDS = 2000
export const MAX_POSITION_ASSIGNMENTS = 1000

export const TOO_MANY_POSITIONS = `Höchstens ${MAX_RECORD_POSITIONS} Positionen erlaubt.`
export const TOO_MANY_RECIPIENTS = `Höchstens ${MAX_RECIPIENT_IDS} Empfänger je Liste erlaubt.`
