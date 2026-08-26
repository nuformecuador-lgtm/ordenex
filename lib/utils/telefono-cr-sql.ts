// Gemelo EN SQL de `normalizarTelefonoCR` (`lib/utils/telefono-cr.ts`).
//
// POR QUE EXISTE. La resolucion del entrante de WhatsApp compara el numero que manda Meta
// —ya normalizado en TypeScript— contra `orden.telefono_dest`, que se guarda TAL CUAL lo
// carga el negocio (`8888-7777`, `+506 8888 7777`, `50688887777`, …). Ese lado es una COLUMNA:
// Prisma no puede normalizarla en el `where`, asi que la comparacion vive en SQL crudo.
//
// Antes ese lado solo hacia `regexp_replace(telefono_dest, '[^0-9]', '', 'g')` —quitar
// separadores, sin prefijar—, mientras el entrante llegaba como `506########`. Resultado: las
// ordenes de Costa Rica guardadas en formato LOCAL no casaban NUNCA, el webhook contaba el
// evento como `sinResolver`, respondia 200 y el mensaje se perdia sin rastro (Meta no reintenta
// un 200). Se veia solo en CR porque los numeros no-CR ya se guardan con su indicativo.
//
// La duplicacion TS/SQL es inevitable (una compara valores en memoria, la otra una columna),
// pero NO es libre: `tests/integration/db/chat-entrante-telefono-cr.test.ts` corre esta misma
// expresion contra Postgres real y exige que produzca EL MISMO texto que la funcion de
// TypeScript sobre las formas que aparecen de verdad en la columna. Por eso la expresion se
// exporta desde aqui en vez de escribirse a mano en el repositorio: hay UNA sola copia, y esta
// vigilada.
//
// Las reglas, EN ESTE ORDEN (identico a `normalizarTelefonoCR`):
//   1. `+` inicial -> prefijo internacional explicito: solo digitos, sin anteponer nada.
//   2. Ya empieza por `506` -> se respeta, no se duplica el indicativo.
//   3. Exactamente 8 digitos (local CR) -> se antepone `506`.
//   4. Cualquier otra longitud -> digitos tal cual, sin inventar prefijo.

/**
 * Devuelve la expresion SQL que normaliza `columna` igual que `normalizarTelefonoCR`.
 *
 * `columna` es un IDENTIFICADOR SQL y se interpola sin escapar: los llamantes DEBEN pasar un
 * literal del codigo (`"o.telefono_dest"`), nunca algo que venga de una request. El numero con
 * el que se compara sigue viajando como parametro, que es lo unico que puede venir de fuera.
 */
export function sqlNormalizarTelefonoCr(columna: string): string {
  const digitos = `regexp_replace(${columna}, '[^0-9]', '', 'g')`;
  return `CASE
      WHEN ltrim(${columna}) LIKE '+%' THEN ${digitos}
      WHEN ${digitos} LIKE '506%' THEN ${digitos}
      WHEN length(${digitos}) = 8 THEN '506' || ${digitos}
      ELSE ${digitos}
    END`;
}
