# Feature 125 — backfill histórico de `analytics_daily` · design

> Escrito el **2026-08-02** contra la 124 **entregada** (`origin/dev` @ `5314a2a8`). Toda
> afirmación sobre la 124 de este documento se verificó leyendo su código en `C:/w125`; donde se
> cita, se cita con archivo y línea.

## 1. Qué es esta feature, en una frase

Un **iterador de fechas** que llama al agregador de la 124 una vez por día CR de un rango explícito,
clasifica el resultado, lo reporta y lo deja verificable. No calcula ninguna medida.

## 2. El contrato que se consume (la 124)

```ts
// lib/interfaces/services/IAnaliticaRollupService.ts
interface IAnaliticaRollupService {
  agregarFecha(fecha: string): Promise<ResumenCorrida>; // fecha = 'YYYY-MM-DD' calendario CR
}
interface ResumenCorrida {
  readonly fecha: string;
  readonly filasEscritas: number;
  readonly filasRetiradas: number;
  readonly ms: number;   // medido con el reloj INYECTADO en el servicio de la 124
}
```

Propiedades que la 125 **da por buenas y no reimplementa** (verificadas):

| Propiedad | Dónde se sostiene |
|---|---|
| Idempotente | `AnaliticaRollupRepository.escribirFecha` (upsert `ON CONFLICT` por las 6 columnas del grano, líneas 428-457) + test de integración «dos corridas seguidas dejan el MISMO conjunto» (`analytics-daily-job.test.ts`, línea 775) |
| Todo-o-nada por fecha | `$transaction` única con `timeout: TIMEOUT_TX_ROLLUP_MS` (líneas 424-466) + test «un fallo a mitad de la escritura deja la fecha EXACTAMENTE como estaba» (línea 861) |
| Los cubos que dejan de existir desaparecen | `retirarFilasRancias`: `DELETE ... WHERE fecha = ? AND updated_at < marcaCorrida`, con `marcaCorrida = now()` de **Postgres** tomado al inicio de la transacción (líneas 426, 478-489) + test «filasRetiradas === 1» (línea 817) |
| Un día sin datos = éxito con 0 filas | `AnaliticaRollupService.componerFilas` filtra cubos vacíos (líneas 216-220) + test «el dia sin ordenes escribe CERO filas y no falla» (línea 78) |
| Reconciliación dentro de la transacción | `verificarReconciliacion` invocado tras el upsert y la retirada (líneas 459-461) |
| El resumen no lleva ids ni PII | `IAnaliticaRollupService.ts`, líneas 7-11 |

**Orden de llamadas de la 125, por corrida:**

1. `plan = planificarBackfill({ desde, hasta, ahora })` — puro, sin base. Falla el rango entero
   antes de abrir conexión (R7/R10).
2. Eco + confirmación (R27/R28). **Nada de lo anterior toca la base.**
3. Para cada `fecha` del plan, en orden ascendente:
   a. `resumen = await rollup.agregarFecha(fecha)`;
   b. clasificar (`no_comparable` si `fecha < HORIZONTE_HISTORIAL_CR`; si no, `procesada`, o
      `estable`/`cambiada` en modo verificar);
   c. emitir la línea de progreso con los cuatro campos del `ResumenCorrida` + la clasificación;
   d. acumular contadores (nunca el detalle de más de una fecha en memoria, R15);
   e. esperar `pausaMs` si `pausaMs > 0`.
4. Resumen final + escritura del reporte de corrida + código de salida.

**Qué se hace con `ResumenCorrida`**: es la **única** fuente de verdad observable de la 125. Se usa
para (a) la línea de progreso, (b) los acumuladores del resumen, (c) el reporte de corrida y (d) la
comparación del modo verificar. No se transforma ni se enriquece: lo que la 124 devuelve es lo que se
reporta.

## 3. Archivos nuevos y por qué viven ahí

| Archivo | Qué es | Por qué ahí |
|---|---|---|
| `lib/analytics/backfill-rango.ts` | **Puro**: `planificarBackfill(...)` → lista de fechas CR + clasificación por horizonte; `HORIZONTE_HISTORIAL_CR`. Sin Prisma, sin `process.env`, sin `console`. | Es el hermano de `rollup-dia.ts`: aritmética de día CR y nada más. El guardia de pureza (`tests/unit/analytics/modulo-puro.guardia.test.ts`, `CAPAS_PROHIBIDAS = ["db","repositories","services","actions"]`, línea 118) lo permite porque solo importa `lib/utils/fecha-cr`. |
| `lib/interfaces/services/IAnaliticaBackfillService.ts` | Tipos de entrada (`OpcionesBackfill`), de salida (`ResumenBackfill`, `LineaFecha`, `ClasificacionFecha`) y el puerto de salida de progreso. | Patrón del repo: el contrato vive en `lib/interfaces/`. |
| `lib/services/AnaliticaBackfillService.ts` | El iterador. Recibe `IAnaliticaRollupService`, reloj, `dormir` y salida de progreso por constructor. Sin Prisma. | Es orquestación de dominio; el guardia R18 de la 122 **no lo marca** (ver §4). |
| `scripts/backfill-analitica.ts` | CLI: zod, eco, confirmación, construcción de dependencias reales (`buildAnaliticaRollupService`), escritura del reporte, `process.exit`. | Patrón de `scripts/rollup-analitica-manual.ts`: guardas antes de abrir base, auto-ejecución solo como entrypoint (líneas 90-99). |
| `lib/config/analitica-rollup.ts` (**existente**, se amplía) | `FALLOS_CONSECUTIVOS_QUE_ABORTAN`. ~~Y, tras R35, el umbral medido~~ → **retirado con R34 a la ficha 174** (enmienda 2026-08-02). | R47 de la 124 exige un único sitio para los números del job. Añadir aquí no rompe su guardia (§4). La 125 **solo suma** una constante; **no sustituye ni retoca** `UMBRAL_AVISO_FILAS_CORRIDA`. |

Tests: `tests/unit/analytics/backfill-rango.test.ts`,
`tests/unit/services/analitica-backfill-service.test.ts`,
`tests/unit/scripts/backfill-analitica-cli.test.ts`,
`tests/unit/analytics/backfill-guards.test.ts`,
`tests/integration/db/analytics-daily-backfill.test.ts`.

## 4. Los cuatro guardias vigentes y por qué esta feature queda en verde

1. **122/R18 — `tests/unit/analytics/alcance-obligatorio.guardia.test.ts`.**
   `violacionDeAlcanceObligatorio` (líneas 95-101) solo marca a un archivo de
   `lib/{repositories,services,actions}` que **importe** algo de `lib/analytics/` **y** consulte una
   tabla de analítica sin nombrar `ConsultaAnalitica`. `AnaliticaBackfillService` importará
   `@/lib/analytics/backfill-rango` (contexto de analítica = sí) pero **no tiene ni una consulta**:
   `consultaTablaDeAnalitica` devuelve `null` y **la línea 99 (`if (!tabla) return null;`) es la que
   lo salva**. Ninguna exención nueva, ninguna edición de ese guardia.
2. **124/T5.2 — `tests/integration/db/analytics-daily-guards.test.ts`.** Nadie fuera de
   `MODULOS_ESCRITOR` (líneas 164-175) puede **nombrar en código** `analytics_daily`, y solo
   `AnaliticaRollupRepository` (`REPOSITORIO_ESCRITOR`, línea 180) puede accederla. Los archivos de
   la 125 **no nombran la tabla**; la mención en prosa está permitida porque el guardia despioja
   comentarios antes de buscar. `lib/config/analitica-rollup.ts` **ya está** en la lista, así que
   ampliarlo no la altera.
3. **124/T5.4 — `tests/unit/analytics/rollup-guards.test.ts`.** Vigila solo los diez módulos del
   escritor, así que los archivos nuevos no entran; **pero dos de sus casos recorren todo el árbol**:
   R47(b) prohíbe repetir la cifra del umbral en cualquier archivo, y R47(d) prohíbe declarar en
   ningún otro archivo una constante que case `(UMBRAL|LIMITE|MAX)…(FILAS|VOLUMEN|CUBOS)`
   (línea 812). De ahí el nombre `FALLOS_CONSECUTIVOS_QUE_ABORTAN` y de ahí que cualquier cifra de
   volumen de la 125 viva en `lib/config/analitica-rollup.ts`.

   > **Enmienda 2026-08-02 — los TRES anclajes de `UMBRAL_AVISO_FILAS_CORRIDA` (verificados en este
   > worktree, `C:/w125`).** El diseño original contaba **dos** puntos que habría que tocar para
   > cambiar el valor; son **tres**, y esa es la razón de que R34 se haya ido a la ficha **174** en
   > vez de resolverse aquí:
   >
   > 1. **La declaración.** `lib/config/analitica-rollup.ts:16` (`export const
   >    UMBRAL_AVISO_FILAS_CORRIDA = 20000;`) y su comentario, **líneas 1-15**, que dice literalmente
   >    «PROVISIONAL Y NO MEDIDA» (línea 8) y anuncia que «la feature 125 fijará los umbrales de
   >    verdad» (línea 6).
   > 2. **El guardia de cifra única.** `tests/unit/analytics/rollup-guards.test.ts`: el allowlist
   >    `AJENAS_A_R47`, **líneas 681-684** (dos entradas de una ocurrencia cada una, admitidas solo si
   >    la línea habla de `timeout`), **y además** la aserción del caso «(a) el comentario declara que
   >    la cifra es PROVISIONAL y NO MEDIDA (D9)», **líneas 710-738**, que exige que la prosa case
   >    `/provisional/i` **y** `/\bno\s+(?:est[aá]\s+|esta\s+)?medid[ao]\b/i`. Lo primero es un
   >    allowlist (R33 lo autoriza); **lo segundo es una aserción de otra feature (R33 NO lo
   >    autoriza)**.
   > 3. **El test de servicio de la 124 — el anclaje que la spec no documentaba.**
   >    `tests/unit/analytics/rollup-service.test.ts:1047` construye
   >    `new RegExp(\`\\b${UMBRAL_AVISO_FILAS_CORRIDA}\\b|\\b20_000\\b\`)`: el `20_000` está
   >    **tecleado a mano**, así que sobrevive al cambio de la constante y sigue buscando el valor
   >    viejo por todo `lib/`. Y el mismo archivo ancla la prosa otra vez en la **línea 1072**
   >    (`expect(config).toMatch(/PROVISIONAL Y NO MEDIDA/i)`), dentro del caso «la constante esta
   >    declarada como provisional y no medida» (líneas 1070-1073).
   >
   > Es decir: **tres archivos y cuatro puntos de edición**, dos de ellos aserciones ajenas. Cambiar
   > la cifra desde la 125 era más caro de lo que el diseño creía y, sobre todo, **prohibido por
   > R33**. Nota aparte: `tests/unit/analytics/backfill-guards.test.ts:359` —guardia **propio** de la
   > 125— solo comprueba que la **declaración exista** (`/export\s+const\s+UMBRAL_AVISO_FILAS_CORRIDA\b/`),
   > no su valor ni su prosa, así que **no** se opone a un cambio futuro de la cifra.
4. **135/R1 — pureza de `lib/analytics/`.** `backfill-rango.ts` no importa `db`, `repositories`,
   `services` ni `actions`, no lee `process.env`, no imprime al importarse y exporta algo.

## 5. Qué pasa cuando `agregarFecha` lanza a mitad de un rango de 200 días

**Decisión: CONTINUAR y REPORTAR, sin reintento automático, con corte por fallos consecutivos.**

- **Continuar** (no abortar al primer fallo) porque la unidad de atomicidad es **la fecha**, no el
  rango: la transacción de la 124 garantiza que la fecha fallida quedó **exactamente como estaba**
  (test «un fallo a mitad de la escritura…», línea 861). Abortar el rango entero castiga 199 fechas
  sanas por una enferma y obliga al operador a recalcular a mano por dónde iba.
- **Sin reintento automático** porque `agregarFecha` no distingue el fallo transitorio del
  estructural: `AnaliticaRollupError` envuelve cualquier causa con su etapa
  (`IAnaliticaRollupService.ts`, líneas 22-47), y `ReconciliacionError` y
  `PrimerIntentoIncoherenteError` **no son transitorios en absoluto** — significan «los datos de ese
  día no cuadran». Reintentarlos es gastar tiempo para volver a fallar y, peor, un reintento que
  acierte a la segunda **oculta** una carrera con la escritura de dominio que merece verse. Como la
  operación es idempotente, reintentar es trivial para el humano: volver a correr el backfill sobre
  las fechas fallidas que el resumen nombra.
- **Corte por fallos consecutivos** (`FALLOS_CONSECUTIVOS_QUE_ABORTAN`, propuesto 3) porque
  «continuar siempre» tiene un modo de fallo feo: si la base se cae o la `DATABASE_URL` es errónea,
  el script recorrería 200 fechas fallando 200 veces, tardando y llenando el log. Tres fallos
  seguidos ya no son «un día raro», son el entorno. El corte dice cuántas fechas quedaron sin
  procesar y sale con código ≠ 0.
- **Código de salida**: cualquier fecha fallida ⇒ ≠ 0. Nunca «éxito parcial silencioso».

*Alternativa descartada — reanudación con checkpoint persistido* («guarda la última fecha buena y
retoma»): añade estado que puede desincronizarse de la base y no hace falta: la idempotencia hace que
**re-correr el rango entero** sea equivalente a reanudar, y el reporte de corrida ya dice qué fechas
fallaron.

## 6. Modo `--verificar`

Responde a «¿lo que hay escrito sigue siendo lo que la fuente viva produce?».

- **Cómo**: segunda pasada sobre el mismo rango, comparando el `ResumenCorrida` de cada fecha contra
  el del reporte de la corrida de escritura (`--contra <reporte.json>`, obligatorio).
- **Regla de clasificación**: `estable` ⇔ `filasRetiradas === 0` **y** `filasEscritas` igual a la del
  reporte previo. Si `filasRetiradas > 0`, algún cubo dejó de existir; si `filasEscritas` cambió, el
  conjunto de cubos cambió. Cualquiera de las dos ⇒ `cambiada`.
- **`--verificar` ESCRIBE.** No hay forma de recomputar sin escribir con el contrato de la 124, y no
  se va a añadir una: sería un segundo camino de cálculo, justo lo que D1 evita. Como la escritura es
  idempotente, el efecto sobre una base estable es nulo salvo `updated_at`. Se dice en el eco (R26) y
  se dice aquí.
- **Por qué el reporte previo es obligatorio (y no «dos pasadas seguidas en la misma invocación»)**:
  sin línea base, una fecha **nunca escrita** daría `filasRetiradas === 0` y se leería como
  `estable`. Exigir el reporte convierte «no comparable con nada» en un error explícito (R24) en vez
  de en un falso verde.

## 7. Contratos de entrada/salida del CLI

```
tsx scripts/backfill-analitica.ts --desde YYYY-MM-DD --hasta YYYY-MM-DD
     [--reporte <ruta>] [--pausa-ms N] [--confirmar "<desde>..<hasta>"]
     [--verificar --contra <ruta>] [--verboso]
```

- **Sin `--confirmar`**: imprime eco + plan, **no invoca el agregador**, sale 0.
- **Con `--confirmar`**: el valor debe ser literalmente `"<desde>..<hasta>"`; si no coincide con el
  eco, aborta con ≠ 0 sin invocar nada.
- **Eco** (antes de la primera invocación): `host:puerto/base` (**sin** usuario ni contraseña,
  reconstruido con `new URL(DATABASE_URL)` como hace `esDestinoLocalOrdenex`, líneas 31-41 del script
  de la 124), modo, rango, nº de fechas y nº de no comparables.
- **Progreso**, una línea por fecha:
  `2026-07-20  filasEscritas=18 filasRetiradas=0 ms=940 [procesada]`
- **Reporte de corrida** (JSON: cabecera con rango, modo e instante + una entrada por fecha con
  `fecha`, `filasEscritas`, `filasRetiradas`, `ms`, `clasificacion`). Sin ids. Es a la vez la
  evidencia de R35 y la línea base de `--verificar`.
- **Códigos de salida**: `0` todo bien; `1` argumentos/confirmación/reporte inválidos (nada se
  invocó); `2` la corrida terminó con fechas fallidas o cambiadas.

## 8. Modelo de datos

**Ninguno.** No hay migración, no hay cambio de `db/schema.prisma`, no hay RLS que tocar:
`analytics_daily` es contrato de la 123 y su único escritor es el repositorio de la 124. El backfill
no añade ni una columna, ni siquiera para marcar «fecha no comparable» (ver L4 de `requirements.md`).

## 9. Seguridad y operación

- **Producción es un destino legítimo** (D8), así que **no** se copia la guarda de host de
  `scripts/rollup-analitica-manual.ts` (líneas 65-74), que aborta fuera de `localhost:5432/ordenex`.
  Lo que se copia es su forma: guardas **antes** de construir el cliente Prisma, `console.error` +
  `process.exit(1)`, y cero lógica de agregación en el script.
- **Lo que contiene el modo de fallo humano** (recomputar el rango equivocado) es el par eco +
  reintroducción literal del rango (R27/R28), no una lista blanca de hosts.
- **Salida sin ids**: el material ya viene sin PII; el único vector es el mensaje de
  `PrimerIntentoIncoherenteError`, que incluye la clave del cubo (`IAnaliticaRollupService.ts`,
  líneas 55-67). Por defecto se imprime `fecha + nombre del error + etapa`; con `--verboso`, el error
  completo.

## 10. Alternativas descartadas

**A1 — Que la 125 defina el agregador y la 124 lo consuma** (era la decisión D1 de la spec del
2026-08-01). **Descartada**: la 124 está entregada y mergeada; reescribir su agregador aquí crearía
dos definiciones de las diez medidas capaces de divergir en silencio y dejaría muertos diez módulos
con sus guardias, sus tests de integración y su exención nominal en el guardia de la 122.

**A2 — Escritura por fecha con `DELETE WHERE fecha = ?` + `INSERT`** (era D2 del 2026-08-01).
**Descartada**: la 124 ya lo resuelve con upsert + retirada de rancias en la misma transacción
(verificado, §2), y el `DELETE` masivo paga un coste que la solución de la 124 no paga: deja el día
**vacío** para cualquier lector concurrente mientras dura la transacción. Además exigiría un segundo
escritor de `analytics_daily`, que el guardia de frontera prohíbe con nombre y apellido
(`REPOSITORIO_ESCRITOR`, línea 180).

**A3 — Diff por cubo en `--verificar`, leyendo `analytics_daily`.** **Descartada**: exige un lector
del rollup, y el guardia de la 124 prohíbe **cualquier** lectura de la tabla fuera de
`sumarMedidasEscritasDeFecha` (`LECTURAS`, líneas 217-221). Comprarlo aquí sería abrir por la mala la
frontera que la 126 va a abrir bien, con `ConsultaAnalitica` y recorte por rol. Coste aceptado: la
verificación es por día (L2).

**A4 — Añadir un rango a `scripts/rollup-analitica-manual.ts`.** **Descartada**: ese script tiene dos
guardas deliberadas —solo hoy/ayer y solo `localhost`— y su cabecera remite explícitamente al
backfill de la 125 (líneas 53-63). Ensancharlo convertiría la invocación manual en «la 125 por la
puerta de atrás», que es exactamente lo que R35/R39 de la 124 prohíben.

**A5 — Una sola transacción para todo el rango.** **Descartada**: contradice D9 de la 124 (una
transacción por fecha, sin lotes) y `TIMEOUT_TX_ROLLUP_MS = 120_000` está dimensionado para **una**
fecha. Un rango de 200 días en una transacción reventaría el timeout y, al abortar, tiraría 199
fechas correctas.

**A6 — Seudonimizador de ids para el reporte.** **Descartada**: no hay ids que seudonimizar
(`ResumenCorrida` no los lleva). Un mapa de seudónimos sería código muerto que aparenta una
protección que no protege nada; D9 se cumple por R30 (ver L3).

**A8 — Cumplir R34 aquí, ensanchando R33 para poder editar las aserciones ajenas.** *(Alternativa
evaluada y descartada en la enmienda del 2026-08-02.)* Era la salida «obvia» al choque R33/R34:
ampliar R33 de «puedo tocar el archivo de config y el allowlist» a «puedo tocar también las
aserciones del guardia de la 124». **Descartada por dos razones independientes.** (a) *El permiso es
desproporcionado*: R33 existe precisamente para que la 125 no pueda reescribir los tests que la
vigilan; convertirlo en licencia para editar aserciones ajenas destruye la garantía completa, y las
aserciones a tocar son **dos** en **dos archivos** distintos (§4, anclajes 2 y 3), no un retoque
puntual. (b) *No hay nada que comprar con ese permiso*: la corrida real midió 58 órdenes con pico de
**24 filas en una fecha** (`progress/backfill_125.md`, T7.5); pasar de ahí a un umbral de producción
exige un multiplicador inventado, que **D5 prohíbe**. Habríamos abierto el guardia para escribir un
número igual de infundado que el actual, y encima **sin** el comentario que hoy avisa de que no está
medido. **Elegido en su lugar:** R33 intacto, R34 retirado a la ficha **174**, la cifra sigue
declarándose provisional y no medida (L7 de `requirements.md`). Coste aceptado: la 125 no entrega el
umbral que su propia D5 prometía «después de medir»; queda como deuda con dueño.

**A7 — Lock compartido con el job diario de la 124.** **Descartada** por D3: prohibir el día en curso
es más barato y no ata la 125 a infraestructura de coordinación que hoy no existe. Coste aceptado: el
día de hoy no se puede corregir hasta mañana.

## 11. Riesgos declarados

- **El horizonte 2026-07-13 anula las fechas anteriores por completo** (L1 de `requirements.md`), no
  solo el embudo. Un operador que corra el backfill «desde el principio» verá muchas fechas
  terminando en éxito con cero filas: por eso la clasificación `no_comparable` es obligatoria y no
  cosmética.
- **La penumbra posterior al horizonte no está medida**: órdenes preexistentes que nunca volvieron a
  transicionar siguen invisibles después del 2026-07-13. Esta feature no la mide y no la corrige.
- ~~**El umbral de volumen sigue siendo provisional hasta R35.** Cambiarlo pone rojo el allowlist
  `AJENAS_A_R47` del guardia de cifra única; está previsto en T6 y no es un imprevisto.~~
  **Reescrito en la enmienda del 2026-08-02:** el umbral **sigue provisional al cerrar la 125 y no se
  cambia** (R34 retirado a la ficha 174; ver L7 de `requirements.md` y A8 arriba). Y el riesgo estaba
  **mal dimensionado**: cambiar la cifra no rompe solo el allowlist, rompe **tres anclajes en tres
  archivos**, dos de ellos aserciones de guardias ajenos (§4). Era exactamente el imprevisto que la
  línea decía que no era.
