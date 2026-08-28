# Revisión de la feature 316 — enviar media por el chat

> Revisor: subagente `reviewer`, 2026-08-28. Rama `feature/316-chat-enviar-media`.
> Commits revisados: `e0983460` (feature) y `d1ce8601` (fix de la 311 rescatado).
> Base `origin/dev` en `7435bdff`. Gate completo corrido por el revisor: 535 s.
>
> **Nota de proceso:** el revisor NO pudo escribir este archivo (la herramienta de
> escritura está deshabilitada para subagentes en esta sesión), así que lo vuelca el
> leader con su contenido. Tampoco tuvo el MCP `codebase-memory`: exploró con `grep`,
> `git diff` y lectura directa.

## Veredicto original: RECHAZADO — 1 bloqueante, 8 menores, 1 hallazgo del spec

**El código de producto de la 316 se dio por bueno.** El rechazo fue por el gate.

## B1 (BLOQUEANTE) — el gate se autoenvenenaba. RESUELTO en `c4b13288`

`./init.sh` completo terminaba en rojo, y la causa la introducía esta rama —no el
código revisado—. El `test:json` que `init.sh` estrena en `6501cf84` escribía
`.vitest-rojos.json` (17 MB) **en la raíz del repo**, y el guard `no-embalaje`
recorre el árbol por extensión (`.json` incluida) **sin consultar `.gitignore`**.
Como ese volcado contiene los nombres de todos los tests —incluidos los del propio
guard—, **la primera corrida completa dejaba el repo en un estado en el que la
segunda fallaba**. Justo cuando `CLAUDE.md` §5 manda correr el completo tras cada
merge a `dev`.

La nota de la bitácora que lo daba por «RESUELTO en `6501cf84`» era **incorrecta**:
`.gitignore` decide qué se versiona, no qué ve un guard que camina el disco.

**Arreglo aplicado:** el reporte pasa a `.vitest/rojos.json`, fuera de la raíz, y el
guard ignora ese **directorio** como ya ignoraba `.claude`, por el mismo motivo
escrito. No se anotó el archivo en el whitelist ni se metió `no-embalaje` en
`tests/baseline-rojos.json`. **Probado por causación**, no por inspección: con el
volcado en la raíz el guard falla citando `.vitest-rojos.json:1`; con el arreglo pasa
1/1.

## Lo verificado y correcto

- **R1–R32: cero requisitos sin test.** El revisor comprobó los `it` en los archivos,
  no el mapa. Ningún assert trivial. Ejemplos de que los asserts muerden: R18 mete una
  marca dentro del Blob y la busca en el `JSON.stringify` de lo persistido; R11 manda
  un `tamano` mentiroso con `size` sobrescrito a 6 MB; R21 tiene la guarda **antes** de
  la bifurcación, cubre todo lo que no sea texto/plantilla y conserva la regresión del
  texto. **250/250 verde** en su corrida de los 14 archivos.
- **R11 en servidor**: doble validación, en action y service, ambas leyendo
  `archivo.type`/`archivo.size`. Lo del cliente no se usa como defensa.
- **R18 / sin binario propio**: cero `writeFile`/`Storage`/`base64`/`arrayBuffer()` en
  el camino; el `File` cruza de FormData a FormData.
- **R29–R32 / soporte iPhone**: las **tres** puertas de `comprimir-imagen.ts` cerradas
  (`saltarSiMenorA: 0`, `devolverOriginalSiMayor: false`, y el re-chequeo del MIME
  *después* para convertir el «no pude» en el aviso propio de R31). **El default del
  helper quedó intacto**, con test de regresión de las cuatro superficies que ya lo
  usaban. El límite se evalúa tras convertir.
- **Guard de credenciales**: solo 382→415 en los tres sitios; sin whitelist y sin
  relajar el assert; `whatsapp-cloud.ts:415` es el `console.log` real.
- **Cero migraciones y proxy intacto**, verificado con `git diff --stat origin/dev...HEAD`.
- **La resolución del conflicto de `d1ce8601` no perdió nada.** `ImagenAdjunta` y
  `ReproductorAdjunto` conservan `direccion` (R23) **y** `activar` (reintento)
  envolviendo `expirado` y `error`; `DocumentoAdjunto` no usaba el hook; `useMediaChat`
  mantiene el contador `intento`. 24/24.
- **Las 11 desviaciones declaradas: ninguna tapa un atajo.** La (9) —partir R16 en dos—
  es buen juicio: el assert literal pedía parar pistas de un stream inexistente.
- **S1 bien tratado**: declarado como supuesto, con método de medición, y el diseño no
  depende de él.

## Menores (no bloquean)

| # | Hallazgo | Estado |
| --- | --- | --- |
| M1 | F4 sin marcar y ficha en `spec_ready` | corregido por el leader |
| M2 | sin entrada en `progress/history.md` | pendiente, al cerrar la feature |
| M3 | R31: una imagen **ya en la lista blanca** cuya conversión falla avisa «supera el límite» en vez de «no se pudo preparar». No sube nada: el daño es de diagnóstico | abierto |
| M4 | el service pasa `caption` en audio; la omisión vive solo en el cliente | abierto |
| M5 | `maxLength` no trunca el texto ya escrito antes de adjuntar (lo ataja el servidor) | abierto |
| M6 | con `WHATSAPP_DEBUG_LOG=true` el volcado sigue siendo literal, frente al «en ninguna rama» de R28. Heredado y opt-in | abierto |
| M7 | la anotación posicional del guard de credenciales volverá a caducar | deuda declarada |
| M8 | el baseline compara **por archivo**, así que un archivo ya listado puede ganar un rojo real invisible | deuda del arnés |

## Hallazgo del SPEC (no del código)

`design.md` §2 y §6.2 se contradicen sobre `audio/ogg;codecs=opus`: el assert (e) de A1
era **imposible de satisfacer literalmente**. El implementer lo resolvió y lo declaró;
queda corregir el design para que el set lleve el MIME base y se diga que
`clasificarAdjunto` normaliza los parámetros.
