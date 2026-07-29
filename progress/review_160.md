# Review — Feature 160 (intentos de entrega: criterio, escalado y dato en la orden)

**Rama:** `feature/160-columna-intentos` (HEAD `d435202`, sale de `origin/dev`).
**Worktree:** `R:/job/singularis/projects/ordenex-wt-160-spec`.
**Fecha:** 2026-07-29. **Revisor:** reviewer (no editó código; las mutaciones de §4
se revirtieron y el árbol quedó limpio).

**VEREDICTO: APROBADO-CON-NOTAS.**
Cero defectos encontrados. **1 condición bloqueante de MERGE/DESPLIEGUE** (§3), que
**no es trabajo del implementer** y no puede ejecutarse desde este worktree.

---

## 1. Verificación ejecutable — números reales

`./init.sh` completo, corrido por mí tras `pnpm db:generate`. Salida real:

```
✓ regla max-2-por-zona respetada (in_progress=2)
✓ specs presentes para features sdd en vuelo
-> pnpm run typecheck        ✓ 0 errores
-> pnpm run lint             ✖ 10 problems (0 errors, 10 warnings)  ✓ lint paso
-> pnpm run test
 Test Files  548 passed (548)
      Tests  5828 passed (5828)
   Duration  140.74s
✓ todas las migraciones tienen down.sql
== init OK ==     (exit 0)
```

**Cuadra exacto con la referencia declarada: 548 / 5828 / 0 fallos.**
Las 10 warnings son preexistentes: verifiqué la única que cae en un archivo tocado
(`tests/components/MisAsignacionesModule.test.tsx:136 ordenCardsEnReparto`) y está en
`origin/dev` en la MISMA línea, sin tocar por el diff de la 160. La bitácora dice la
verdad.

`git status --porcelain` → **vacío** (comprobado antes y después de mis mutaciones;
este archivo de review es lo único que queda por versionar).

---

## 2. Checklist de CHECKPOINTS.md

### Especificación
- [x] `requirements.md` con EARS numerados R1–R32.
- [x] `design.md` con alternativas descartadas (§7.4 columna materializada, §7.6 chip).
- [~] `tasks.md`: 25 de 26 en `[x]`. **T24.1 sigue `[ ]`** — es la re-medición contra
      producción, explícitamente "inmediatamente antes de desplegar" y asignada al
      leader. Desviación formal del checkpoint; ver §3.

### Trazabilidad
- [x] **Los 32 requisitos mapean a un test real. Verificado uno a uno por mí** (§5).
- [x] El mapa `R → test` está en `requirements.md` y en las dos bitácoras.

### Calidad de código
- [x] typecheck 0 errores · lint 0 errores · `pnpm test` verde.
- [~] E2E para flujo crítico: **el repo SÍ tiene harness Playwright** (`e2e/`, 18
      specs, incl. `reintentos-escalado.spec.ts` e `historial-orden.spec.ts`).
      **Ninguno se corrió, y la rama NUEVA del escalado no tiene cobertura E2E.**
      Ver §3 y §10.

### Datos y seguridad
- [x] Sin tablas nuevas → RLS N/A. `git diff --name-only origin/dev...HEAD -- db/`
      **vacío**, verificado por mí. Enum `ORDEN_HISTORIAL_ORIGEN_TIPO_SEED`: solo
      cambian COMENTARIOS, ningún valor (verificado en el diff).
- [x] Sin migraciones nuevas → down.sql N/A.
- [x] Sin secretos. Sin `.env` en el diff. Sin webhooks nuevos.

### Patrón de capas
- [x] Repository solo Prisma (`whereIntentosVigentes` es construcción de query pura).
- [x] Services sin HTTP. Interfaces en `lib/interfaces/` por categoría.
- [~] `listarLiberadasHoy` mergea en la Server Action, no en un service (D1 del
      backend). Justificado y verificado: `LiberacionReprogramadaService` es el
      servicio del CRON y no tiene método de listado. El criterio sigue íntegro en
      `OrdenHistorialService`; el borde solo hace `?? 0` sobre un Map. Aceptable.

### Permisos / multi-país
- [x] R15: cada lote se pide sobre filas YA acotadas por el `where` del rol. Sin regla
      de permisos nueva. Sin hardcode de país/moneda/cuenta.

### Verificación final
- [x] `./init.sh` verde. [x] este archivo. [ ] `progress/history.md` sin entrada de 160
      todavía (tarea del leader al mergear).

---

## 3. Condición BLOQUEANTE de merge/despliegue

### B1 — Nada de esta feature se ha ejecutado nunca contra un Postgres real

No es una objeción de calidad: es una verificación exigida que falta, con un modo de
fallo severo que **ningún gate del repo puede detectar**.

- `contarIntentosVigentesEnLote` emite un `groupBy({ by: ["ordenId"] })` cuyo `where`
  lleva un **filtro de relación anidado** (`gestion: { anuladaAt: null }`) dentro de
  `AND[1].OR[1]`. Esa combinación **nunca se ejecutó contra Postgres**. El backend lo
  declara él mismo (`impl_160_backend.md §6.3`): *"eso no es prueba de que funcione en
  la base. Es lo primero que hay que mirar si el listado falla en preview"*.
- Comprobé que el repo **no tiene ningún harness que pueda cogerlo**:
  `tests/integration/db/` es cobertura ESTÁTICA (lee `migration.sql` por regex, sin
  Postgres); todo lo demás usa dobles.
- Si Prisma rechaza ese `where` en `groupBy`, **revienta en runtime TODA lectura
  paginada de las 13 superficies**, `/ordenes` incluido, para todos los roles. Es caída
  de pantalla principal, no un conteo mal.
- Tampoco se corrió `EXPLAIN`: la conclusión de que el `@@index([ordenId,
  estatusDestinoId])` sigue sirviendo es razonamiento del diseño, no medición. **No lo
  doy por bueno ni por malo: está sin medir.**
- **T24.1 sigue sin ejecutar.** La medición de radio de impacto (0 órdenes que saltan
  el umbral) es del 2026-07-29 y es una FOTO; el conteo se recalcula al vuelo. La
  propia task obliga a re-correrla y a **DETENER el despliegue si da > 0**.

**Qué falta para cumplirla** (una sola sesión contra la base de preview, que ya es
propia y no comparte con producción):

1. Cargar `/ordenes` paginada y descargar un manifiesto contra Postgres real → prueba
   que el `groupBy` y el `?? 0` funcionan de verdad.
2. `EXPLAIN ANALYZE` del `groupBy` con `orden_id IN (...)` sobre datos de volumen.
3. Re-correr la consulta de `design.md §4.3` contra producción (T24.1) y anotar
   resultado + fecha + entorno. **Si "saltarían el umbral" > 0, se detiene.**

**No devuelvo la feature al implementer**: no hay nada que arreglar en el código y no
tiene acceso a una base desde el worktree. B1 es un gate del leader, previo al merge.
**Mergear sin ejecutarlo no queda autorizado por esta revisión.**

---

## 4. Mutaciones propias sobre el criterio — 7 aplicadas, 7 muertas

No me fié de los mapas. Apliqué cada mutación al código real, corrí las suites
afectadas y revertí (`git status --porcelain` vacío al terminar).

| # | Mutación | Resultado |
| --- | --- | --- |
| M1 | `ORIGEN_TIPOS_REPROGRAMADA_INTENTO += "reprogramacion_tienda"` (contar #22) | **ROJO — 10 tests**, incl. *"1 devuelta + 2 reprogramaciones de la TIENDA → el drawer muestra 1 y el cron LIBERA"* |
| M2 | Quitar `"gestion"` de la lista (excluir #13) | **ROJO — 10 tests**, incl. *"el drawer muestra 3 y el cron ESCALA"* |
| M3a | `valorIntentos`: quitar el `?? 0` | **ROJO — 9 tests en 6 archivos**: la pieza compartida **y** 5 superficies por separado |
| M3b | Quitar el `?? 0` en `OrdenService` y `ManifiestoService` | **ROJO — 2 tests**, incl. *"emite `0`, no `null` ni celda vacia"* |
| M4 | Desalinear el criterio del cron/drawer respecto al del lote (`reprogramadaId: null` solo en el individual) | **ROJO — 7 tests**, incl. *"R4: individual y lote reciben EXACTAMENTE el mismo criterio"* |
| M5 | Que el LOTE se construya su propio `where` (drift por copia-pega en el repositorio) | **ROJO — 5 tests** |
| M6 | (adversarial) Intercambiar `devueltaId`/`reprogramadaId` en `resolverCriterio` — haría contar #22 sin tocar ninguna lista | **ROJO — 9 tests** |
| M7 | (R12) Convertir el lote en N+1: una llamada por fila en `OrdenService.listar` | **ROJO — 2 tests**, incl. el de lote vacío |

**Ninguna mutación pasó.** Las que tocan dinero no mueren por una aserción de forma:
mueren por el DESENLACE (`el cron LIBERA` / `el cron ESCALA`).

### El test de criterio único NO es una ilusión — verificado

`tests/unit/services/intentos-entrega-criterio-unico.test.ts` monta el
`OrdenHistorialRepository` REAL sobre `prismaHistorialSobreFilas()`
(`tests/fixtures/intentos-entrega.ts:92`). Leí el doble línea a línea: **evalúa de
verdad el `where`**, no devuelve un número prefijado. `count` y `groupBy` filtran las
filas con `filaCasaIntento()`, un mini-intérprete que recorre `where.AND[0].OR`
(destinos, con `origenTipo.in`) y `where.AND[1].OR` (vigencia). M5 y M6 lo confirman
empíricamente: cambiar el predicado cambia el número que devuelve.

### El `notIn`: el backend NO exagera

`orden-historial-repository.test.ts:226` asserta
`expect(JSON.stringify(ramaDestinos.OR)).not.toContain("notIn")` **acotado a la rama de
DESTINOS**, no al `where` entero. Correcto: el `notIn` de `ORIGEN_TIPOS_CON_GESTION` en
la rama de VIGENCIA es legítimo y preexistente (feature 67) y tiene su propia aserción
de forma exacta (`:255-261`). La afirmación de la bitácora ("no hay ningún `notIn` en
la rama de destinos") es literalmente cierta.

**Intenté romperlo y no pude:** la rama B es `toEqual` exacto, así que cualquier
reescritura a lista negra rompe; añadir una familia a la lista blanca también rompe
(`toEqual(["gestion"])`); añadir una tercera rama de destino rompe. En Prisma las
claves de nivel superior se ANDean, así que no hay forma de AMPLIAR el conteo por fuera
de `AND` sin tocar lo que está fijado.

### #13 incluido y #22 excluido — confirmado en los tres niveles

1. **Declaración:** `ORIGEN_TIPOS_REPROGRAMADA_INTENTO = ["gestion"]`, por INCLUSIÓN.
2. **Mapa:** el test asserta que hay EXACTAMENTE 2 aristas a `reprogramada` (#13
   `gestion`, #22 `reprogramacion_tienda`) y que `reprogramada + gestion` identifica
   UNA sola, la #13.
3. **Semántica:** el predicado evaluado sobre filas da 1 (no 2) para
   `devuelta + reprogramacion_tienda`, y el cron LIBERA en vez de escalar.

---

## 5. Trazabilidad R1–R32 — verificada por mí, 32/32

Recorrí cada requisito hasta un test concreto y comprobé que el test **verifica algo**
(no está vacío ni es tautológico). **Ningún R queda sin dueño.**

| R | Verificado | Nota del revisor |
| --- | --- | --- |
| R1 | ✔ | forma exacta del OR + semántica sobre filas + mapa de la 140. M1/M2 lo matan |
| R2 | ✔ | 5 tests en 4 archivos; el desenlace de dinero incluido |
| R3 | ✔ | `incidente` fuera del criterio; test CONDICIONAL sobre el catálogo, honesto: la 154 no está en esta rama (D2 backend). `indemnizada` asertado como inexistente |
| R4 | ✔ | la suite de criterio único, **no es ilusión** (§4). M4/M5/M6 |
| R5 | ✔ | anulada y huérfana en AMBAS ramas; `ajuste_estado` sigue contando |
| R6 | ✔ | sin `devuelta` → 0 sin consultar; sin `reprogramada` → solo rama A |
| R7 | ✔ | **verificado por mí**: `db/` vacío, enum sin cambios de valor, sin migración |
| R8 | ✔ | "ESCALA (antes liberaba)" + el extremo a extremo del drawer+cron |
| R9 | ✔ | `wrong_number`/`wrong_address` directos sin consultar; resto del cron sin cambios de aserción |
| R10 | ✔ | drawer = cron = lote |
| R11 | ✔ | un test por cada uno de los 7 puntos de merge; comprobé que los 7 archivos existen |
| R12 | ✔ | 1 `groupBy` en el repo + 1 llamada por listado en cada servicio. M7 |
| R13 | ✔ | 0 consultas con lote vacío, en repo, service y por servicio |
| R14 | ✔ | `0` explícito, no `undefined`. M3b |
| R15 | ✔ | alcance por rol/zona/tienda + "un rol no autorizado ni llega al derivador" |
| R16 | ✔ | guardas de tipo + typecheck verde con fixtures preexistentes sin el campo |
| R17 | ✔ | incluye *"el numero NO se incrusta en la celda de estado"* — la anti-chip |
| R18 | ✔ | pieza compartida + 9 superficies |
| R19 | ✔ | **el caso `0` está cubierto por duplicado de verdad** (§6). M3a |
| R20 | ✔ | guarda de FUENTE sobre el módulo + "de N" ausente en 5 superficies |
| R21 | ✔ | índice 3 fijo, 18 ids/encabezados/orden pinneados, y **verifiqué en el diff que los 3 asserts preexistentes de `ordenes-columns.test.tsx` NO se tocaron** |
| R22 | ✔ | las 3 variantes heredan + 4 suites de página |
| R23 | ✔ | 4 diálogos `<ul>` + `GenerarGuiaModal` (columna) + `EtiquetasGuiaModal` (ausencia) |
| R24 | ✔ | card POS, detalle `<dt>/<dd>`, "por recoger" |
| R25 | ✔ | 3 tablas + 2 grupos de cards |
| R26 | ✔ | novedades y rechazadas por plazo |
| R27 | ✔ | los DOS montajes del aviso |
| R28 | ✔ | `intentos` tras `monto`; ninguna aserción de "exactamente N columnas" sobrevive; derogación de la 148 anotada y fechada en su `requirements.md` |
| R29 | ✔ | `sortBy` por lista blanca y `filter` por `.strict()` |
| R30 | ✔ | tipos + render + **guarda de fuente sobre los 4 archivos excluidos**, con un test que avisa si se renombran |
| R31 | ✔ | OpenAPI serializada no contiene "intentos" + guardas de tipo |
| R32 | ✔ | suites completas verdes; los 5 cambios de aserción auditados en §6 |

---

## 6. Los dos puntos que más fácil se rompen sin que nadie se entere

### 6.1 El caso `0` — la cobertura por duplicado es REAL

Comprobé las **13 llamadas** a la pieza compartida en `app/` y `components/`: las 13
pasan por `valorIntentos(row)`, la única regla `?? 0`. No hay ni un call-site que lea
`row.intentosEntrega` directo.

La mutación M3a (quitar el `?? 0`) puso **9 tests en rojo repartidos en 6 archivos**:
la pieza compartida, `ordenes-columns`, `AsignarBodegaModal`, `BodegaLiberadasHoy`,
`MisAsignacionesModule`, `NovedadesModule`, `RecepcionSateliteModule`. Es decir: la
duplicación no es retórica, **cada capa mata la mutación por su cuenta**. Y el caso
"el campo no viaja" está explícito en casi todas las superficies
(*"R19: sin el campo (DTO viejo) …"*).

Nota de rigor: las superficies fuertes asertan con regex anclada (`/^0$/`); ver m3.

### 6.2 Las 5 aserciones preexistentes cambiadas — auditadas una a una

**Las 5 son forzosas y ninguna perdió poder de discriminación. Una lo ganó.**

1. `OrdenesPage.test.tsx` · lista exacta de cabeceras → sigue siendo `toEqual` sobre la
   lista completa y ordenada; solo entra `"Intentos"` tras `"Estado"`. **Forzoso** (la
   columna existe). **Sin pérdida.**
2. `OrdenesPage.test.tsx` · índices de celda `c1[3]→c1[4]` (destinatario) y
   `c1[6]/c3[6]→c1[7]/c3[7]` (tienda). Mismo contenido asertado, una posición más allá.
   **Forzoso** por insertar en medio. **Sin pérdida**, y además **añadieron**
   `expect(c1[3]).toHaveTextContent("0")`: es una aserción NUEVA, no un relajamiento.
   **Gana poder.**
3. `OrdenesPage.test.tsx` · cabeceras del estado vacío 19 → 20. Sigue siendo un conteo
   exacto. **Forzoso. Sin pérdida.**
4. `AdminTiendaDashboard.test.tsx` · lista exacta de cabeceras del dashboard; entra
   `"Intentos"`. Sigue `toEqual` completo. **Forzoso. Sin pérdida.**
5. `OrdenesModuleReuse.test.tsx` · 17 → 18 columnas del adminTienda. Conteo exacto
   intacto **y** sobrevive el assert hermano `some(c => c.id === "tienda") === false`,
   que es el que realmente discrimina esa variante. **Forzoso. Sin pérdida.**
6. `RecepcionSateliteModule.test.tsx` · lista exacta de cabeceras de "Recibidas".
   `toEqual` completo. **Forzoso. Sin pérdida.**

**Ninguna se relajó de `toEqual` a `toMatchObject`, ninguna cambió una lista exacta por
un `toContain`, ninguna borró un assert.** Ninguna regresión disfrazada de ajuste.

Cambio no-aserción: `renderModule` gana `liberadasHoy={props?.liberadasHoy ?? []}`.
Verifiqué que `RecepcionSateliteModule` ya tenía `liberadasHoy = []` por defecto
(`:181`), así que pasar `[]` es idéntico a no pasar nada. **Inocuo**, y destapa un
montaje que estaba sin cubrir.

---

## 7. Las tres discrepancias del frontend — juicio

**D1 · `GenerarGuiaModal` es `DataTable`, no `<ul>` → recibió COLUMNA. LECTURA
CORRECTA.** Verificado en el código: importa `DataTable`, define `columns` y
`noGamColumns` y monta dos `<DataTable>`; **no hay un solo `<li>`**. R17/R18 se deciden
por FORMA de presentación, no por superficie, y el propio `design.md` lo dice al hablar
de `/novedades`. Meter un dato etiquetado en una celda habría sido exactamente el
"marcador incrustado" que R17 prohíbe. **No es un atajo.**

**D2 · En `EtiquetasGuiaModal`, R30 gana a R23, y se asertó la ausencia. LECTURA
CORRECTA.** Verificado: el diálogo **no lista las órdenes seleccionadas**; renderiza
`etiquetas.map(...)` → `<EtiquetaGuia>`, la vista previa del documento físico, más un
aviso de omitidas. Lo único "por orden" que se ve ahí es la etiqueta, que R30 deja
fuera por decisión (QA4). Además `EtiquetaGuiaDTO` no declara el campo. **Fijar la
ausencia con un test es mejor que declararla.** No es un atajo.

**D3 · Nombre kebab-case del módulo. ATAJO MENOR, y la justificación está inflada.**
`docs/conventions.md:9` dice literalmente *"Componentes React: `PascalCase.tsx`"*, y
`components/shared/` tiene **23 archivos `.tsx`, los 23 en PascalCase**;
`intentos-entrega.tsx` es el único kebab-case del directorio. El precedente que cita la
bitácora (`ordenes-columns.tsx`, `recibidas-columns.tsx`) vive en `app/**/_components/`,
**no en `components/shared/`**, así que no aplica aquí. Dicho eso: el módulo exporta
componentes React *y* una fábrica de columnas, `tasks.md` T15 fijó la ruta literal, y la
propia bitácora lo declaró y ofreció el `git mv`. **Menor** (m2), no bloqueante.

---

## 8. Alcance

- **Sin migración:** `git diff --name-only origin/dev...HEAD -- db/` **vacío**
  (verificado por mí). Tampoco hay cambios en `.env*`, `app/api/` ni `lib/api/`.
- **Sin cruce de fases:** el diff del frontend no toca `lib/services`,
  `lib/repositories`, `lib/actions` ni `db/`; el del backend no toca `app/` ni
  `components/` (solo 2 `.tsx` de TEST, forzados por el DTO no-opcional del
  manifiesto). Ambas bitácoras lo declaran y el diff lo confirma.
- **`git status --porcelain` vacío.** Ningún residuo local que ponga los guards de
  `fs.readdir` en rojo.

---

## 9. Hallazgos menores (ninguno bloqueante)

- **m1 · La rama A no está pinneada como la rama B.** El criterio es por inclusión en la
  rama `reprogramada`, pero la rama `devuelta` admite CUALQUIER `origen_tipo` (es el
  comportamiento histórico, decisión documentada en `design §1.4`). El test `R1a` usa
  `toBeGreaterThanOrEqual(1)` + `toContain`, mientras que las aristas a `reprogramada`
  sí están fijadas con `toHaveLength(2)`. Mitigado de verdad por el guard de la feature
  140 (*"el mapa declara exactamente las aristas del inventario, ni una más"*, 43
  aristas cerradas): una arista nueva a `devuelta` exige tocar el inventario y pasa por
  revisión humana. Residual: **ningún test de la 160 se pondría rojo para avisar a esa
  persona de que acaba de hacer que algo cuente como intento y cobre antes.** Cierre
  barato: pinnear el conjunto de aristas a `devuelta` igual que el de `reprogramada`.
- **m2 · `components/shared/intentos-entrega.tsx`** rompe `docs/conventions.md:9`; es el
  único kebab-case entre 23 `.tsx` del directorio (ver §7·D3). `git mv` + 8 imports.
- **m3 · La aserción `0` más nueva es la más débil.** `OrdenesPage.test.tsx`
  `expect(c1[3]).toHaveTextContent("0")` hace match por SUBCADENA (una celda con "10"
  también pasaría). El resto de la familia R19 usa regex anclada (`/^0$/`). No es una
  pérdida —la aserción es nueva— pero conviene anclarla.
- **m4 · Coste extra en el cron.** `contarIntentos` resuelve el catálogo con 2 lecturas
  (antes 1) y se llama DENTRO del bucle por orden de `DevolucionSlaService.ejecutar`:
  +1 consulta por orden `not_found` y ejecución. Comportamiento intacto (R9 se cumple);
  es solo overhead sobre un lote pequeño. Se quitaría izando `resolverCriterio` fuera
  del bucle.
- **m5 · `ManifiestoService.armar`** pide el lote sobre TODAS las filas del repo,
  incluidas las que luego descarta `esVisiblePara` como `omitidas`. No expone el conteo
  de ninguna de ellas (nunca llegan a ser `filas`), así que **R15 se cumple**; la
  consulta es solo algo más ancha que el conjunto visible.
- **m6 · `listarLiberadasHoy`** es el único de los 7 puntos que mergea en el borde y no
  en un service (D1 backend). Justificado y verificado; queda anotado por uniformidad.
- **m7 · Checkpoints pendientes del leader:** `progress/history.md` sin entrada de 160,
  y T24.1 sin marcar (esto último forma parte de B1).

---

## 10. Deuda visual y E2E — dimensionada, no redescubierta

**Confirmo lo que declara `impl_160_frontend.md §6`: el frontend no abrió la aplicación
en un navegador ni una sola vez**, en una feature que toca 13 superficies de UI, y no
corrió Playwright ni verificó modo oscuro.

**Corrección importante al encargo:** la premisa *"el repo no tiene harness de E2E"* es
**falsa**. `e2e/` tiene **18 specs de Playwright**, entre ellas
`e2e/reintentos-escalado.spec.ts` (que cubre exactamente el escalado por umbral que esta
feature cambia) y `e2e/historial-orden.spec.ts` (drawer con gestión `reprogramada`).
**Ninguna se ejecutó.**

Riesgo concreto que queda vivo, por orden de severidad:

1. **La rama NUEVA del escalado no tiene cobertura extremo a extremo.**
   `reintentos-escalado.spec.ts` ejercita 3 devoluciones (rama A). El comportamiento que
   esta feature introduce —que una `reprogramada` del mensajero acerque el umbral y
   adelante el `cobroRechazado`— **no lo ejercita ningún E2E.** Está muy bien cubierto
   en unitarios (M1/M2 lo prueban), pero no contra un sistema montado.
2. **Riesgo de rotura de los E2E existentes: BAJO.** Lo comprobé: ningún spec de `e2e/`
   asserta índices de celda, listas de cabeceras ni la AUSENCIA del badge de intentos,
   así que la columna nueva no debería romperlos estructuralmente. No es certeza —no los
   corrí—, pero el vector obvio está descartado por inspección.
3. **`/ordenes` del maestro pasa a 20 `columnheader`** (19 de datos + Acciones) en un
   `DataTable` con `overflow-x-auto`. Sin verificar: ancho real, salto de la fila de
   cabeceras y las flechas de scroll horizontal. **Severidad: cosmética/usabilidad, no
   pérdida de dato.** Probabilidad de alguna aspereza visual: alta.
4. **Contraste de `text-warning-strong` sobre fila prioritaria (`bg-warning/15`)**, en
   claro y en oscuro: sin verificar. **Acotado** porque la regla de a11y del módulo se
   respeta (el énfasis es REDUNDANTE, el portador de la información es el número): el
   peor caso es un número de bajo contraste que sigue siendo legible como texto, no un
   dato que desaparece. Además el token es preexistente y ya sancionado
   (`PrioridadResalte`), así que hereda el tratamiento de modo oscuro que ya existe.
5. **Card POS del mensajero en móvil real:** un campo más en el bloque de campos. Podría
   alargar la card o provocar un salto de línea. **Cosmético.**
6. **Lectores de pantalla reales (NVDA/VoiceOver):** sin pasar. El markup es correcto por
   inspección (`columnheader` con nombre accesible, `<dt>`/`<dd>`, y el dato etiquetado
   como UN solo nodo de texto). **Riesgo bajo.**

**No lo convierto en bloqueante por sí solo**, tal como se me indicó, y coincido: nada de
esto puede perder ni corromper un dato. Pero conviene registrar que la parte 1 —el hueco
de E2E sobre la rama nueva del escalado— es la que toca dinero, y que la justificación
"el repo no tiene E2E" no se sostiene: lo tiene, y no se usó.

---

## 11. Resumen

- **Criterio:** correcto, por INCLUSIÓN, con #13 dentro y #22 fuera, verificado en
  declaración, mapa y semántica. **7 mutaciones propias, 7 muertas**, incluidas dos
  adversariales que no tocaban ninguna lista.
- **Un solo número:** confirmado. El test de criterio único **no es una ilusión**: el
  doble de Prisma evalúa el `where` de verdad.
- **Trazabilidad:** 32/32 verificados por mí. Ninguno huérfano ni vacío.
- **Las 5 aserciones cambiadas:** las 5 forzosas, cero pérdida de discriminación, una
  ganancia.
- **Suite:** 548 archivos / 5828 tests / 0 fallos; lint 0 errores / 10 warnings
  preexistentes; typecheck limpio; `init OK`.
- **Pendiente y bloqueante para mergear:** **B1** — ejecutar el `groupBy` contra un
  Postgres real, `EXPLAIN` y **T24.1**.

**VEREDICTO FINAL: APROBADO-CON-NOTAS**, con B1 como condición de merge/despliegue.
