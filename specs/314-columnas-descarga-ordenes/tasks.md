# Ficha 314 — la descarga del listado de órdenes deja elegir qué columnas salen · tasks.md

Convenciones: `[P]` = paralelizable con las demás tareas marcadas igual **dentro de su banda**.
Cada tarea declara de qué depende, qué requisitos cubre, qué archivos toca y su criterio de hecho.

**Nada de esta ficha toca** `db/`, `lib/types/`, `lib/services/`, `lib/actions/`,
`lib/repositories/` ni las otras 24 tablas del `DataTable`. Si una tarea necesita tocarlos, el
diseño falló: se para y se pregunta.

Gate por banda: `./init.sh --rapido`. Gate final: `./init.sh` completo (T17).

---

## Banda 0 — puerta

### [ ] T0 — Aprobación humana
Depende de: nada. Requisitos: —.
El humano lee los tres archivos de `specs/314-columnas-descarga-ordenes/` y responde **las cuatro
preguntas abiertas de `requirements.md`** y **las tres técnicas del final de este archivo**.
**Hecho cuando**: la ficha pasa a `spec_ready` → `in_progress` con las respuestas anotadas en
`progress/`, y en particular con los **22 encabezados confirmados** (T2 no puede empezar sin eso:
los encabezados son contrato y hay una guardia que exige una aserción literal de orden).

---

## Banda 1 — cimientos (los tres van en paralelo)

### [ ] T1 [P] — Módulo puro generalizado
Depende de: T0. Requisitos: R16, R20, R26, R27, R28, R29, R30, R31, R35.
Archivos: **crear** `lib/columnas/preferencia-columnas.ts`.
Contenido: las siete funciones del design §4, con `ordenEfectivo` implementando el anclaje del §3.
Sin React, sin dominio, sin `ManifiestoFlujo`, sin `XlsxColumn`. Nunca lanza. Cabecera que explique
(a) por qué se guardan las OCULTAS y no las visibles —texto heredado de
`lib/manifiesto/preferencia-columnas.ts:8-22`, que sigue rigiendo— y (b) por qué el orden guardado
es **parcial** y se enmienda con el catálogo.
**Hecho cuando**: `pnpm run typecheck` y `pnpm run lint` verdes; el módulo no importa nada de
`components/`, `hooks/`, `app/`, `lib/types/` ni `lib/manifiesto/`; `guardar` con `orden` vacío
produce **exactamente** `{"ocultas":[…]}` (sin la clave `orden`).

### [ ] T2 [P] — Catálogo de órdenes a 22 columnas
Depende de: T0 (respuestas a las preguntas abiertas 1 y 4). Requisitos: R11, R12, R13, R14, R15, R17.
Archivos: **modificar** `app/(app)/ordenes/_components/ordenes-descarga-columnas.ts`.
Contenido: las siete altas del design §8 en su posición; `filaDescargaOrden` las proyecta con
`?? null`; los dos importes y las dos fechas **pasan tal cual**, sin `Number(`, sin `parseFloat(`,
sin `.toFixed(` y sin `new Date(` para ellas. Añadir `export const AMBITO_DESCARGA_ORDENES = "ordenes";`.
La constante `COLUMNAS_DESCARGA_ORDENES` **no cambia de nombre ni de archivo**.
**Hecho cuando**: `pnpm exec vitest run tests/unit/descarga/columnas-sensibles.guardia.test.ts
tests/unit/guards/ordenes-columnas-money-safe.guardia.test.ts` verde **sin haber tocado esos dos
archivos**, y `pnpm run typecheck` verde.

### [ ] T3 [P] — El generador del manifiesto respeta el orden recibido
Depende de: T0. Requisitos: R20, R21.
Archivos: **modificar** `lib/utils/manifiesto-xlsx.ts` (`columnasAEmitir`).
Contenido: mapear las claves **en el orden recibido**, quedándose con las publicadas; sin claves que
casen, degradar al catálogo completo (194/R13 intacto); `throw` sin filas intacto. Ampliar el
docstring diciendo que esto **deroga 194/R8** por la decisión del humano del 2026-08-28.
**Hecho cuando**: `pnpm exec vitest run tests/unit/utils/manifiesto-xlsx.test.ts` verde **sin tocar
ese archivo** (el que sí cambia es `manifiesto-xlsx-columnas.test.ts`, en T16).

### [ ] T4 [P] — `ambitoColumnas` en el contrato de la tabla
Depende de: T0. Requisitos: R33, R35.
Archivos: **modificar** `components/shared/DataTable.tsx`; **modificar**
`tests/unit/components/datatable-descarga-contrato.test.ts`.
Contenido: quinto miembro `ambitoColumnas?: string` documentado como «ausente ⇒ sin selector»; se
pasa a `DescargarDatasetButton`. En la guardia: ampliar la lista esperada de miembros **y añadir**
una aserción de que el miembro nuevo se declara `string` a secas (nada de tipos de dominio).
**Hecho cuando**: la guardia pasa con la aserción nueva incluida y sigue prohibiendo los imports de
`lib/actions|services|repositories`, `app/` y `lib/types/*` distintos de `descarga`.

---

## Banda 2 — maquinaria de cliente

### [ ] T5 — Hook genérico
Depende de: T1. Requisitos: R7, R9, R19, R22, R23, R24, R25, R32, R33.
Archivos: **crear** `hooks/usePreferenciaColumnas.ts`.
Contenido: design §5. Snapshot = **string crudo** (derivar el array en `getSnapshot` es bucle
infinito de render), `getServerSnapshot` = `null`, suscripción a `storage` + `ordenex:columnas-cambio`,
derivaciones en `useMemo`, `alternar` con guard de mínimo, `mover` no-op en los extremos y que nunca
toca `ocultas`, `restablecer` que borra las dos listas. Con `clave === null`: devuelve `publicadas`
y no escribe.
**Hecho cuando**: typecheck + lint verdes (sin violar `react-hooks/set-state-in-effect` ni
`exhaustive-deps`) y un render de prueba con dos superficies montadas no entra en bucle.

### [ ] T6 — Envoltorio del hook del manifiesto
Depende de: T5. Requisitos: R10, R21, R30.
Archivos: **modificar** `hooks/usePreferenciaColumnasManifiesto.ts`; **modificar**
`lib/manifiesto/preferencia-columnas.ts`.
Contenido: el módulo del manifiesto queda con `claveColumnas(flujo)` **idéntica** (mismo prefijo
`ordenex:manifiesto-columnas:`, byte por byte) y el descriptor del ámbito; el hook fija clave,
`COLUMNAS_MANIFIESTO` y `(c) => c.key`, y expone además `mover`. Sin envoltorios que solo usen los
tests.
**Hecho cuando**: `pnpm exec vitest run tests/components/ColumnasManifiestoCatalogoAbierto.test.tsx`
verde **sin tocar ese archivo**, y `grep` confirma que el prefijo de la clave no cambió.

### [ ] T7 — Selector genérico con reordenar
Depende de: T5. Requisitos: R2, R3, R18, R22, R23, R25.
Archivos: **crear** `components/shared/ColumnasPopover.tsx`.
Contenido: design §6. Fila = `Checkbox` + `Label` + `Subir <etiqueta>` / `Bajar <etiqueta>`
(`ChevronUp`/`ChevronDown`), extremos deshabilitados, foco al botón contrario cuando el pulsado se
deshabilita. Itera `publicadas` **en el orden efectivo**. Pie con «Restablecer» y aviso de mínimo.
**Hecho cuando**: typecheck + lint verdes, **sin añadir ninguna dependencia a `package.json`**, y ni
el componente ni sus pruebas afirman un número de columnas.

### [ ] T8 — Envoltorio del selector del manifiesto
Depende de: T7. Requisitos: R21, R30.
Archivos: **modificar** `components/shared/ColumnasManifiestoPopover.tsx`.
Contenido: pasa el ámbito del manifiesto a `ColumnasPopover` conservando literalmente
`aria-label="Elegir columnas del manifiesto"`, el título «Columnas del manifiesto» y el formato de
etiqueta `Etiqueta legible (clave_maquina)`.
**Hecho cuando**: `pnpm exec vitest run tests/components/ColumnasManifiestoPopover.test.tsx` verde
**sin tocar ese archivo**, incluida la aserción literal `{"ocultas":[]}` de «Restablecer».

### [ ] T9 — El control común aplica la preferencia
Depende de: T4, T5, T7. Requisitos: R1, R4, R5, R6, R20, R33, R34.
Archivos: **modificar** `components/shared/DescargarDatasetButton.tsx`.
Contenido: clave = `ordenex:descarga-columnas:<ambito>` o `null`; `usePreferenciaColumnas` con el
accesor **declarado a nivel de módulo**; `construirDescarga` recibe las columnas **visibles y en
orden**; el selector se monta solo si hay ámbito, como control **paralelo** al botón (abrirlo no
descarga; el botón descarga en un click con lo guardado). No se tocan `titulo`, `obtenerFilas`,
`formatos`, el `import()` dinámico ni el guard de carrera.
**Hecho cuando**: `pnpm exec vitest run tests/components/descarga/` verde **sin tocar ninguno de
esos archivos** (24 tablas sin ámbito siguen igual).

### [ ] T10 — Encendido en órdenes
Depende de: T2, T9. Requisitos: R1, R10.
Archivos: **modificar** `app/(app)/ordenes/_components/OrdenesModule.tsx`.
Contenido: **una línea** —`ambitoColumnas: AMBITO_DESCARGA_ORDENES`— dentro de la configuración de
descarga que ya se construye en el render. Nada más: ni `localStorage`, ni estado nuevo, ni props
nuevas.
**Hecho cuando**: `pnpm exec vitest run tests/components/OrdenesDescarga.test.tsx
tests/components/descarga/ControlDescargaTransversal.test.tsx` verde **sin tocar esos archivos**
(el barrido estático prohíbe `localStorage` en un módulo de `app/` con descarga).

---

## Banda 3 — verificación

### [ ] T11 [P] — Tests del orden efectivo
Depende de: T1. Requisitos: R16, R20, R26, R27, R28, R29, R30, R31, R35.
Archivos: **crear** `tests/unit/columnas/orden-efectivo.test.ts`.
Casos: la tabla del design §3 entera (siete filas), con catálogos **sintéticos** de 3 y de 5
columnas; dos columnas nuevas consecutivas conservan su orden relativo; matriz de degradación
(JSON inválido, no objeto, `orden` no array, elementos no string, duplicados, `ocultas` que taparía
todo, `localStorage` que lanza) y en todas se puede descargar; el literal legado
`{"ocultas":["beta"]}` resuelve al orden del catálogo con `beta` oculta.
**Hecho cuando**: pasan, ningún aserto afirma un número de columnas, y **una mutación del anclaje**
(insertar al final en vez de tras el ancla) pone rojo al menos dos casos.

### [ ] T12 [P] — Tests del catálogo de órdenes
Depende de: T2. Requisitos: R11, R12, R13, R14, R15, R17.
Archivos: **modificar** `tests/unit/components/ordenes-descarga-columnas.test.ts`.
Contenido: las dos aserciones de orden (claves y encabezados) a 22 entradas, escritas a mano;
`telefonoDest`, `notas` y `peso` **salen** de la lista de prohibidas (siguen prohibidos ids,
`deletedAt`, `updatedAt`, `relaciones`) con un comentario que diga por qué; caso nuevo: los dos
importes se emiten como **el mismo string** que trae el DTO (`"1129.50"` sigue siendo `"1129.50"`,
no `1129.5`); caso nuevo: `"2026-01-01"` en las dos fechas sale idéntico; caso nuevo: las siete sin
dato emiten `null` y nunca `"—"`; caso nuevo: las quince de hoy conservan su **orden relativo** como
subsecuencia.
**Hecho cuando**: pasan y `tests/unit/descarga/columnas-asercion-de-orden.guardia.test.ts` sigue
encontrando la aserción que **nombra** `COLUMNAS_DESCARGA_ORDENES`.

### [ ] T13 [P] — Tests de reordenar
Depende de: T7. Requisitos: R18, R19, R21, R22, R23, R24, R25.
Archivos: **crear** `tests/components/ColumnasPopoverReordenar.test.tsx`.
Casos: cada fila ofrece subir y bajar (R18); mover reubica en la lista **y** persiste el orden
(R19); la primera no puede subir y la última no puede bajar (R22, R23); mover no cambia el estado
marcado de ninguna casilla (R24); se mueve igual una desmarcada (R25); y **el mismo componente
montado con los dos ámbitos** —manifiesto y descarga— ofrece lo mismo (R21).
**Hecho cuando**: pasan en jsdom, se afirman por nombre accesible, y ningún caso afirma un total de
columnas.

### [ ] T14 — Tests de la descarga de órdenes
Depende de: T10. Requisitos: R1, R2, R3, R4, R5, R6, R7, R8, R9, R10, R16, R20, R32, R33, R34.
Archivos: **crear** `tests/components/OrdenesDescargaColumnas.test.tsx`.
Casos: control propio junto al botón de descarga (R1); una casilla por columna del catálogo,
derivado de la constante (R2); el nombre de cada casilla **es** el encabezado del archivo (R3); una
marcada viaja y una desmarcada no (R4, R5); un solo click descarga con lo guardado, sin paso
intermedio (R6); con una sola marcada la casilla se deshabilita y el click no la desmarca (R7);
«Restablecer» deja todas marcadas en orden de catálogo (R8); lo elegido sobrevive a remontar (R9);
cambiar órdenes no altera la preferencia de un flujo de manifiesto ni al revés (R10); sin
preferencia salen las 22 en orden de catálogo (R16); con orden guardado la cabecera sale en **ese**
orden (R20); dos selectores del mismo ámbito montados a la vez se sincronizan sin recargar (R32);
una tabla **sin ámbito** no muestra selector y emite todas sus columnas (R33); con preferencia
guardada, el nombre del archivo, el título de la hoja y las filas del dataset **no cambian** (R34).
**Hecho cuando**: pasan y `tests/components/OrdenesDescarga.test.tsx` sigue verde **sin tocarse**.

### [ ] T15 — Guardia de ámbitos
Depende de: T10. Requisitos: R10, R33.
Archivos: **crear** `tests/unit/descarga/ambito-columnas.guardia.test.ts`.
Contenido: barrido estático de `app/` y `components/` (sin comentarios, con el `quitarComentarios`
de siempre): todo `ambitoColumnas:` declarado casa `^[a-z0-9-]+$` y **ningún identificador se repite
en dos módulos** —dos tablas compartiendo preferencia sin saberlo es el fallo mudo que esta guardia
existe para cazar—; autocomprobación con un canario (órdenes declara el suyo) y un negativo
sintético.
**Hecho cuando**: pasa, **no** censa una lista fija de tablas (encender la siguiente debe seguir
costando una línea) y su autocomprobación falla con mensaje explícito si el detector se rompe.

### [ ] T16 — Regresión del manifiesto
Depende de: T3, T6, T8. Requisitos: R21, R30.
Archivos: **modificar** `tests/unit/utils/manifiesto-xlsx-columnas.test.ts` (solo el caso de orden
invertido, con la derogación de 194/R8 escrita en su cabecera); **modificar**
`tests/unit/manifiesto/preferencia-columnas.test.ts` (re-cableado al módulo genérico, **los ocho
casos y el bloque de etiquetas se conservan**); **añadir un caso** a
`tests/components/DescargarManifiestoColumnas.test.tsx` (con orden guardado, el generador recibe las
claves en ese orden).
**Hecho cuando**: `pnpm exec vitest run tests/components/DescargarManifiestoButton.test.tsx
tests/components/ColumnasManifiestoPopover.test.tsx
tests/components/ColumnasManifiestoCatalogoAbierto.test.tsx tests/components/ManifiestoFlujos.test.tsx`
verde **sin haber tocado ninguno de esos cuatro archivos**, y los siete casos previos de
`DescargarManifiestoColumnas.test.tsx` intactos.

### [ ] T17 — Trazabilidad y gate
Depende de: T11, T12, T13, T14, T15, T16. Requisitos: todos.
Archivos: **crear** `progress/impl_314.md`.
Contenido: la tabla de abajo con la salida real de cada test pegada, `git diff --stat` demostrando
que no se tocó `db/`, `lib/types/`, `lib/services/`, `lib/actions/` ni ninguna otra tabla, y la nota
de qué pasa con las preferencias ya guardadas (design §2).
**Hecho cuando**: `./init.sh` completo verde (con `INIT_EXIT=$?` escrito **dentro** del log, no
canalizado por `tail`) y los 35 requisitos con test.

---

## Mapa de trazabilidad — `R<n>` → test

Un requisito sin test es un fallo de la feature. «(sin tocar)» = ese archivo **debe pasar sin
modificarse**, y eso es parte de la evidencia.

| R | Test |
| --- | --- |
| R1 | `tests/components/OrdenesDescargaColumnas.test.tsx` :: «ofrece un control propio junto al botón de descarga» |
| R2 | `tests/components/OrdenesDescargaColumnas.test.tsx` :: «presenta una casilla por columna del catálogo, derivada de la constante» |
| R3 | `tests/components/OrdenesDescargaColumnas.test.tsx` :: «el nombre de cada casilla es el encabezado con el que la columna sale en el archivo» |
| R4 | `tests/components/OrdenesDescargaColumnas.test.tsx` :: «una columna marcada viaja en la cabecera del archivo» |
| R5 | `tests/components/OrdenesDescargaColumnas.test.tsx` :: «una columna desmarcada no viaja en el archivo» |
| R6 | `tests/components/OrdenesDescargaColumnas.test.tsx` :: «un solo click descarga con lo guardado, sin confirmar columnas» |
| R7 | `tests/components/OrdenesDescargaColumnas.test.tsx` :: «con una sola marcada, la casilla se deshabilita y el click no la desmarca» |
| R8 | `tests/components/OrdenesDescargaColumnas.test.tsx` :: «Restablecer deja todas marcadas y en el orden del catálogo» |
| R9 | `tests/components/OrdenesDescargaColumnas.test.tsx` :: «lo elegido sigue vigente tras remontar» |
| R10 | `tests/components/OrdenesDescargaColumnas.test.tsx` :: «cambiar órdenes no altera la preferencia de un flujo de manifiesto» + `tests/unit/descarga/ambito-columnas.guardia.test.ts` :: «ningún identificador de ámbito se repite» |
| R11 | `tests/unit/components/ordenes-descarga-columnas.test.ts` :: «declara sus CLAVES en el mismo orden que sus encabezados» (22 entradas, las siete altas incluidas) |
| R12 | `tests/unit/components/ordenes-descarga-columnas.test.ts` :: «los dos importes salen como el mismo string que trae el servidor» + `tests/unit/guards/ordenes-columnas-money-safe.guardia.test.ts` (sin tocar) |
| R13 | `tests/unit/components/ordenes-descarga-columnas.test.ts` :: «el día de reparto y la fecha de reprogramación salen idénticos, sin construir ninguna fecha» |
| R14 | `tests/unit/components/ordenes-descarga-columnas.test.ts` :: «las siete columnas nuevas sin dato emiten celda vacía, nunca el guion de pantalla» |
| R15 | `tests/unit/components/ordenes-descarga-columnas.test.ts` :: «no expone identificadores internos ni banderas de borrado» + `tests/unit/descarga/columnas-sensibles.guardia.test.ts` (sin tocar) |
| R16 | `tests/unit/columnas/orden-efectivo.test.ts` :: «sin preferencia devuelve las publicadas en su orden» + `tests/components/OrdenesDescargaColumnas.test.tsx` :: «sin preferencia el archivo lleva el catálogo completo» |
| R17 | `tests/unit/components/ordenes-descarga-columnas.test.ts` :: «las quince columnas de hoy conservan su orden relativo» |
| R18 | `tests/components/ColumnasPopoverReordenar.test.tsx` :: «cada columna ofrece subir y bajar» |
| R19 | `tests/components/ColumnasPopoverReordenar.test.tsx` :: «mover una columna la reubica en la lista y persiste el orden» |
| R20 | `tests/components/OrdenesDescargaColumnas.test.tsx` :: «con un orden guardado la cabecera sale en ese orden» + `tests/unit/utils/manifiesto-xlsx-columnas.test.ts` :: «emite las columnas en el orden recibido» |
| R21 | `tests/components/ColumnasPopoverReordenar.test.tsx` :: «el mismo selector ofrece reordenar en los dos ámbitos» + `tests/components/DescargarManifiestoColumnas.test.tsx` :: «con orden guardado, el generador recibe las claves en ese orden» |
| R22 | `tests/components/ColumnasPopoverReordenar.test.tsx` :: «la primera de la lista no puede subir» |
| R23 | `tests/components/ColumnasPopoverReordenar.test.tsx` :: «la última de la lista no puede bajar» |
| R24 | `tests/components/ColumnasPopoverReordenar.test.tsx` :: «mover no cambia el estado marcado de ninguna columna» |
| R25 | `tests/components/ColumnasPopoverReordenar.test.tsx` :: «una columna desmarcada también se mueve» |
| R26 | `tests/unit/columnas/orden-efectivo.test.ts` :: «una clave publicada que no figura en lo guardado sale visible sin migrar nada» + `tests/components/ColumnasManifiestoCatalogoAbierto.test.tsx` (sin tocar) |
| R27 | `tests/unit/columnas/orden-efectivo.test.ts` :: «una columna nueva se coloca tras su predecesora de catálogo presente en el orden del usuario» |
| R28 | `tests/unit/columnas/orden-efectivo.test.ts` :: «sin ninguna predecesora presente, la columna nueva va al principio» |
| R29 | `tests/unit/columnas/orden-efectivo.test.ts` :: «una clave guardada que ya no corresponde a ninguna columna publicada se ignora» |
| R30 | `tests/unit/columnas/orden-efectivo.test.ts` :: «una preferencia guardada antes de esta ficha sigue valiendo: mismas ocultas, orden del catálogo» + `tests/components/ColumnasManifiestoPopover.test.tsx` y `tests/components/DescargarManifiestoColumnas.test.tsx` (siete casos previos, sin tocar) |
| R31 | `tests/unit/columnas/orden-efectivo.test.ts` :: «preferencia ilegible, de otra forma o que dejaría el archivo sin columnas se procede como si no hubiera, y nunca se impide la descarga» |
| R32 | `tests/components/OrdenesDescargaColumnas.test.tsx` :: «dos selectores del mismo ámbito se sincronizan sin recargar la página» |
| R33 | `tests/components/OrdenesDescargaColumnas.test.tsx` :: «una tabla sin ámbito no muestra selector y emite todas sus columnas» + `tests/unit/components/datatable-descarga-contrato.test.ts` :: «la configuración de descarga solo expone título, columnas, obtenerFilas, formatos y ámbito» |
| R34 | `tests/components/OrdenesDescarga.test.tsx` (ocho casos, **sin tocar**) + `tests/components/OrdenesDescargaColumnas.test.tsx` :: «con preferencia guardada no cambian el nombre del archivo, la hoja ni las filas del dataset» |
| R35 | `tests/unit/columnas/orden-efectivo.test.ts` :: «el mecanismo opera igual con un catálogo de 3 y con uno de 5» + `tests/unit/descarga/ambito-columnas.guardia.test.ts` (no censa lista fija) |

---

## Preguntas técnicas abiertas (del análisis del diseño)

**Amplían, no repiten, las cuatro de `requirements.md`.** T0 no cierra sin respuesta a las tres.

**Q5 — Ampliar la guardia del contrato del `DataTable`.** `ambitoColumnas` entra como quinto miembro
de `DataTableDescarga`, y eso obliga a tocar
`tests/unit/components/datatable-descarga-contrato.test.ts:59`, que hoy afirma la lista **exacta** de
miembros. La alternativa —colgarlo de `DataTableProps` en vez de de `DataTableDescarga`— no tocaría
esa guardia, pero permitiría declarar un ámbito en una tabla que no ofrece descarga, un estado que
no significa nada. Propuesta: dentro de `DataTableDescarga`, ampliando la guardia **y añadiéndole**
la aserción de que el miembro es un `string` sin dominio. ¿Se ratifica tocar esa guardia?

**Q6 — Rótulos del selector en órdenes.** Son contrato de test. Propuesta:
`aria-label="Elegir columnas de la descarga"` en el disparador y «Columnas del archivo» como título
del popup. Los del manifiesto **no se tocan** («Elegir columnas del manifiesto» / «Columnas del
manifiesto»), para que sus tests sigan verdes sin modificarse. ¿Se aceptan los dos textos nuevos?

**Q7 — Ratificación de una consecuencia, no una decisión.** R11 + R16 juntas implican que **quien
nunca abra el selector pasa de 15 a 22 columnas** en su archivo. No es evitable sin romper el
mecanismo: con una lista de exclusión, una columna no puede «nacer oculta» —para eso haría falta la
allowlist que la 194 descartó por dejar invisibles para siempre las columnas futuras—. Se anota para
que lo ratifique quien va a recibir esa hoja por correo, no para reabrir R11 ni R16.

**Nota informativa (no bloquea).** El manifiesto pasa a poder salir reordenado por su usuario. La
exposición no es nueva —desde la 194 ya se podían ocultar columnas, así que la posición dejó de ser
estable entonces— y solo cambia para quien lo pide, en su propio dispositivo. Se deja dicho por si
alguien procesa el manifiesto con una plantilla de posiciones fijas.

---

## Orden sugerido

```
T0
 ├─ T1 [P] ─┬─ T5 ─┬─ T6 ────────────┐
 │          │      ├─ T7 ─┬─ T8 ─────┤
 │          │      │      └─ T13 [P] │
 │          └─ T11 [P]               │
 ├─ T2 [P] ─┬─ T12 [P]               │
 │          └──────────┐             │
 ├─ T3 [P] ────────────┼─────────────┴─ T16
 └─ T4 [P] ── T9 ── T10 ─┬─ T14
                         └─ T15
                                     └─ T17
```
