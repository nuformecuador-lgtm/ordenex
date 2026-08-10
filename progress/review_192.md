# Feature 192 — revisión

> **Procedencia:** el subagente `reviewer` fue detenido por el humano antes de escribir nada.
> Esta revisión la hizo el **leader** inline el 2026-08-09. Cada afirmación de aquí abajo sale
> de leer el archivo citado o de una corrida real; lo que no pude verificar está marcado como tal.

## Veredicto

**APROBADO en cuanto a la feature. NO liberable todavía**, por una razón que no es suya: el
`./init.sh` completo no está verde (ver §5). La regla del repo —gate completo antes de cada PR,
sin excepción— no se cumple hoy, y no la doy por cumplida.

---

## 1. Trazabilidad R1..R73

**73/73 sin huérfanos.** El mapa mecánico de `impl_192.md` sale de menciones de la etiqueta, así
que verifiqué a mano los requisitos que cuelgan de un solo archivo, que son donde una mención en
comentario podría hacerse pasar por cobertura. Todos tienen aserción real:

| Req | Dónde | Qué asserta de verdad |
|---|---|---|
| R18 | `integration/tablero-dia-conteo` | una orden sin mensajero no aparece en ninguna tarjeta |
| R22 | ídem | gestiones anuladas: la orden vuelve a su estatus; gana la última VIGENTE |
| R23 | ídem | el último milisegundo del día cuenta; la medianoche siguiente no |
| R26 | ídem | el resultado se atribuye al mensajero ASIGNADO, no a quien registró |
| R24/R27 | `unit/tablero-dia/resultados-exhaustivos` | un contador por cada valor del enum, y el enum no ganó/perdió/renombró valores |
| R31 | `components/TableroDiaModule` | se vuelve a consultar cada 30 s, contando llamadas |
| R50 | `components/DetalleMensajeroPanel` | la selección vive en el query param, no en `useState` |
| R66/R70 | `unit/services/tablero-dia-cache` | segunda petición dentro del TTL no consulta; al cruzar medianoche CR la clave cambia |

R27 merece mención: vigila el enum del esquema, así que si alguien añade un resultado nuevo el
tablero sale **rojo** en vez de absorberlo en silencio dentro de "sin resultado".

## 2. R59 — `asignado_at` de solo lectura · **VERIFICADO**

La única aparición en código nuevo es `TableroDiaRepository.ts:330`, lectura para armar el DTO.

La guardia `asignado-at-solo-lectura.guardia.test.ts` es más fuerte de lo que pedía el requisito
y no es burlable por los caminos habituales:

- No censa "aparece `asignadoAt` en un payload" sino algo menos frágil: **la feature no escribe
  NADA**, ni SQL (`UPDATE|INSERT|DELETE|MERGE`) ni Prisma (`.update(`, `.upsert(`, …).
- Quita comentarios antes de medir, así que explicar la regla no la infringe. Sin eso, pasar el
  guardia obligaría a borrar la explicación.
- Congela la lista de migraciones que mencionan la columna: una cuarta sale roja.
- Tiene test anti-vacío (la columna **sí** se lee) y test de existencia de los archivos censados,
  para que un renombrado no convierta el guardia en decorado.

**Límite honesto:** `ARCHIVOS_BACKEND` es una lista explícita. Un archivo de backend **nuevo**
añadido en el futuro no queda censado (el de UI sí: `app/(app)/monitoreo` se recorre recursivo).
Los tests de existencia atrapan renombrados, no altas. No es bloqueante para esta feature —el
árbol actual está completo— pero conviene saberlo antes de ampliarla.

## 3. R37 — ninguna migración ni índice · **VERIFICADO**

`git status db/ prisma/` vacío, y la guardia congela la lista de migraciones. Se respetó la
decisión explícita del humano de pagar el coste con caché en vez de índice.

## 4. R67/R68/R69 — aislamiento multi-inquilino · **VERIFICADO**

Es la frontera de seguridad real: Prisma conecta con credenciales de servicio, así que
`resolverAlcance` es la única separación entre inquilinos, y una caché mal claveada no rompe —
responde rápido y con datos de otro.

`tablero-dia-cache-aislamiento.guardia.test.ts` asserta **contenidos devueltos**, no aciertos de
caché; el propio archivo argumenta por qué (contar llamadas demuestra que la caché funciona, no
que aísla). Cubre: global vs zona con entrada caliente, dos zonas distintas, dos actores de la
MISMA zona compartiendo entrada (el aislamiento es por alcance, no por usuario, R68), y —lo más
importante— que un denegado sigue denegado **con una entrada caliente que cubriría su consulta**,
con espía que confirma que la caché ni se consulta (R69).

**Guardia preexistente ensanchada, correctamente:** `cache-aislamiento.guardia.test.ts` pasó de
autorizar un adaptador de `next/cache` a dos. Es exactamente +1, justificado por escrito, y el
test anti-vacío se extendió para recorrer ambos. No perdió fuerza.

## 5. Guardias debilitadas · **NINGUNA**

`git diff origin/dev -- tests/`: no se introdujo ni un `.skip`, `.only`, `.todo`, `xit` ni
`xdescribe`. Las únicas líneas eliminadas en tests preexistentes corresponden al ensanche
justificado de §4 y al alta del ítem "Monitoreo" en las listas de navegación esperadas.

Los guardias de la feature censan **el árbol y no el diff**, con la razón escrita en
`_arbol-de-la-feature.ts`: un guardia que mirase `git diff origin/dev` deja de proteger en cuanto
la rama se mergea y pasa a juzgar cualquier rama posterior. Es la lección correcta aplicada.

## 6. La ventana del día de Costa Rica · **VERIFICADO**

`lib/utils/ventana-dia-cr.ts` **no** usa `startOfDayCR` y documenta por qué: devuelve medianoche
UTC, seis horas antes del día real de CR, y produce la ventana 18:00–18:00 que arrastra
`RankingService` (ficha 166). Se apoya en `inicioDelDiaCREnUtc` / `inicioDelDiaSiguienteCREnUtc`
sin reimplementar desplazamientos. `now` es parámetro obligatorio sin default (R16), para que un
test no crea que controla el reloj cuando no lo hace.

## 7. Lo que bloquea la liberación (y no es de la feature)

`./init.sh` completo: **1012 archivos / 12.550 tests / 16 rojos**. Typecheck y lint verdes, suite
no degradada.

- **4 rojos = flakes por saturación.** Verdes en aislado (97 tests). `no-embalaje` expiró a los
  20 s recorriendo el árbol; no halló nada.
- **12 rojos = drift de la base local, preexistente.** Postgres devuelve `"… producto de prueba"`
  donde Node no. La migración `20260731160000_orden_busqueda_trgm` define `busqueda_texto` sobre
  cinco campos y **no** incluye producto; la columna viva sí. `prisma migrate status` dice "up to
  date" y no lo ve. No salió antes porque esos tests abren con `if (!fks) return;`: con `orden`
  vacía se reportan **passed** sin comprobar nada.

Inocencia de la rama, por construcción: toca 8 archivos, ninguno roza búsqueda, y no añade una
línea de SQL.

## 8. Pendientes

1. **Saldar el drift de `busqueda_texto`** recreando la columna generada desde su migración.
   Trabajo ajeno a esta feature; decisión del humano si se hace antes del PR o en ficha aparte.
2. **F4.1** — comprobación **a mano** del flujo. Los mocks ya no existen, pero eso lo firma
   una persona, no un grep.
3. **No verificado por mí:** el comportamiento en un navegador real (refresco de 30 s en vivo,
   enlace `?mensajero=` compartido). Los tests lo cubren con reloj falso y `MemoryRouter`.
