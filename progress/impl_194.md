# Feature 194 — Columnas del manifiesto elegibles por acción · bitácora de implementación

> Zona: frontend · rama `ux` (sin rama propia ni worktree, por decisión del leader: el working
> tree tiene WIP sin commitear de la 193 y del rediseño ux). Sin commit: lo hace el leader.
> Fecha: 2026-08-10.

## 1. Archivos

### Nuevos (producción)

| Archivo | Qué es | Tasks |
| --- | --- | --- |
| `lib/manifiesto/preferencia-columnas.ts` | Módulo PURO: `claveColumnas`, `leerCrudoColumnas`, `sanearOcultas`, `columnasVisibles`, `guardarOcultas`. Recibe `publicadas` por parámetro; NO importa el catálogo (R23). | T1 |
| `lib/manifiesto/etiquetas-columnas.ts` | `etiquetaColumna(header)`, mapa `Record<string,string>` con las 12 de D-A, fallback al propio header (R5). | T2 |
| `lib/manifiesto/columnas-publicadas.ts` | `COLUMNAS_MANIFIESTO` **movido** desde `lib/utils/manifiesto-xlsx.ts` (mismas entradas, mismo orden, comentario íntegro). Ver §4: DESVIACIÓN de design §2. | T8 (fix) |
| `hooks/usePreferenciaColumnasManifiesto.ts` | `useSyncExternalStore` con snapshot = STRING crudo; `getServerSnapshot` = `null`; suscripción a `storage` + `ordenex:manifiesto-columnas-cambio`; derivación en `useMemo`; `alternar` con guard de última visible; `restablecer`. | T6 |
| `components/shared/ColumnasManifiestoPopover.tsx` | `Popover` de `@base-ui/react/popover` (patrón `NotificationsBell`), `Checkbox` + `Label` por columna publicada, texto `Etiqueta (clave_maquina)`, "Restablecer", última casilla deshabilitada + aviso de mínimo. | T7 |

### Modificados (producción)

| Archivo | Cambio |
| --- | --- |
| `lib/utils/manifiesto-xlsx.ts` | 2.º parámetro OPCIONAL `clavesVisibles?: readonly string[]`; helper `columnasAEmitir` que filtra `COLUMNAS_MANIFIESTO` (nunca la entrada); 0 resultantes → conjunto completo (R13, sin propagar el throw de `buildXlsxRows`); re-exporta `COLUMNAS_MANIFIESTO` desde el módulo nuevo; comentario de cabecera AMPLIADO, no reescrito. `toRow` y el throw por `filas.length === 0` intactos. |
| `components/shared/DescargarManifiestoButton.tsx` | Grupo `flex items-center gap-1` con el `Button` actual + `<ColumnasManifiestoPopover flujo={flujo} />`; consume `usePreferenciaColumnasManifiesto(flujo)`; única línea de `handleClick` que cambia: `buildManifiestoXlsx(result.filas, clavesVisibles)`. `className` sigue yendo al `Button`; sigue devolviendo `null` con selección vacía; import dinámico del generador conservado. |

### Nuevos (tests)

- `tests/unit/manifiesto/preferencia-columnas.test.ts` — 10 tests
- `tests/unit/utils/manifiesto-xlsx-columnas.test.ts` — 8 tests
- `tests/components/ColumnasManifiestoPopover.test.tsx` — 8 tests
- `tests/components/DescargarManifiestoColumnas.test.tsx` — 7 tests

### NO tocados (verificado con `git status --porcelain`, salida vacía)

`lib/services/`, `lib/actions/manifiesto.ts`, `lib/types/manifiesto.ts`, `app/api/`, `db/schema.prisma`,
y los 3 call-sites del botón (`ManifiestoResultado.tsx`, `OrdenesCargaResumen.tsx`,
`RecepcionSateliteModule.tsx` — decisión D4). Cero migraciones, cero dependencias nuevas.

## 2. Mapa R1..R26 → test

| Req | Test |
| --- | --- |
| R1 | `ColumnasManifiestoPopover.test.tsx` › "R1 — ofrece un control propio que abre la elección de columnas del manifiesto" |
| R2 | `ColumnasManifiestoPopover.test.tsx` › "R2 — presenta una casilla por columna publicada, en el orden del archivo" |
| R3 | `ColumnasManifiestoPopover.test.tsx` › "R3 — refleja marcada la columna visible y desmarcada la oculta según lo guardado" |
| R4 | `ColumnasManifiestoPopover.test.tsx` › "R4 — el nombre accesible de cada casilla contiene la clave máquina de su cabecera" |
| R5 | `ColumnasManifiestoPopover.test.tsx` › "R5 — una columna sin etiqueta declarada se muestra con su propia clave máquina" + `preferencia-columnas.test.ts` › "cae a la propia cabecera cuando no hay etiqueta declarada (R5)" |
| R6 | `ColumnasManifiestoPopover.test.tsx` › "R6 — «Restablecer» deja todas las columnas publicadas marcadas y guarda la lista vacía" |
| R7 | `manifiesto-xlsx-columnas.test.ts` › "R7/R9: emite en la cabecera las claves máquina pedidas y ninguna de las ocultas" + "R7: los datos de la fila viajan bajo la columna visible que les corresponde" + "R7: una clave DESCONOCIDA se ignora sin romper y no añade columna alguna" |
| R8 | `manifiesto-xlsx-columnas.test.ts` › "R8: con las claves en orden INVERTIDO conserva el orden relativo de COLUMNAS_MANIFIESTO" + `DescargarManifiestoColumnas.test.tsx` › "el generador recibe las claves visibles, en el orden RELATIVO de las columnas publicadas" |
| R9 | `manifiesto-xlsx-columnas.test.ts` › "R7/R9: emite en la cabecera las claves máquina pedidas y ninguna de las ocultas" |
| R10 | `DescargarManifiestoColumnas.test.tsx` › "R10 — un SOLO click en el botón descarga con la preferencia guardada, sin abrir el selector" |
| R11 | `DescargarManifiestoColumnas.test.tsx` › "R11 — el nombre del archivo NO cambia al exportar un subconjunto de columnas" |
| R12 | `ColumnasManifiestoPopover.test.tsx` › "R12 — con una sola columna marcada, esa casilla se deshabilita y el aviso de mínimo es visible" + "R12 — sin llegar al mínimo, el aviso no se muestra y las casillas quedan operables" |
| R13 | `manifiesto-xlsx-columnas.test.ts` › "R13: una selección VACÍA emite todas las columnas publicadas en vez de fallar" + "R13: una selección de la que no casa NINGUNA clave degrada a todas las publicadas" |
| R14 | `preferencia-columnas.test.ts` › "guarda las ocultas bajo la clave del flujo y las recupera (R14)" + `DescargarManifiestoColumnas.test.tsx` › "R14, R15 — desmarcar una columna persiste bajo la clave del flujo y sigue vigente tras remontar" |
| R15 | `DescargarManifiestoColumnas.test.tsx` › "R14, R15 — desmarcar una columna persiste bajo la clave del flujo y sigue vigente tras remontar" |
| R16 | `preferencia-columnas.test.ts` › "guardar en carga_masiva no altera la preferencia de asignacion_satelite (R16)" + `DescargarManifiestoColumnas.test.tsx` › "R16 — cambiar carga_masiva NO altera lo que ofrece asignacion_satelite" |
| R17 | `preferencia-columnas.test.ts` › "sin valor guardado deja visibles todas las columnas publicadas (R17)" |
| R18 | `DescargarManifiestoColumnas.test.tsx` › "R18 — dos botones del MISMO flujo montados a la vez se sincronizan sin recargar la página" |
| R19 | `preferencia-columnas.test.ts` › "descarta una clave guardada que ya no esta entre las publicadas (R19)" |
| R20 | `preferencia-columnas.test.ts` › "si lo guardado ocultaria todas las publicadas, quedan todas visibles (R20)" |
| R21 | `preferencia-columnas.test.ts` › "con un almacenamiento que lanza, lee null, guarda sin romper y deja todas visibles (R21)" (cubre además JSON inválido, ocultas no-array y elementos no-string) |
| R22 | `preferencia-columnas.test.ts` › "una columna publicada que no figura en la lista guardada sale visible (R22)" |
| R23 | **Revisión de asertos** (§3) + los detectores vigentes verdes SIN modificarse: `tests/unit/utils/manifiesto-xlsx.test.ts`, `tests/unit/types/intentos-no-alcance.test.ts` |
| R24 | `manifiesto-xlsx-columnas.test.ts` › "R24: sin segundo parámetro emite todas las columnas publicadas, como hasta hoy" + `tests/unit/utils/manifiesto-xlsx.test.ts` entero, verde sin tocarse |
| R25 | `DescargarManifiestoColumnas.test.tsx` › "R25 — obtenerManifiesto se llama con el MISMO input de hoy, sin información de columnas" + `git status` vacío en `lib/services/`, `lib/actions/manifiesto.ts`, `lib/types/manifiesto.ts` |
| R26 | `tests/integration/api/ordenes-api-key-carga.route.test.ts` — 31 tests verdes, y ni el test ni `app/api/ordenes/api-key/carga/route.ts` tienen diff |

## 3. T11 — Invariantes no derogadas (comprobaciones ejecutadas)

1. **Zonas prohibidas sin diff (R25/R26).** `git status --porcelain -- lib/services lib/actions/manifiesto.ts lib/types/manifiesto.ts app/api db/schema.prisma` → salida VACÍA.
2. **Detectores de regresión intactos (R24, design §10).** `git status --porcelain` sobre
   `tests/unit/utils/manifiesto-xlsx.test.ts`, `tests/components/DescargarManifiestoButton.test.tsx`,
   `tests/components/ManifiestoFlujos.test.tsx`, `tests/components/GenerarGuiaModal.test.tsx` y
   `tests/unit/types/intentos-no-alcance.test.ts` → salida VACÍA, y los cinco pasan.
3. **R23 — ningún aserto de cardinalidad.** Grep de `toHaveLength(`, `.length).toBe` y `toBe(12)`
   en los 4 tests nuevos: 3 coincidencias, ninguna sobre el total de columnas —
   `getAllByRole("checkbox").length).toBeGreaterThan(0)`, `nombre.trim().length).toBeGreaterThan(0)`
   y un `toHaveLength(1)` sobre el argumento **filas** (`mock.calls[0][0]`), no sobre columnas.
   Todo "todas las publicadas" se deriva de `COLUMNAS_MANIFIESTO`, nunca de un literal.

## 4. DESVIACIÓN de design §2 — el reviewer debe pronunciarse

El diseño listaba 4 archivos nuevos y 2 modificados. Hay un **5.º archivo nuevo**:
`lib/manifiesto/columnas-publicadas.ts`.

**Por qué.** T8 dejó los 3 tests detectores en ROJO (20 fallos) con este error:

    Error: [vitest] No "COLUMNAS_MANIFIESTO" export is defined on the "@/lib/utils/manifiesto-xlsx" mock.

Los tres mockean `@/lib/utils/manifiesto-xlsx` con una factoría **total** (solo
`buildManifiestoXlsx` + `manifiestoFileName`). La decisión D4 (el selector vive DENTRO del botón)
hace que el hook y el popover importen `COLUMNAS_MANIFIESTO` de ese mismo módulo, y el acceso
ocurre en el `useMemo` de montaje: no hay orden de hooks, return temprano ni import dinámico que
lo esquive. Cumplir D4 y dejar esos mocks intactos era mutuamente excluyente **mientras el
catálogo viviera en el módulo del generador**.

**Las dos salidas y por qué se eligió esta.** La alternativa era parchear el mock de los 3 tests
con `importOriginal`. Se descartó: esos tests son el detector de regresión que design §10 y R24
designan, y modificarlos para que el código nuevo pase es exactamente lo que el detector existe
para impedir. El arreglo fue de PRODUCCIÓN: el catálogo de columnas publicadas es **dato**, no
maquinaria del generador, y la UI del selector debe poder leerlo sin depender del generador. Se
movió a `lib/manifiesto/columnas-publicadas.ts` (mismas entradas, mismo orden, comentario íntegro:
es un MOVIMIENTO, no una edición) y `lib/utils/manifiesto-xlsx.ts` lo **re-exporta**, así que
ningún consumidor existente cambia de import. Es coherente con design §2, que ya crea
`lib/manifiesto/` justamente para separar lo puro del generador.

**Prueba de que el desacoplamiento es real:** `tests/components/DescargarManifiestoColumnas.test.tsx`
usa la MISMA factoría total que los tests vigentes (no `importOriginal`) y pasa 7/7.

## 5. Gate — ./init.sh --rapido (salida real, 2026-08-10)

    ✓ typecheck paso
    ✖ 50 problems (0 errors, 50 warnings)   <- preexistentes (no-unused-vars en tests ajenos), 0 en archivos de la 194
    ✓ lint paso
    -> pnpm run test:rapido
     Test Files  245 passed (245)
          Tests  3130 passed (3130)
       Duration  190.65s
     Test Files  81 passed (81)              <- guardias
          Tests  1101 passed (1101)
       Duration  10.08s
    ✓ test:rapido paso
    ✓ todas las migraciones tienen down.sql
    ✓ .env presente
    == init OK ==

Corrida focalizada previa (los 4 tests nuevos + los 5 detectores):
`Test Files 9 passed (9) · Tests 87 passed (87)`.
Corrida del route handler de API key (R26): `Test Files 1 passed (1) · Tests 31 passed (31)`.

**Cero rojos.** No hay flakes que reportar.

## 6. Pendiente para el leader

- **`./init.sh` COMPLETO antes del PR** — tasks.md T12 lo exige y `--rapido` no lo sustituye.
  Aquí solo se corrió `--rapido`, por instrucción explícita del leader.
- **Commit**: el implementer no commitea. El working tree mezcla esta feature con WIP de la 193 y
  del rediseño `ux`; el commit debe seleccionar SOLO los archivos de la §1.
- **Ratificación de la desviación de §4** por el reviewer.

---

## 7. Cierre de los dos huecos de trazabilidad del reviewer (2026-08-10, post-review)

`progress/review_194.md` aprobó con reservas: cero bloqueantes, desviación de §4 RATIFICADA, y dos
huecos de cobertura PARCIAL. Ambos se cierran aquí **solo con tests**: producción no se tocó
(los archivos de `lib/manifiesto/`, `hooks/` y `components/shared/ColumnasManifiestoPopover.tsx`
conservan su mtime de la tanda anterior). No apareció ningún bug real al escribirlos.

### Hueco 1 — R5 estaba INFERIDO, no OBSERVADO

Antes: se probaba el fallback de `etiquetaColumna` en aislado y que ninguna casilla quedaba sin
texto, pero nunca se renderizaba el popover con una columna publicada SIN etiqueta declarada. El
cableado popover → `etiquetaColumna` → texto de la casilla no se observaba.

Ahora, en el archivo NUEVO `tests/components/ColumnasManifiestoCatalogoAbierto.test.tsx`, que
**mockea el catálogo** con uno sintético de 3 columnas —una de ellas, `columna_publicada_manana`,
sin entrada en el mapa de etiquetas—. Que el selector funcione con un catálogo que NO es el real
es, además, una demostración directa de R23:

- "R5 — una columna publicada SIN etiqueta declarada se rinde como casilla, nombrada con su clave
  máquina": aparece, su nombre accesible es exactamente
  `etiquetaColumna(header) + " (" + header + ")"` (derivado, nunca literal), no está vacío ni
  contiene `undefined`; y las que SÍ tienen etiqueta se rinden con la etiqueta legible —con un
  aserto explícito de que su nombre NO es `header (header)`, o sea que el mapa se está aplicando
  de verdad y no todo cae al fallback.
- "R5 — la columna sin etiqueta participa del mecanismo: se desmarca y se persiste su clave":
  no es un adorno; al hacer click pasa a `aria-checked="false"` y su `key` queda guardada.

### Hueco 2 — R12 probaba la AFORDANCIA pero no la PROHIBICIÓN

Antes: `aria-disabled` + ayuda visible sí, pero ningún test intentaba desmarcar la última columna
y el guard de carrera de `hooks/usePreferenciaColumnasManifiesto.ts:119` no se ejercitaba nunca.

- **(a) Prohibición en la UI**, añadido a `tests/components/ColumnasManifiestoPopover.test.tsx`
  (catálogo REAL): "R12 — un click sobre la última casilla marcada NO la desmarca ni altera lo
  guardado". El click se entrega con `fireEvent.click` a propósito: `userEvent` se negaría por
  `pointer-events: none` y el caso quedaría sin probar. Se comprueba `aria-checked` inalterado,
  `localStorage` idéntico byte a byte y el aviso de mínimo aún visible. No se relajó producción
  para que el click pasara.
- **(b) Guard del hook fuera de la UI**, en el archivo nuevo: un componente SONDA llama
  `alternar(<única clave visible>)` DIRECTAMENTE, que es justo la carrera entre dos superficies
  vivas que el `disabled` de la UI no puede cubrir. `localStorage` no se mueve y la clave sigue en
  `clavesVisibles`.
- **(b') Contraste positivo**: "R12 — el guard DISCRIMINA: con dos columnas visibles, `alternar` sí
  oculta una". Sin este caso, el anterior también pasaría con la función muerta.

### R23 — verificado de nuevo sobre los asertos nuevos

Grep de `toHaveLength(`, `toMatchSnapshot`, `toMatchInlineSnapshot` y `.length).toBe` en los dos
archivos: las únicas coincidencias son `…length).toBeGreaterThan(0)`. Los tres `toEqual` contra una
lista del archivo nuevo son sobre las claves **sintéticas** declaradas en ese mismo archivo, nunca
sobre las columnas publicadas reales. La lista real sigue sin cerrarse por ningún lado.

### Actualización del mapa de trazabilidad (§2)

| Req | Cobertura añadida |
| --- | --- |
| R5 | + `ColumnasManifiestoCatalogoAbierto.test.tsx` › "R5 — una columna publicada SIN etiqueta declarada se rinde como casilla, nombrada con su clave máquina" y "R5 — la columna sin etiqueta participa del mecanismo: se desmarca y se persiste su clave" → de INFERIDO a OBSERVADO |
| R12 | + `ColumnasManifiestoPopover.test.tsx` › "R12 — un click sobre la última casilla marcada NO la desmarca ni altera lo guardado" (prohibición en UI) y `ColumnasManifiestoCatalogoAbierto.test.tsx` › "R12 — `alternar` invocado directamente NO puede ocultar la última columna visible" + "R12 — el guard DISCRIMINA: con dos columnas visibles, `alternar` sí oculta una" (guard de `hooks/usePreferenciaColumnasManifiesto.ts:119`) |

Los tests de la feature pasan de 33 a 38, repartidos en 5 archivos.

### Gate del perímetro (salida real, 2026-08-10 12:21)

`pnpm exec vitest run` sobre los 5 archivos de la 194 + los 5 detectores:

    Test Files  10 passed (10)
         Tests  92 passed (92)
      Duration  10.53s

`pnpm run typecheck` limpio · `pnpm run lint` `0 errors, 50 warnings` (todas preexistentes en
archivos ajenos). `git status --porcelain` de los 5 detectores
(`manifiesto-xlsx.test.ts`, `DescargarManifiestoButton.test.tsx`, `ManifiestoFlujos.test.tsx`,
`GenerarGuiaModal.test.tsx`, `intentos-no-alcance.test.ts`): **vacío**. Cero rojos; no apareció el
flake de `tests/unit/guards/no-embalaje.test.ts` en esta corrida.

**Sigue pendiente para el leader:** `./init.sh` COMPLETO antes del PR (T12) y el commit, que debe
seleccionar solo los archivos de la §1 más los dos de esta sección.
