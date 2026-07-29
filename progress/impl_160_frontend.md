# Feature 160 — bitácora de la fase FRONTEND

**Rama:** `feature/160-columna-intentos` (sale de `dev`). **Worktree:**
`R:/job/singularis/projects/ordenex-wt-160-spec`. **Fecha:** 2026-07-29.
**Alcance ejecutado:** bloques 5 y 6 (**T15–T21**), la parte de **UI de T23**, y
**T24 / T25**. **No** se tocó backend (`lib/services/`, `lib/repositories/`,
`lib/actions/`, `db/`): el dato ya viajaba en los 6 DTO desde la fase anterior.
**T24.1 (re-medición contra producción) NO es de esta fase** y sigue pendiente.

---

## 1. Qué quedó implementado

### La pieza compartida (T15) — `components/shared/intentos-entrega.tsx`

Un módulo, **dos formas de presentación del mismo dato**, para que las 12
superficies no se desincronicen:

| Export | Qué es | Para |
| --- | --- | --- |
| `INTENTOS_COLUMN_ID` (`"intentos"`) | id de columna | R21 |
| `INTENTOS_LABEL` (`"Intentos"`) | etiqueta **única**: cabecera de columna Y etiqueta del dato | R17/R18, i18n-ready |
| `valorIntentos(row)` | `row.intentosEntrega ?? 0` | R19, regla única |
| `IntentosValor` | el número, con énfasis **redundante** si `>= 1` | a11y |
| `columnaIntentos<T>()` | `Column<T>` genérica (sirve a `OrdenListItemDTO` y a `RecepcionSateliteDTO`) | R17 |
| `IntentosDato` | dato etiquetado `"Intentos: N"` | R18 |

Decisiones concretas del módulo:

- **No es un chip.** No existe `IntentosEntregaBadge` ni `conChipIntentos`, y hay
  un test que falla si alguien los agrega (D6 / design §7.6).
- **El énfasis nunca es portador único.** Con `>= 1` el número toma
  `font-semibold text-warning-strong` (token ya sancionado por `PrioridadResalte`);
  con `0` se pinta neutro **pero se pinta**. La información la lleva el número.
- **El umbral no entra ni de refilón** (R20). Hay una guarda de fuente que lee el
  propio archivo y falla si aparece el nombre de la config server-only.
- **`IntentosDato` emite un único nodo de texto** (`"Intentos: 2"`), no
  `"Intentos"` + `<span>2</span>`. Dos razones: se traduce como una sola cadena, y
  un lector de pantalla (o un `getByText`) lo lee entero en vez de partido.
- **`IntentosDato` no trae tamaño de fuente propio**: lo hereda del contenedor,
  que es lo que R18 pide ("mismo tratamiento visual que los campos hermanos").

### El inventario de superficies, con qué recibió cada una

**Tablas → COLUMNA propia, insertada JUSTO DESPUÉS de `estatus`** (design §5.2):

| # | Superficie | Archivo tocado |
| --- | --- | --- |
| 1 | Listado plano `/ordenes` | `app/(app)/ordenes/_components/ordenes-columns.tsx` |
| 2 | Variante de la pestaña `reprogramada` | (hereda por spread, archivo **no tocado**) |
| 3 | Dashboard del adminTienda | (hereda por `filter`, archivo **no tocado**) |
| 4 | Revisión del maestro (7 apartados) | (hereda vía `OrdenesApartado`, **no tocado**) |
| 5 | Satélite · "Recibidas", "Por devolver", "En tránsito a central" | `recepcion-satelite/_components/recibidas-columns.tsx` (los 3 grupos comparten esa lista) |
| 6 | **`GenerarGuiaModal`** (2 tablas: GAM y NO-GAM) | `ordenes/_components/GenerarGuiaModal.tsx` — **ver D1** |

**Sin tabla → DATO ETIQUETADO:**

| # | Superficie | Archivo tocado | Forma |
| --- | --- | --- | --- |
| 7 | Diálogos por lote con `<ul>` | `AsignarBodegaModal`, `RutearSateliteModal`, `RecuperarABodegaModal`, `DevolverATiendaModal` | `IntentosDato` en el `<li>` |
| 8 | Mensajero · card POS "por gestionar" | `mis-asignaciones/_components/pos-card/PosOrderCard.tsx` | `IntentosDato` en el bloque de campos |
| 9 | Mensajero · "por recoger" + detalle plegado | `mis-asignaciones/_components/AsignacionDetalle.tsx` | `Campo label="Intentos"` (`<dt>`/`<dd>`) |
| 10 | Satélite · "Por recibir" y "Devueltas" (cards) | `recepcion-satelite/_components/RecepcionDetalle.tsx` | `Campo label="Intentos"` |
| 11 | `/novedades` · novedades | `novedades/_components/NovedadesModule.tsx` | `IntentosDato` en un `<p>` hermano |
| 12 | `/novedades` · rechazadas por plazo vencido | `novedades/_components/RechazosSlaModule.tsx` | idem |
| 13 | Aviso "Liberadas hoy" (2 montajes) | `components/private/BodegaLiberadasHoy.tsx` | `IntentosDato` en el `CardContent` |

**Por qué dos formas de "dato etiquetado".** En `AsignacionDetalle` y
`RecepcionDetalle` los campos hermanos son `<dt>`/`<dd>` dentro de un `<dl>`.
Meter ahí un `"Intentos: N"` inline habría sido el **único** campo con otra
jerarquía — exactamente lo que R18 prohíbe— y además markup inválido para una
lista de definición. Por eso esas dos superficies usan el envoltorio propio de la
card con `INTENTOS_LABEL` + `IntentosValor`: la etiqueta y la regla del valor
siguen viniendo del módulo compartido, solo cambia el contenedor. `tasks.md` T18
ya lo anticipaba ("el dato como un campo más del detalle").

**Fuera, con motivo** (sin cambios, y ahora con test que fija la ausencia): vista
pública del paquete (QR), etiqueta imprimible y su PDF, API de integradores,
cierre del día. Ver §2 (R30).

### Posición de la columna, y qué NO se rompió

`columnaIntentos()` va en el índice **3** de `ordenesColumns` (justo tras
`estatus`), y en la misma posición relativa en `recibidasColumns`. Consecuencias
verificadas:

- Los **tres asserts vigentes** de `tests/unit/components/ordenes-columns.test.tsx`
  (`length + 1`, `at(-1)?.id === "liberada"`, `slice(0,-1)` igual a la base)
  siguen verdes **sin tocarlos**, como predecía design §5.2.
- El badge **"Prioritaria"** sigue cayendo en `numGuia`: `conBadgePrioridad`
  decora la primera columna de datos y la columna nueva se inserta en la 4.ª. Hay
  test.
- `ordenesColumnsAdminTienda` y `ordenesColumnsReprogramada` **heredan** la
  columna sin que se tocara ninguno de esos dos archivos.

---

## 2. Mapa `R<n> → test` (requisitos de FRONTEND)

Los R1–R16, R28, R29 y R31 son de la fase backend
(`progress/impl_160_backend.md §2`). Aquí van los de presentación.

| Req | Test |
| --- | --- |
| **R17** | `tests/unit/components/intentos-entrega.test.tsx` → "columnaIntentos — R17: columna propia con encabezado 'Intentos'" (id + `value` + `columnheader`); `tests/unit/components/ordenes-columns.test.tsx` → "R17: la tabla monta un columnheader 'Intentos'" y **"R17: el numero NO se incrusta en la celda de estado (no es un chip)"** (la celda de estado no contiene ni un dígito); `tests/components/RecepcionSateliteModule.test.tsx` → los 3 grupos de tabla; `tests/components/GenerarGuiaModal.test.tsx` → "R17: la tabla de órdenes GAM monta la columna 'Intentos'" |
| **R18** | `intentos-entrega.test.tsx` → "IntentosDato — R18: dato etiquetado 'Intentos: N'" (+ "no impone tamano de texto propio"); por superficie: `AsignarBodegaModal`, `RutearSateliteModal`, `RecuperarABodegaModal`, `DevolverATiendaModal` ("R18: cada orden listada muestra el dato etiquetado junto a su remisión"), `MisAsignacionesModule` ("R18: el detalle lo presenta como un CAMPO más (`<dt>`/`<dd>`), como sus hermanos"), `RecepcionSateliteModule` ("R18/R25: 'Por recibir' (cards)…" y "'Devueltas' (cards)…"), `NovedadesModule` / `RechazosSlaModule` ("R18: … el dato vive dentro de un `<p>` como los demás"), `BodegaLiberadasHoy` ("R18: … mismo markup que la línea de la remisión") |
| **R19** (el caso `0`) | `intentos-entrega.test.tsx` → "valorIntentos — R19" (3 casos: `3`, `0`, campo ausente) + "R19: con conteo 0 la celda dice '0' — ni vacia ni con el placeholder '—'" + "R19: con el campo AUSENTE la celda tambien dice '0'"; `ordenes-columns.test.tsx` → los mismos dos casos sobre las columnas reales, más "R19: cada fila lleva SU numero (2, 0 y ausente conviven en la misma tabla)"; y **en cada una de las 13 superficies** hay al menos un caso con `0` y (donde el DTO lo permite) uno con el campo ausente |
| **R20** | `intentos-entrega.test.tsx` → "R20 — el umbral NO viaja al cliente…" (render + **guarda de fuente**: el módulo no nombra ni importa la config del umbral); casos "R20" en `ordenes-columns.test.tsx`, `GenerarGuiaModal`, `AsignarBodegaModal`, `MisAsignacionesModule`, `BodegaLiberadasHoy` (el texto del dato es EXACTAMENTE `"Intentos: N"`) |
| **R21** | `ordenes-columns.test.tsx` → "R21: la columna nueva va JUSTO DESPUES de `estatus`, no al final" (índice fijo 3 + la última sigue siendo `tiempo`) y "R21: ids, encabezados y orden relativo de las 18 preexistentes, intactos"; los tres asserts vigentes de ese archivo (`:116-119`) verdes **sin tocarlos**; `RecepcionSateliteModule.test.tsx` → "R21/R32: el badge 'Prioritaria' sigue en la celda de Nº Guía, no en la nueva columna" |
| **R22** | `ordenes-columns.test.tsx` → "R22: las tres variantes derivadas heredan la columna sin tocar sus archivos"; `tests/components/OrdenesPage.test.tsx` (lista exacta de cabeceras + mapeo celda a celda), `AdminTiendaDashboard.test.tsx`, `OrdenesModuleReuse.test.tsx`, `OrdenesRevisionMaestro.test.tsx` → "R22: cada apartado del maestro monta la columna 'Intentos' con su número" |
| **R23** | `AsignarBodegaModal.test.tsx`, `RutearSateliteModal.test.tsx`, `RecuperarABodegaModal.test.tsx`, `DevolverATiendaModal.test.tsx` (5–6 casos cada uno); `GenerarGuiaModal.test.tsx` (columna, **ver D1**); `EtiquetasGuiaModal.test.tsx` → "R30: la etiqueta NO muestra los intentos" (**ver D2**) |
| **R24** | `MisAsignacionesModule.test.tsx`, bloque "intentos de entrega (feature 160)": card POS con `2`, con `0` y sin el campo; cada card con SU número; el detalle como `<dt>`/`<dd>`; "por recoger" con `1` y con `0` |
| **R25** | `RecepcionSateliteModule.test.tsx`, bloque "intentos de entrega (feature 160)": "Recibidas", "Por devolver" y "En tránsito a central" (columna, con `≥1` y `0`; el índice de celda contempla el checkbox de selección donde lo hay) + "Por recibir" y "Devueltas" (cards) |
| **R26** | `NovedadesModule.test.tsx` y `RechazosSlaModule.test.tsx`, bloques "intentos de entrega (feature 160)" |
| **R27** | `BodegaLiberadasHoy.test.tsx`, bloque "intentos de entrega"; **los dos montajes**: `RecepcionSateliteModule.test.tsx` → "R27: la card del aviso muestra el dato etiquetado, con 0 incluido" y `OrdenesRevisionMaestro.test.tsx` → "R27: el aviso 'Liberadas hoy' del maestro muestra el dato etiquetado" |
| **R30** (parte de UI) | `tests/components/EtiquetaGuia.test.tsx` → "R30: no expone el conteo de intentos"; `EtiquetasGuiaModal.test.tsx` → la vista previa no trae "Intentos"; `tests/unit/components/intentos-no-alcance-ui.test.ts` → guarda de FUENTE sobre `app/paquete/[numGuia]/page.tsx`, `EtiquetaGuia.tsx`, `etiquetas-pdf.ts` y `CierreDiaModule.tsx` (**ver §5.4**) |
| **R32** | Las suites completas de las 12 superficies, verdes (548 archivos / 5828 tests). Los **5** cambios de aserción están enumerados en §3; ninguno va más allá del dato nuevo |

**El test que el encargo pedía explícitamente** —el del caso `0`— existe por
duplicado y a propósito: una vez sobre la **pieza compartida** (columna y dato
etiquetado, incluido el caso "el campo no viaja") y una vez **por superficie**,
porque un `0` puede perderse tanto en la definición del dato como en el
contenedor que lo hospeda.

---

## 3. Aserciones existentes que cambiaron (5, enumeradas)

Todas por el dato nuevo; ninguna se "ajustó hasta que pasara".

1. `tests/components/OrdenesPage.test.tsx` → lista exacta de cabeceras: entra
   `"Intentos"` tras `"Estado"`. **Y los índices de celda corren uno**:
   `destinatario` pasa de `c1[3]` a `c1[4]` y `tienda` de `c1[6]`/`c3[6]` a
   `c1[7]`/`c3[7]`. Se aprovechó para agregar `expect(c1[3]).toHaveTextContent("0")`,
   que es el caso `0` en la página real.
2. `tests/components/OrdenesPage.test.tsx` → nº de cabeceras del estado vacío:
   19 → 20.
3. `tests/components/AdminTiendaDashboard.test.tsx` → lista exacta de cabeceras
   del dashboard: entra `"Intentos"`.
4. `tests/components/OrdenesModuleReuse.test.tsx` → nº de columnas del
   adminTienda: 17 → 18.
5. `tests/components/RecepcionSateliteModule.test.tsx` → lista exacta de
   cabeceras de "Recibidas": entra `"Intentos"`.

**Cambio no-aserción:** el helper `renderModule` de
`RecepcionSateliteModule.test.tsx` gana `liberadasHoy={props?.liberadasHoy ?? []}`
(antes ni siquiera se le podía pasar la prop, así que ese montaje del aviso estaba
sin cubrir).

Los 5 son consecuencia directa e inevitable de insertar una columna en el medio
—la posición que decidió el humano (design §5.2/§7.7)—. Insertarla al final
habría evitado los índices corridos, pero habría roto un assert ajeno
(`at(-1)?.id === "liberada"`) y dejado la columna fuera del viewport.

---

## 4. Salida real de la verificación

```
$ ./init.sh
✓ node v24.13.0
✓ dependencias presentes
✓ regla max-2-por-zona respetada (in_progress=2)
✓ specs presentes para features sdd en vuelo
-> pnpm run typecheck
✓ typecheck paso                       (0 errores)
-> pnpm run lint
✖ 10 problems (0 errors, 10 warnings)  ← las 10 son PREEXISTENTES, ninguna nueva
✓ lint paso
-> pnpm run test
 Test Files  548 passed (548)
      Tests  5828 passed (5828)
   Duration  135.16s
✓ test paso
✓ todas las migraciones tienen down.sql
! no hay .env. Crea uno a partir de .env.example
== init OK ==
```

Referencia tras la fase backend: 546 archivos / 5731 tests. **Delta de esta fase:
+2 archivos de test y +97 tests, 0 fallos.**

```
$ git diff --name-only -- db/
(vacío)                                ← R7 sigue en pie
$ git status --porcelain               ← sin archivos sin trackear tras el commit
```

---

## 5. Discrepancias entre el spec y la realidad del código

### D1 — `GenerarGuiaModal` NO es una lista: es una tabla (afecta a T17/R23)

`design.md §5.4` clasifica los **seis** diálogos de acción por lote como
"`<ul>` de órdenes" y T17 manda poner `IntentosDato` "junto a cada `<li>`".
**`GenerarGuiaModal` no tiene ningún `<li>`**: lista las órdenes en dos
`DataTable` (`columns` para las GAM, con su selector de mensajero, y `noGamColumns`
para las que van a satélite).

**Qué hice:** darle la **columna** `columnaIntentos()` a las dos tablas.
**Por qué:** R17 y R18 no son reglas por superficie sino **por forma de
presentación** —el propio design lo dice al hablar de `/novedades`: *"Si alguna de
las dos se convirtiera en tabla, la regla de R17 las mueve a columna
automáticamente, sin cambiar el spec"*—. Poner un dato etiquetado dentro de una
celda sería justo el "marcador incrustado en la celda de otra columna" que R17
prohíbe. Los otros cuatro diálogos (`AsignarBodega`, `RutearSatelite`,
`RecuperarABodega`, `DevolverATienda`) **sí** son `<ul>` y recibieron el dato
etiquetado, como estaba escrito.

### D2 — `EtiquetasGuiaModal` no lista las órdenes seleccionadas (afecta a T17/R23)

Es el sexto diálogo de la lista de T17. **No muestra las órdenes seleccionadas:**
muestra la **vista previa de las etiquetas imprimibles** (`EtiquetaGuia`, sobre
`EtiquetaGuiaDTO`) más un aviso de las omitidas.

**Qué hice:** **no** agregarle el dato, y escribir un test que fija esa ausencia.
**Por qué:** lo único "por orden" que se ve ahí es la etiqueta física, y **R30 la
deja explícitamente fuera** (QA4, decidido "no"). Además `EtiquetaGuiaDTO` no
declara el campo (R16/R30, con guarda de tipos en la fase backend), así que darle
el dato exigiría cambiar un contrato que la feature decidió no tocar. **R30 gana a
R23 en esta superficie**, y queda asertado en vez de solo declarado.

### D3 — El nombre del archivo del módulo compartido choca con `docs/conventions.md`

`tasks.md` T15 fija la ruta `components/shared/intentos-entrega.tsx` (kebab-case),
mientras que `docs/conventions.md` dice "Componentes React: `PascalCase.tsx`" y
`components/shared/` está lleno de `PascalCase.tsx` (`DataTable`,
`PrioridadResalte`…).

**Qué hice:** respetar el spec (la ruta literal de T15). **Por qué:** el export
principal del módulo es una **fábrica de columnas**, y el repo ya tiene precedente
exacto de `.tsx` en kebab-case para eso (`ordenes-columns.tsx`,
`recibidas-columns.tsx`, `usuarios-columns.tsx`, `zonas-columns.tsx`). Es una
discrepancia de forma, no de comportamiento; si el reviewer prefiere
`IntentosEntrega.tsx`, es un `git mv` y 8 imports.

### D4 — La bitácora que `tasks.md` T25 nombra no existe con ese nombre

T25 pide escribir el mapa en `progress/impl_160-badge-intentos-entrega.md`. La
fase backend usó `progress/impl_160_backend.md` y ésta usa
`progress/impl_160_frontend.md`. **No creé un tercer archivo**: partiría el rastro
en tres. Anoté la corrección en el propio `tasks.md`.

### D5 — Ninguna superficie necesitó backend nuevo

Se confirma lo que anunciaba la fase anterior: el dato viaja en los 6 DTO y
**siempre** con valor (`0` incluido). No hubo que pedir un campo, un endpoint ni un
merge más. `lib/`, `db/` y `app/api/` quedaron sin tocar en esta fase.

---

## 6. Qué NO verifiqué (explícito)

1. **No abrí la aplicación en un navegador.** Ni una sola vez. Todo lo que sé del
   aspecto de la columna y del dato viene de tests en jsdom, que verifican
   **texto, roles y estructura**, no píxeles. En concreto **no** verifiqué: cómo
   queda el ancho real de la tabla con 19 columnas, si las flechas de scroll
   horizontal del `DataTable` siguen sintiéndose bien, si el contraste del
   `text-warning-strong` sobre el fondo de fila prioritaria (`bg-warning/15`) se
   ve como se espera en claro y en oscuro, ni cómo cae el dato nuevo en la card POS
   en una pantalla de móvil real. Nada de eso está cubierto.
2. **No corrí Playwright** (`pnpm run test:e2e`). `docs/verification.md` pide E2E
   "para features con UI o flujo crítico"; esta feature es UI en 12 superficies.
   No hay E2E nuevo y no ejecuté los existentes: el worktree no tiene `.env` ni
   base, y levantar el stack completo excedía el encargo. **Es una deuda real, no
   una omisión inocua.**
3. **No verifiqué el modo oscuro** de ninguna superficie.
4. **No verifiqué nada contra una base de datos real**, así que no vi un número de
   intentos verdadero en pantalla: todos los valores de los tests son sintéticos.
   Que el backend calcule bien está cubierto por la fase anterior, con sus propias
   salvedades (su §6).
5. **No ejecuté T24.1** (re-medición del radio de impacto contra producción). Es
   del leader y va inmediatamente antes de desplegar. La medición del 2026-07-29
   (0 órdenes que saltan el umbral) la doy por buena tal como está en
   `design.md §4.4`; **no la reproduje**.
6. **No verifiqué el comportamiento con lectores de pantalla reales.** El markup
   es correcto (`columnheader` con nombre accesible, `<dt>`/`<dd>`, un solo nodo de
   texto para el dato etiquetado), pero no lo pasé por NVDA ni VoiceOver.
7. **No toqué ni verifiqué la feature 156**, que trabaja en paralelo en otro
   worktree. Mi cambio en `ordenes-columns.tsx` es de 8 líneas y localizado (un
   import + una entrada de array con su comentario), pero **si la 156 acabara
   tocando ese archivo habría conflicto**, y no puedo verlo desde aquí.
8. **No medí el coste de render** de una columna más en tablas con muchas filas.
   `Column<T>` no tiene ancho y el `DataTable` ya resuelve el desborde con
   `overflow-x-auto`, así que el diseño dice que no hay layout que ajustar — pero
   eso es razonamiento, no medición.

---

## Integración con dev (merge `origin/dev` -> `feature/160-columna-intentos`, 2026-07-29)

`dev` había avanzado con la **154** (catálogo de estados v2), la **156** (generar guía
sin mensajero) y la **144** (componente de filtros + orden). El merge trajo **tres
conflictos**, los tres del tipo "ambos lados suman": en ninguno se descartó un lado.

### 1. `lib/types/orden-historial.ts` — dos familias nuevas, criterio nuevo

- **Qué chocó:** la 160 reescribió los comentarios de las familias al criterio vigente
  (*"fuera del criterio de intento"*); la 154 añadió dos valores de enum nuevos
  —`recoleccion_tienda` e `incidente`— con comentarios redactados en el lenguaje viejo
  (*"destino != devuelta -> no altera contarIntentos"*).
- **Resolución:** se conservan **los dos valores de la 154** (son valores del enum
  Postgres: perderlos rompería `_EnsureExhaustive` y el build) y se **reescriben sus
  comentarios al criterio de la 160**, igual que los otros cuatro. En el bloque de
  comentario largo se conserva la versión de la 160 y se **añade el párrafo de la 154
  reescrito**, comprobando las **dos ramas** del criterio (R1): ninguno de los dos
  transiciona hacia `devuelta` ni produce el par (`reprogramada`, `gestion`), así que
  dejarlos fuera de `ORIGEN_TIPOS_CON_GESTION` sigue siendo inocuo.
- **Nada que decidir de dominio:** el conteo de intentos no cambia.

### 2. `lib/services/OrdenService.ts` — `historial` (160) + `ahora` (144)

- **Qué chocó:** la 160 añadió `historial: IntentosSvc` **requerido**; la 144 añadió
  `ahora: () => Date` **opcional**.
- **Resolución:** el constructor se queda con **las dos**, en el orden
  `(repo, historial, ahora = () => new Date())`. `historial` **no se volvió opcional**:
  es requerido a propósito (R11/R12) para que el wiring de producción no pueda
  olvidarlo y el dato desaparecer en silencio; `ahora` va al final por ser el único
  parámetro con default.
- **Call-sites revisados (los 2 sitios que lo construyen):**
  - `lib/actions/ordenes.ts` (**producción**): ya pasaba `(ordenRepo, OrdenHistorialService)`
    y `ahora` cae en su default. **Sin cambios.**
  - `tests/unit/services/orden-service-filtros.test.ts` (**suite de la 144**): sus 5
    construcciones pasaban `ahora` en la 2.ª posición, que ahora es `historial`. Se
    intercala el doble compartido `fakeIntentosEnLote()` de
    `tests/fixtures/intentos-entrega.ts`. **Ninguna aserción cambió**: esa suite no
    afirma nada sobre intentos, el doble solo satisface el contrato.
  - `tests/unit/services/orden-service.test.ts` y `rol-admin-satelite-authz.test.ts` ya
    venían de la 160 con el doble. Sin tocar.

### 3. `app/(app)/ordenes/_components/GenerarGuiaModal.tsx` — la 156 lo reescribió

- **Qué chocó:** la 156 reescribió el modal (fuera el selector de mensajero, fuera la
  separación GAM / NO-GAM, ahora es confirmación de lote que envía `{ ordenIds }`); la
  160 había añadido la columna "Intentos" a **sus dos** `DataTable`.
- **Resolución:** se queda **el modal de la 156** y la columna de intentos se monta en
  la **única tabla que hoy existe** (`COLUMNS`, aria-label "Órdenes por numerar"), tras
  la identificación de la orden. No se forzó ninguna tabla: la 156 no eliminó las
  tablas, las **colapsó en una**, así que la columna tiene dónde ir y R17 se sigue
  cumpliendo en esta superficie.
- **DISCREPANCIA DOCUMENTADA (no es un error, es un hecho nuevo):** el diseño de la 160
  hablaba de **dos** tablas en este diálogo (la GAM con selector de mensajero y el
  grupo NO-GAM por zona satélite). Tras la 156 **hay una sola**. El texto de
  `specs/160-columna-intentos/design.md §5.4` y la trazabilidad de R17 quedan
  describiendo una superficie que ya no tiene esa forma. **No se editó el spec**:
  reescribir un design aprobado es decisión del leader, no de la integración.

#### Tests de la 160 en `tests/components/GenerarGuiaModal.test.tsx`

Git auto-mergeó el archivo (la reescritura de la 156 + el `describe` de la 160
apendido), pero los 4 casos de la 160 apuntaban a tablas que la 156 borró
(`"Órdenes por asignar"` y `"Se enviarán a la bodega satélite de Limón"`). Se
**movieron a su nueva verdad**, no se relajaron ni se borraron:

- los 4 casos apuntan ahora a la única tabla, vía la constante `TABLA` del propio archivo;
- el caso "NO-GAM" **conserva su intención** (una orden fuera del GAM también trae el
  dato) sobre la tabla que hoy la contiene, con el mismo valor esperado (`3`);
- **ninguna aserción perdió fuerza**: siguen `getByRole("columnheader")`, los
  `toHaveTextContent(/^N$/)` exactos y el `textContent === "2"` que fija la ausencia
  del umbral (R20).

### Verificación del límite R29/QA8 frente a la 144 (obligatoria)

La 160 declaró que la columna de intentos es un **dato derivado** y, por tanto, **no es
ordenable ni filtrable server-side**. La 144 llegó a `dev` después. Comprobado contra el
código ya mergeado: **el límite sigue siendo cierto y no rompe nada.**

| Riesgo a descartar | Resultado | Evidencia |
| --- | --- | --- |
| ¿La columna hace que `ordenFilterSchema.strict()` rechace un payload legítimo? | **No** | `ORDEN_FILTER_FIELDS` sigue con sus 9 claves (`lib/types/orden.ts`). `intentosEntrega` no es clave de filtro y nadie la emite: `seleccionAFilter` (`seleccion-a-filter.ts`) itera la selección del `FilterComponent`, cuyas claves salen de `construirFiltrosOrdenes`, no de las columnas. |
| ¿Aparece en un selector de orden que el servidor rechace? | **No** | `SORT_FIELDS` sigue siendo el enum cerrado `["created_at","num_guia","num_remision"]` y `SORT_COLUMN` (`OrdenRepository.ts:143`) su lista blanca de 3 columnas reales. Además **no existe ningún selector de orden en la UI**: `grep -rn "sortBy\|sortable\|onSort" app/ components/` no devuelve **ninguna** coincidencia en `.tsx`. La columna no puede ofrecerse porque no hay dónde. |
| ¿El componente de filtros de la 144 deriva sus opciones de la lista de columnas? | **No** | `construirFiltrosOrdenes(cat, opts)` (`ordenes-filtros-def.ts`) es una función **pura del catálogo** (`CatalogoFiltrosOrdenesDTO`: zonas, tiendas, provincias, cantones, distritos) más el filtro de fecha. En `OrdenesListado.tsx`, `filtrosBarra` (l. 365) y `columns` (l. 399) se construyen por vías **independientes**: la barra nunca ve `ordenesColumns`. "Intentos" no puede colarse como filtrable. |

Comprobado además que `ordenesColumnsReprogramada` deriva de `ordenesColumns`
(`ordenes-columns.tsx:207`), así que la tab `reprogramada` hereda la columna sin
duplicación y sin que la 144 la altere.

### Hallazgos ajenos al merge (rojos que ya venían de `dev`)

1. **`tests/integration/db/orden-indices-filtros-migracion.test.ts` (guard de la 144)
   estaba ROJO en `dev`.** El caso *"su timestamp NO es anterior al de ninguna
   migración previa"* excluye las migraciones apendidas después (153 y 159), pero la
   **154** entró a `dev` con dos migraciones `20260729…` —posteriores a
   `20260728120000_orden_indices_filtros`— **sin actualizar esa lista**.
   - **Probado ajeno al merge:** la 160 no aporta **ninguna** migración
     (`git diff --name-only $(git merge-base HEAD MERGE_HEAD) HEAD -- db/migrations`
     vacío) y el set de `db/migrations` del árbol mergeado es **idéntico** al de
     `origin/dev`; el test también es el de `dev` sin una sola línea de diferencia.
     Falla igual en `dev` solo.
   - **Arreglado** con el **mecanismo del propio autor**: dos exclusiones nombradas, una
     por migración, con su comentario —exactamente como ya estaban 153 y 159. La
     aserción **no perdió fuerza**: se actualizó el hecho (qué migraciones se apendieron
     después), no el predicado.
2. **`./init.sh` no llega a verde por la feature 149, y NO se tocó.** El gate 4 corta:
   `✗ faltan specs para features sdd en vuelo (por id): 149`. En el `feature_list.json`
   de `dev` la 149 está en `spec_ready` con `spec_path: specs/149-deshacer-asignacion`,
   pero **esa carpeta no existe en ninguna rama del repo** (comprobadas todas las
   remotas) ni en ningún worktree. Viene del commit de bookkeeping `7fafa7d`. En el
   `HEAD` previo al merge la 149 estaba en `pending`, y por eso `init.sh` estaba verde.
   - **No se arregló a propósito:** las dos salidas son (a) escribir el spec o (b)
     devolver la 149 a `pending`. La primera está fuera del alcance de una integración;
     la segunda es **bookkeeping del registro**, que es del leader, y tocarlo podría
     pisar trabajo en vuelo de otra sesión. **Se reporta, no se decide.**

### Verificación (salida real)

```
$ pnpm run typecheck
> tsc --noEmit
(sin salida — verde)
```

Nota: el primer `typecheck` falló con `"recoleccion_tienda" is not assignable to
OrdenHistorialOrigenTipo` por un **cliente Prisma stale** (los dos valores de enum de la
154). Se resolvió con `pnpm db:generate`, sin tocar código.

```
$ pnpm run lint
✖ 10 problems (0 errors, 10 warnings)
```

0 errores. Los 10 warnings son preexistentes y ajenos a este merge (`CENTRO_FALLBACK`,
`exhaustive-deps` de `OrdenesApartado`/`OrdenesModule`, imports sin usar en 4 tests).

```
$ pnpm test
 Test Files  569 passed (569)
      Tests  6177 passed (6177)
   Duration  137.20s
```

**0 fallos.** Antes del merge la rama tenía 548 archivos / 5828 tests; `dev` aportó
21 archivos y 349 casos.

```
$ ./init.sh
== Arnes SDD :: init ==
✓ node v24.13.0
✓ dependencias presentes
✓ regla max-2-por-zona respetada (in_progress=4)
✗ faltan specs para features sdd en vuelo (por id): 149
```

Los gates que `init.sh` no alcanza a correr se ejecutaron **a mano** y están arriba
(typecheck / lint / test). Gates 6 y 7 comprobados aparte: **todas** las migraciones
tienen su `down.sql` y `.env` está presente.

**Veredicto: merge resuelto y verde en typecheck / lint / tests (0 fallos); `init.sh`
queda rojo únicamente por el spec ausente de la feature 149, que viene de `dev` y es
decisión del leader.**
