# Feature 148 — Manifiesto Excel por lote · bitácora del FRONTEND_DEV

Rama `feature/148-manifiesto-excel-lotes`, worktree `../ordenex-wt-148`, base
`origin/dev` @ `55b0cd4` + el spec + los 5 commits del `backend_dev`.

Alcance ejecutado: **T7, T8, T9** (fase 2), **T10, T11, T12, T13, T14** (fase 3) y los
tests **T17, T19, T20, T21**. Fuera de alcance y NO tocado: `lib/types/manifiesto.ts`,
`lib/interfaces/**`, `lib/services/ManifiestoService.ts`, `lib/actions/manifiesto.ts`,
`lib/repositories/**` y sus tests. La Server Action `obtenerManifiesto` se **consume**,
no se modifica.

## Archivos

**Nuevos**
- `lib/utils/manifiesto-xlsx.ts` (T8) — `COLUMNAS_MANIFIESTO` (las 11 de R2, en orden),
  `buildManifiestoXlsx`, `manifiestoFileName`, `MANIFIESTO_SHEET`. Puro: sin DOM, sin React.
- `components/shared/descargar-blob.ts` (T9) — Blob + anchor + `revokeObjectURL` en `finally`.
- `components/shared/DescargarManifiestoButton.tsx` (T9) — el ÚNICO botón, para los 6
  puntos de UI.
- `components/shared/ManifiestoResultado.tsx` (T9) — cuerpo compartido de la fase
  "resultado" (resumen ya cometido + botón). No estaba en `design.md §3`; ver decisión 2.
- `tests/unit/utils/manifiesto-xlsx.test.ts` (T17, 8 tests).
- `tests/components/DescargarManifiestoButton.test.tsx` (T19, 9 tests).
- `tests/components/ManifiestoFlujos.test.tsx` (T20, 11 tests).

**Modificados**
- `lib/utils/xlsx-template.ts` (T7) — **aditivo**: `XLSX_MIME`, `XlsxColumn`,
  `XlsxCellValue`, `buildXlsxRows`. `buildXlsxTemplate` intacto, byte por byte.
- `components/shared/BulkUpload.tsx` (T7) — toma `XLSX_MIME` del import dinámico que ya
  hacía, en vez de su constante local. Cambio mecánico, sin cambio de comportamiento.
- `OrdenesCargaResumenPaso.tsx` (T10), `GenerarGuiaModal.tsx` + `AsignarBodegaModal.tsx`
  (T11), `RutearSateliteModal.tsx` + `AsignarSateliteModal.tsx` (T12),
  `RecepcionSateliteModule.tsx` (T13), `DevolverATiendaModal.tsx` (T14).
- Tests ajenos ajustados por la fase "resultado" (§9.7): `GenerarGuiaModal.test.tsx`,
  `AsignarBodegaModal.test.tsx`, `AsignarSateliteModal.test.tsx`,
  `RutearSateliteModal.test.tsx`, `DevolverATiendaModal.test.tsx` (cierran la fase antes
  de esperar `onSuccess`), `OrdenesListadoEtiquetasChain.test.tsx` (el encadenado a
  etiquetas ocurre al cerrar la fase) y `BulkUpload.test.tsx` (T21: el doble del
  generador reexpone `XLSX_MIME`).

**NO tocado**: los 5 servicios de negocio, sus acciones, `db/**`, y todo lo del backend
de la 148.

## Decisiones de implementación

1. **Conflicto con la 143: no se materializó.** `buildXlsxRows`/`XLSX_MIME` NO existían
   en esta base (`lib/utils/xlsx-template.ts` solo exportaba `XlsxTemplateField` y
   `buildXlsxTemplate`), así que se crearon aquí. Si la 143 aterriza después, el conflicto
   se resuelve conservando UNA sola definición de cada símbolo; la firma elegida es
   `buildXlsxRows(columns: XlsxColumn[], rows, sheetName)`.
2. **`ManifiestoResultado` (archivo no listado en `design.md §3`).** Los 5 modales
   comparten exactamente la misma fase de resultado (aviso `role="status"` + botón). En vez
   de repetir esa composición cinco veces se extrajo a `components/shared/` (≥ 2
   consumidores, regla de `docs/architecture.md`). La lógica de descarga sigue en UN solo
   componente, como exige el spec.
3. **`onSuccess()` se DIFIERE al cierre de la fase "resultado"** (§9.7). Es la consecuencia
   inevitable de la decisión del humano: `onSuccess` de los padres cierra el modal y
   refresca, así que invocarlo al confirmar destruiría la fase donde vive el botón. Se
   respeta el cierre por CUALQUIER vía (botón "Cerrar", Escape, overlay) mediante un
   envoltorio de `onOpenChange`. La llamada de negocio, su input, su toast y su manejo de
   error quedan idénticos (R27), y la operación se comete en el mismo instante que antes.
4. **Efecto colateral asumido en la feature 95** (encadenado a "Imprimir etiquetas" tras
   generar guía / asignar bodega): ahora se encadena al CERRAR la fase de resultado, no al
   confirmar. El lote encadenado es el mismo y el flujo termina igual; 3 tests de
   `OrdenesListadoEtiquetasChain` se ajustaron a ese orden. Es un cambio de UX visible: el
   usuario ve manifiesto → etiquetas, en ese orden.
5. **La fecha del nombre del archivo sale de `filas[0].fecha`**, no de un
   `fechaCalendarioCR()` recalculado en el cliente: así el nombre y la columna `fecha`
   nunca discrepan si la descarga cruza la medianoche (R10/R14).
6. **Aislamiento de R25 por construcción**: la descarga vive en un botón que solo existe
   DESPUÉS del éxito, no comparte estado con `handleConfirm` y captura todos sus fallos en
   un `catch` que solo dispara un toast. No hay ningún camino desde un fallo de descarga
   hacia la acción de negocio.
7. **`R22`/`R23` toman los ids con `status === "ok"`** del loop de la UI (§9.1); los
   services por-orden no se tocaron. En `DevolverATiendaModal` el fallo parcial se sigue
   lanzando al canal de error del `Modal` exactamente como antes, así que en la práctica el
   lote del manifiesto es el total cuando todas salieron bien.

## Mapa R → test (los R de MI mitad)

| R | Test |
|---|---|
| R2 | `manifiesto-xlsx.test.ts` › "la cabecera trae las 11 columnas pedidas, en el orden pedido" (+ `COLUMNAS_MANIFIESTO` tiene 11) |
| R3 | `manifiesto-xlsx.test.ts` › "emite una fila de datos por orden, en el orden recibido" |
| R5/R7 | `manifiesto-xlsx.test.ts` › "sin guía y sin monto las celdas quedan VACÍAS"; `xlsx-template.test.ts` › "un valor null (o ausente) deja la celda VACÍA" |
| R11 | `manifiesto-xlsx.test.ts` › "un campo ajeno a las 11 columnas NO llega al archivo"; `xlsx-template.test.ts` › "solo se emiten las columnas declaradas" |
| R12 | `DescargarManifiestoButton.test.tsx` › "descarga igual e informa cuántas órdenes quedaron fuera" |
| R13 | `manifiesto-xlsx.test.ts` › "produce un binario XLSX recargable con UNA sola hoja" + "vuelca los valores…"; `xlsx-template.test.ts` › los 6 casos de `buildXlsxRows` |
| R13 (no regresión, **T21**) | `xlsx-template.test.ts` › "XLSX_MIME es exactamente el MIME OpenXML…" + los 8 casos intactos de `buildXlsxTemplate`; `BulkUpload.test.tsx` › "al descargar genera el XLSX, crea un Blob con MIME XLSX…" y los dos de nombre de archivo |
| R14 | `manifiesto-xlsx.test.ts` › "nombra el archivo manifiesto-\<flujo\>-\<YYYY-MM-DD\>.xlsx"; `DescargarManifiestoButton.test.tsx` › "descarga con el nombre … fecha de las filas" |
| R15 | `DescargarManifiestoButton.test.tsx` › "arma el blob en el navegador y dispara la descarga SIN llamar a ninguna API de subida" (afirma `fetch` no llamado y `revokeObjectURL`) |
| R16 | `DescargarManifiestoButton.test.tsx` › "queda deshabilitado mientras genera y un segundo clic no dispara otra generación" |
| R17 | `manifiesto-xlsx.test.ts` › "lanza si no hay filas"; `DescargarManifiestoButton.test.tsx` › "no ofrece la descarga con selección vacía" + "si el lote no devuelve ninguna fila NO genera archivo"; `ManifiestoFlujos.test.tsx` › "sin órdenes nuevas… NO ofrece manifiesto" + el estado inicial de la sección "En tránsito a central" |
| R18 | `ManifiestoFlujos.test.tsx` › "tras la carga masiva ofrece el manifiesto de las remisiones creadas" |
| R19 | `ManifiestoFlujos.test.tsx` › "tras generar guía…" + "tras asignar desde bodega…" |
| R20 | `ManifiestoFlujos.test.tsx` › "tras rutear a satélite ofrece el manifiesto del lote" |
| R21 | `ManifiestoFlujos.test.tsx` › "tras asignar desde la bodega satélite ofrece el manifiesto del lote" |
| R22 | `ManifiestoFlujos.test.tsx` › "tras enviar a central ofrece el manifiesto SOLO de las enviadas con éxito" (la que falla no entra) |
| R23 | `ManifiestoFlujos.test.tsx` › "tras enviar a la tienda ofrece el manifiesto de las enviadas" + "si el envío falla, no hay fase de resultado ni manifiesto" |
| R25 | `ManifiestoFlujos.test.tsx` › "un fallo de la descarga NO re-ejecuta la acción de negocio ni revierte su resultado" |
| R26 | `DescargarManifiestoButton.test.tsx` › "un fallo de la acción muestra un mensaje accionable" + "si la generación del binario lanza, se informa y el botón se rehabilita" |
| R27 | `ManifiestoFlujos.test.tsx` › "la llamada de negocio conserva su input, su toast y su manejo de resultado"; y los tests propios de los 5 modales, que siguen verdes con sus mismas aserciones de input/toast/error |

R1, R4, R6, R8, R9, R10, R24, R28, R29 y R30 son del backend (ver
`progress/impl_148_backend.md`).

## Verificación ejecutable

Baseline MEDIDO tras el backend de la 148 (punto de partida real de esta mitad):

| | Baseline (backend 148) | Después de mi trabajo | Delta |
|---|---|---|---|
| `pnpm typecheck` | 0 errores | **0 errores** | 0 |
| `pnpm lint` | 0 errores / 145 warnings | **0 errores / 145 warnings** | 0 |
| `pnpm test --run` | 521 archivos / 5365 tests, 0 fallos | **524 archivos / 5400 tests, 0 fallos** (148 s) | +3 archivos / +35 tests, **0 regresiones** |

5365 + 35 (7 en `xlsx-template.test.ts` + 8 + 9 + 11) = 5400 exacto. `./init.sh` verde de
punta a punta.

## Deuda / puntos abiertos para el reviewer

1. **Cambio de UX confirmado y visible**: los 4 modales ya no se cierran al confirmar.
   Quien no quiera el manifiesto tiene que pulsar "Cerrar". Aprobado en §9.7, pero conviene
   que el humano lo vea en vivo antes del merge.
2. **Feature 95 (etiquetas) queda detrás de la fase de resultado** (decisión 4). Si se
   prefiere el orden inverso (etiquetas primero), hay que decidirlo a nivel de producto: el
   encadenado lo dispara `onSuccess`, que es justo lo que se difiere.
3. **El manifiesto sigue sin ser reimprimible** (`design.md §8.1`): si el usuario cierra la
   fase de resultado sin descargar, ese lote se perdió. En `RecepcionSateliteModule` el
   botón del último envío sobrevive al refresco, pero NO a una recarga de la página.
4. **`ManifiestoResultado` no figura en `design.md §3`** (decisión 2). Si el reviewer lo
   considera fuera de contrato, se inlinea en los 5 modales sin tocar el botón.

---

# Correcciones del review (`progress/review_148.md`) — segunda vuelta

Veredicto original: RECHAZADO, 2 bloqueantes. El bloqueante 1 (casillas de `tasks.md`) lo
cerró el leader. Aquí queda el bloqueante 2 y el cambio extra autorizado por el humano.

## B2 — El efecto colateral del diferimiento de `onSuccess` alcanza también a la capa E2E

**Reconocido: mi declaración anterior ("12 tests ajenos") se quedó corta.** El diferimiento
cambia el comportamiento OBSERVABLE de los 4 modales, así que rompe cualquier prueba que los
confirme, incluidas las de Playwright, que **no** corren en `pnpm test` ni en `./init.sh` y
por eso no salieron en rojo. Auditados los 18 specs de `e2e/**` uno por uno: **3 tocan
modales de esta feature**, no solo el que encontró el reviewer.

### 1. `e2e/asignacion-satelite.spec.ts` (el del review) — `AsignarSateliteModal`

- **Rotura 1 (strict mode).** `page.getByText(/Mensajero asignado a/i)` resolvía a 2
  elementos (toast + `Alert role="status"` de `ManifiestoResultado`, que recibe el MISMO
  string). Arreglado **acotando la aserción del toast a su propia región**
  (`getByRole("region", { name: "Notificaciones" })`, el `Toast.Viewport` de
  `providers/ToastProvider.tsx:102-104`). La aserción original —"el toast de éxito se ve"—
  se conserva íntegra; solo deja de ser ambigua. No se usó `.first()`, que podría haber
  pasado mirando el elemento equivocado.
- **Rotura 2 (la aserción medía otra cosa).** El `toHaveCount(0)` sobre "Recibidas" se
  evaluaba con el diálogo abierto, o sea, podía pasar por el `aria-hidden` del fondo y no por
  la transición `en_bodega_satelite → por_recoger`. Arreglado haciendo explícito el recorrido
  real del usuario: se comprueba la fase "resultado" (resumen + botón de manifiesto), se
  pulsa **"Cerrar"**, se espera `toBeHidden()` del diálogo —que es lo que dispara
  `onSuccess` → `router.refresh()`— y **recién entonces** se afirma la salida de "Recibidas".
- El test verifica **lo mismo que antes y algo más**: sigue exigiendo el toast de éxito y la
  desaparición de la orden tras el refresco, y añade la evidencia de que el refresco ocurre
  al cerrar. **No se relajó ninguna aserción; no se borró ninguna.**

### 2. `e2e/reintentos-escalado.spec.ts:189-210` — `AsignarBodegaModal` (misma rotura latente)

`maestroReasignaDesdeBodega` hacía `expect(modal).toBeHidden()` inmediatamente tras
confirmar: con la fase "resultado" el modal **sigue abierto** y ese `toBeHidden()` fallaría.
Adaptado igual: se comprueba el botón de manifiesto, se pulsa "Cerrar" y ahí sí
`toBeHidden()`. El reviewer no lo había auditado.

### 3. `e2e/devolucion-origen.spec.ts:118-126` — `DevolverATiendaModal` (misma rotura latente)

Idéntico caso: `toBeHidden()` justo tras confirmar, y la comprobación del apartado "Devueltas
a origen" dependía de un refresco que ahora ocurre al cerrar. Adaptado igual.

### Deuda AJENA encontrada al auditar (NO la toqué, no es de esta feature)

Los dos specs de arriba ya estaban desalineados con `dev` **antes** de la 148, por el
renombrado de la feature 139:

- `reintentos-escalado.spec.ts:203` busca dentro del modal un botón `"Asignar mensajero"`,
  pero el confirmar de `AsignarBodegaModal` se llama **"Asignar"** ("Asignar mensajero" es el
  TÍTULO del diálogo y el botón del listado). El localizador no resuelve.
- `devolucion-origen.spec.ts:114-121` usa `"Devolver a la tienda"`, pero la feature 139
  renombró ese modal a **"Enviar a la tienda"** (título y confirmar).

No los corrijo: es drift de otras features, no puedo ejecutarlos para validar el arreglo, y
tocar sus localizadores sin verificación sería peor que dejarlos declarados. **Queda
registrado aquí para quien retome los E2E.**

### Qué se pudo y qué NO se pudo verificar de los E2E (sin adornos)

- **Verificado:** `pnpm typecheck` **incluye** `e2e/**` (`tsconfig.json` toma `**/*.ts` y
  solo excluye `node_modules`), así que los 3 specs editados compilan: **0 errores**.
- **NO verificado — no los ejecuté:** no hay harness para levantarlos.
  `playwright.config.ts` arranca `pnpm dev` contra `localhost:3000` y los specs exigen una
  base de datos sembrada con usuarios por rol; los emails son **placeholders**
  (`admin-satelite@example.com`, `correct-password`, `REM-SEED-BODEGA-SATELITE`), el propio
  encabezado del spec dice "WRITTEN but NOT EXECUTED", y **no hay navegadores de Playwright
  instalados** en esta máquina (`~/.cache/ms-playwright` no existe). **No afirmo que pasen**:
  afirmo que están adaptados al flujo real y que compilan.

## Cambio extra autorizado — respaldo de `responsable` = `"—"` (U+2014)

Autorizado puntualmente por el humano sobre `lib/services/ManifiestoService.ts` (backend):

- Nueva constante exportada `RESPONSABLE_FALLBACK = "—"` (em dash); `ManifiestoService.armar`
  la usa en lugar de la cadena vacía cuando `findUsuarioNombre` devuelve `null` (usuario
  borrado entre la operación y la descarga). Sigue sin inventar textos de rol (§9.8).
- Tests (`tests/unit/services/manifiesto-service.test.ts`, **+2**, 32 → 34): "sin nombre
  resoluble del ejecutor, responsable cae al guion largo y no a cadena vacía" (fija el
  literal U+2014 y descarta `""`) y "con mensajero asignado, el respaldo del actor no
  contamina responsable" (el respaldo es SOLO del actor, no de la columna entera).
- Corregido de paso un colapso del helper de test: `opts.nombre ?? ACTOR_NOMBRE` convertía un
  `nombre: null` explícito en el nombre real, así que el caso ni siquiera era expresable.
  Ahora distingue `undefined` de `null`. **Cierra el menor 5 del review.**
- Nada más de ese archivo ni del resto del backend se tocó.

## Números medidos tras las correcciones

| | Punto de partida (review) | Después de las correcciones | Delta |
|---|---|---|---|
| `pnpm typecheck` | 0 errores | **0 errores** (incluye `e2e/**`) | 0 |
| `pnpm lint` | 0 errores / 145 warnings | **0 errores / 145 warnings** | 0 |
| `pnpm test --run` | 524 archivos / 5400 tests, 0 fallos | **524 archivos / 5402 tests, 0 fallos** | +2 tests, 0 regresiones |
| `./init.sh` | verde | **verde (exit 0)**, con la suite 524/5402 | — |
| E2E Playwright | no ejecutables | **no ejecutados** (ver arriba) | — |

**Flake observada, ajena a la 148:** en UNA corrida de `./init.sh` cayó
`tests/unit/guards/no-embalaje.test.ts` (un guard que recorre el árbol de archivos del repo)
bajo carga; aislado da 1/1 verde y las dos corridas completas posteriores
(`pnpm test --run` y `./init.sh`) dieron 524/524 archivos y 5402/5402 tests. Mismo patrón que
la flake que anotó el reviewer (su menor 7) con otro archivo: suites dependientes de I/O y
tiempo bajo carga alta. No toca nada del diff de la 148.

## Deuda que queda abierta tras esta vuelta

1. Los 3 specs E2E adaptados **no se pudieron ejecutar** (sin seed, sin login por rol, sin
   navegadores). Su verde real sigue pendiente de un entorno E2E.
2. El drift ajeno de `reintentos-escalado.spec.ts` y `devolucion-origen.spec.ts` (nombres de
   botón de la feature 139) sigue sin corregir, por decisión explícita.
3. Menores 1, 2, 3, 4, 6 y 8 del review: fuera de esta corrección (el mapa consolidado y
   `history.md` son cierre del leader; los demás son del backend o decisiones de producto).
