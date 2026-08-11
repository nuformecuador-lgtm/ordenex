# Feature 194 — Columnas del manifiesto elegibles por acción · revisión

> Reviewer. Rama `ux`, 2026-08-10. Verificación ejecutada por el reviewer, no citada de la
> bitácora. Sólo se juzgan los 9 archivos de la §1 de `progress/impl_194.md`; el resto del
> working tree (escáner, paginado, `.gitignore`) es WIP ajeno y queda fuera de esta revisión.

## Veredicto

**APROBADO CON RESERVAS.** Cero hallazgos bloqueantes. La desviación de design §2 queda
**RATIFICADA**. Dos reservas menores (R5 y R12, cobertura parcial) y una condición de cierre
que no es de esta revisión sino del PR: `./init.sh` COMPLETO, que T12 exige y que nadie ha
corrido todavía.

---

## 1. Checklist de CHECKPOINTS.md

### Especificación
- [x] `requirements.md` — 26 requisitos EARS numerados R1–R26 + decisiones de la puerta humana
      D-A/D-B/D-C.
- [x] `design.md` — cinco alternativas descartadas con su porqué (§9, A1–A5).
- [x] `tasks.md` — T0–T12, **todas** marcadas `[x]`.

### Trazabilidad
- [x] Cada `R<n>` mapea a al menos un test concreto (tabla §2, verificada aserto a aserto).
- [x] `progress/impl_194.md` contiene el mapa `R<n> -> test`, sin huecos.

### Calidad de código
- [x] `pnpm typecheck` verde (pasó dentro de `./init.sh --rapido`).
- [x] `pnpm lint` — 0 errores. Corrí ESLint acotado a los 9 archivos de la feature: salida
      VACÍA. Los 50 warnings del repo son `no-unused-vars` preexistentes en tests ajenos.
- [~] Tests: ver §7. La corrida de `--rapido` salió ROJA por un flake de saturación ajeno a la
      194, reproducido y descartado en aislado. Los 118 tests del perímetro de la feature +
      detectores pasan; las 81 suites de guardias pasan.
- [x] E2E: no aplica. La feature no toca auth, pagos, recaudo, ingesta de órdenes ni webhooks:
      es filtrado de presentación en el navegador sobre filas ya devueltas.

### Datos y seguridad
- [x] Tabla nueva / RLS: no aplica. Cero tablas, cero columnas, cero migraciones.
- [x] Migraciones reversibles: sin migraciones nuevas; el chequeo de `down.sql` pasó.
- [x] Sin secretos hardcodeados. El único literal persistido es el prefijo de clave de
      `localStorage` (`ordenex:manifiesto-columnas:`), que no es un secreto.
- [x] Webhooks: no aplica.

### Patrón de capas
- [x] Separación respetada: `lib/manifiesto/preferencia-columnas.ts` es puro (no importa
      `components/`, `hooks/` ni `app/`; sólo `import type` + `window.localStorage`),
      `hooks/usePreferenciaColumnasManifiesto.ts` es la capa React y
      `components/shared/ColumnasManifiestoPopover.tsx` la de presentación. Ningún service,
      repository, controller ni interface se toca.

### Permisos / multi-país
- [x] No aplica (no hay página nueva ni mutación).
- [x] Sin hardcode de país, moneda ni cuenta.

### Verificación final
- [ ] **`./init.sh` COMPLETO — PENDIENTE.** Ni el implementer ni el reviewer lo han corrido;
      sólo `--rapido`. T12 y la regla 5 de `CLAUDE.md` lo exigen antes del PR, sin excepción.
- [x] `progress/review_194.md` existe (este archivo).
- [ ] Entrada en `progress/history.md` — pendiente, corresponde al leader.

---

## 2. Trazabilidad R1–R26, verificada aserto a aserto

Leí los cuatro archivos de test completos. No hay tests vacíos ni que "rocen" el requisito,
salvo las dos reservas marcadas.

| Req | Test que lo cubre | Veredicto |
| --- | --- | --- |
| R1 | `ColumnasManifiestoPopover.test.tsx` "R1 — ofrece un control propio…": nombre accesible `Elegir columnas del manifiesto`, cerrado antes del click y abierto después + `DescargarManifiestoColumnas.test.tsx` (`disparadoresSelector()` junto a cada botón) | CUBIERTO |
| R2 | ídem "R2 — presenta una casilla por columna publicada, en el orden del archivo": presencia de TODAS las publicadas + `headersEnPantalla()` vs `HEADERS`, ambos derivados | CUBIERTO |
| R3 | ídem "R3 — refleja marcada la visible y desmarcada la oculta": `aria-checked` de la oculta y de todas las demás | CUBIERTO |
| R4 | ídem "R4 — el nombre accesible … contiene la clave máquina"; el helper `nombreDe` resuelve el `aria-labelledby` real, no el texto suelto | CUBIERTO |
| R5 | ídem "R5 …" + `preferencia-columnas.test.ts` "cae a la propia cabecera…" | PARCIAL (menor-1) |
| R6 | ídem "R6 — Restablecer…": todas quedan `aria-checked=true` y se escribe la lista vacía | CUBIERTO |
| R7 | `manifiesto-xlsx-columnas.test.ts` "R7/R9…", "R7: los datos … bajo la columna visible", "R7: una clave DESCONOCIDA se ignora" — round-trip real con ExcelJS, sin dobles | CUBIERTO |
| R8 | ídem "R8: con las claves en orden INVERTIDO…" (índices relativos) + `DescargarManifiestoColumnas.test.tsx` "el generador recibe las claves visibles, en el orden RELATIVO…" | CUBIERTO (doble) |
| R9 | `manifiesto-xlsx-columnas.test.ts` "R7/R9…": la cabecera emitida es `headerDe(key)`, la clave máquina | CUBIERTO |
| R10 | `DescargarManifiestoColumnas.test.tsx` "R10 — un SOLO click…": el selector ni se monta (`queryByRole("checkbox")` null), 1 click, 1 generación, 1 descarga | CUBIERTO |
| R11 | ídem "R11 — el nombre del archivo NO cambia…", leído del `download` real del ancla | CUBIERTO |
| R12 | `ColumnasManifiestoPopover.test.tsx`, los dos casos "R12 —…" (`aria-disabled=true` + ayuda visible, y su negativo) | PARCIAL (menor-2) |
| R13 | `manifiesto-xlsx-columnas.test.ts` "R13: selección VACÍA…" y "R13: ninguna clave casa…", ambos contra `todasLasPublicadas()` derivado | CUBIERTO |
| R14 | `preferencia-columnas.test.ts` "guarda las ocultas bajo la clave del flujo…" (clave literal `ordenex:manifiesto-columnas:carga_masiva`) + `DescargarManifiestoColumnas.test.tsx` "R14, R15…" | CUBIERTO |
| R15 | `DescargarManifiestoColumnas.test.tsx` "R14, R15…": `unmount()` + re-render y la preferencia manda | CUBIERTO |
| R16 | `preferencia-columnas.test.ts` "guardar en carga_masiva no altera…" + `DescargarManifiestoColumnas.test.tsx` "R16 —…": la clave del otro flujo sigue `null` y su selector ofrece todas | CUBIERTO (doble) |
| R17 | `preferencia-columnas.test.ts` "sin valor guardado deja visibles todas…" | CUBIERTO |
| R18 | `DescargarManifiestoColumnas.test.tsx` "R18 — dos botones del MISMO flujo…": se edita en el primer selector y descarga el SEGUNDO botón, que nunca se abrió. Prueba real del evento propio | CUBIERTO |
| R19 | `preferencia-columnas.test.ts` "descarta una clave guardada que ya no esta entre las publicadas" | CUBIERTO |
| R20 | ídem "si lo guardado ocultaria todas las publicadas, quedan todas visibles" | CUBIERTO |
| R21 | ídem `it.each` con 5 formas ilegibles (JSON roto, `ocultas` no array, valor no objeto, `ocultas` ausente, elementos no string) + almacenamiento cuyo `getItem` y `setItem` lanzan. Todos con `not.toThrow()` | CUBIERTO (el mejor de la tanda) |
| R22 | ídem "una columna publicada que no figura en la lista guardada sale visible": se añade `delta` a las publicadas DESPUÉS de guardar. Ataca el requisito por su mecanismo real | CUBIERTO |
| R23 | Revisión propia del reviewer, §3 | CUBIERTO |
| R24 | `manifiesto-xlsx-columnas.test.ts` "R24: sin segundo parámetro…" + `tests/unit/utils/manifiesto-xlsx.test.ts` entero, verde y con diff VACÍO | CUBIERTO |
| R25 | `DescargarManifiestoColumnas.test.tsx` "R25 — obtenerManifiesto se llama con el MISMO input…" (`Object.keys(input).sort()` da `["flujo","ordenIds"]`) + ausencia de diff verificada por mí | CUBIERTO |
| R26 | `tests/integration/api/ordenes-api-key-carga.route.test.ts`, 31 tests verdes; ni el test ni `app/api/ordenes/api-key/carga/route.ts` tienen diff | CUBIERTO |

**Sin requisitos huérfanos.** 26/26 mapean a un aserto real.

---

## 3. R23 / regla 160-R28 — el conjunto sigue ABIERTO (verificado por el reviewer)

No me basé en el grep del implementer. Busqué las CUATRO formas de cerrar la lista de facto:

1. **`toHaveLength(N)` sobre columnas** — no existe. El único `toHaveLength` de la tanda es
   `DescargarManifiestoColumnas.test.tsx:367`, sobre el argumento **filas**
   (`mock.calls[0][0]`), no sobre columnas.
2. **`toEqual([...])` sobre la lista entera** — hay tres, y los tres comparan contra una lista
   DERIVADA en tiempo de ejecución, no contra un literal: `cabecera` vs `todasLasPublicadas()`
   (= `COLUMNAS_MANIFIESTO.map(c => c.header)`), `headersEnPantalla()` vs `HEADERS` (derivado
   igual) y `[...claves]` vs `esperadas` (= `COLUMNAS_MANIFIESTO.filter(...)`). Si mañana se
   publica una columna, las dos partes de la igualdad crecen a la vez: el aserto NO cierra nada.
   Los `toEqual(["alfa","gama"])` de `preferencia-columnas.test.ts` operan sobre la lista
   `PUBLICADAS` FICTICIA que el propio archivo declara, jamás sobre el catálogo real — que es
   exactamente lo que pedía T4.
3. **Snapshots** — ninguno (`toMatchSnapshot` no aparece).
4. **`Object.keys(...).length`** — el único `Object.keys` es sobre el input de la Server Action
   (R25), donde cerrar el conjunto es lo correcto y lo pedido.

Además: el literal `12` no aparece en ningún archivo de producción ni de test de la feature, y
el comentario de la regla 160/R28 viaja íntegro al módulo nuevo, AMPLIADO con un párrafo que
declara explícitamente que elegir un subconjunto no cierra la lista.

Dos ayudas de robustez que refuerzan la regla: `cabeceraDe()` recorre `COLUMNAS_MANIFIESTO.length`
celdas (derivado) en vez de un tope fijo, y `headerDe(key)` lanza si la columna desaparece, lo
que convierte una retirada silenciosa en un rojo explícito.

**R23: CUMPLIDO.**

`menor-4` — los tests indexan `COLUMNAS_MANIFIESTO[0]`, `[1]` y `[3]` para elegir "una columna
cualquiera". Eso no cierra el conjunto (no impide que crezca), pero pone un piso implícito de 4
columnas: si el catálogo alguna vez ENCOGIERA, romperían por una razón que no es la que dicen
medir.

---

## 4. La DESVIACIÓN de design §2 — RATIFICADA

El implementer creó un 5.º archivo no previsto, `lib/manifiesto/columnas-publicadas.ts`, movió
allí `COLUMNAS_MANIFIESTO` y dejó un re-export en `lib/utils/manifiesto-xlsx.ts`.

**(a) ¿El conflicto era real, o había salida sin mover nada? — REAL.**
Verificado en el código, no de palabra: los tres detectores mockean `@/lib/utils/manifiesto-xlsx`
con factoría TOTAL (`DescargarManifiestoButton.test.tsx:22`, `ManifiestoFlujos.test.tsx:77`,
`GenerarGuiaModal.test.tsx:27`), exponiendo sólo `buildManifiestoXlsx` y `manifiestoFileName`.
Con D4 (aprobado en el diseño) el popover se monta DENTRO del botón y lee el catálogo de forma
síncrona en el primer render; el hook debe ir además ANTES del return temprano de R17 porque
React exige el mismo número de hooks por render. No hay orden de hooks, return temprano ni
import dinámico que lo esquive. Las salidas posibles eran tres: parchear los tres mocks con
`importOriginal` (inaceptable: son el detector que design §10 y T8 designan como tal, y
modificarlo para que el código nuevo pase es lo que el detector existe para impedir), duplicar
el catálogo en la capa de UI (dos fuentes de verdad, peor que el problema) o mover el dato. La
única alternativa restante era renunciar a D4, que es decisión de diseño aprobada. Eligió bien y
dejó la decisión documentada en vez de esconderla.

**(b) ¿El movimiento es LITERAL? — SÍ.**
Contrastado contra `git diff -- lib/utils/manifiesto-xlsx.ts`: mismas 12 entradas, mismo orden,
mismas `key`/`header`, comentario de la 160/R28 ÍNTEGRO, incluida la nota de la feature 160
sobre la posición de `intentos`. Lo único añadido son dos párrafos de ampliación (la regla 194 y
el porqué de la ubicación), ninguno derogatorio. CERO cambio de comportamiento: el catálogo que
consume el generador es el mismo objeto que antes.

**(c) ¿Doble fuente de verdad o ciclo de imports? — NO.**
El grafo es acíclico y de un solo sentido: `lib/utils/manifiesto-xlsx.ts` importa de
`lib/manifiesto/columnas-publicadas.ts`, que sólo hace `import type` de `lib/utils/xlsx-template`.
El re-export conserva la IDENTIDAD del objeto: no hay dos catálogos, hay uno con dos rutas de
acceso. Los tres consumidores de producción nuevos (hook, popover, generador) usan la ruta
canónica nueva; `tests/unit/types/intentos-no-alcance.test.ts` sigue entrando por la antigua y
por eso sigue verde sin tocarse, que era el objetivo del re-export.

`menor-3` — quedan dos rutas de import válidas y los propios tests de la 194 las MEZCLAN:
`tests/components/ColumnasManifiestoPopover.test.tsx:9` importa de `@/lib/utils/manifiesto-xlsx`
mientras `tests/components/DescargarManifiestoColumnas.test.tsx:8` importa del módulo nuevo. No
es un bug —resuelven al mismo objeto—, pero es la clase de ambigüedad que en seis meses hace que
nadie sepa cuál es la canónica.

**(d) ¿Mejora o empeora `docs/architecture.md`? — MEJORA.**
`lib/utils/` está definido como "helpers puros (sin side effects)"; un catálogo de dominio no es
un helper, es un dato. Separarlo evita que cualquier pantalla que quiera LISTAR columnas arrastre
el generador de binarios entero (que a su vez importa `xlsx-template`) sólo para leer doce pares
clave/cabecera. `lib/manifiesto/` no es una carpeta improvisada: design §2 ya la creaba con ese
propósito y replicando `lib/audio/`, el precedente que el propio diseño cita. La desviación es de
forma (un archivo más), no de fondo.

**Prueba independiente del desacoplamiento**: `DescargarManifiestoColumnas.test.tsx` usa la MISMA
factoría total que los detectores, sin `importOriginal`, y monta el botón con su selector. Si el
acoplamiento volviera, ese test se pondría rojo solo. Es un detector nuevo bien puesto.

---

## 5. Trampas que el spec marcó (design §4, §7, §10)

| Trampa | Estado |
| --- | --- |
| El snapshot de `useSyncExternalStore` debe ser el STRING crudo | CUMPLIDO. `getSnapshot` es `() => leerCrudoColumnas(flujo)`, memoizado con `useCallback([flujo])`; la derivación a `XlsxColumn[]` va en `useMemo([crudo])` y `clavesVisibles` en un segundo `useMemo([visibles])`. `getServerSnapshot` devuelve `null`. `suscribir` es `useCallback([])`, estable. No hay bucle: las 15 pruebas que montan el componente terminan. |
| Se guardan las OCULTAS, no las visibles (R22) | CUMPLIDO. El formato persistido es `{"ocultas":[...]}` y R22 se cumple por construcción, probado con una columna añadida a posteriori. |
| El filtro va sobre el CATÁLOGO, nunca sobre la entrada (R8) | CUMPLIDO en los dos sitios: `columnasAEmitir` hace `COLUMNAS_MANIFIESTO.filter(c => clavesVisibles.includes(c.key))` y `columnasVisibles` hace `publicadas.filter(...)`. En ningún punto se itera la lista del usuario para construir salida. R8 es estructuralmente inviolable, como prometía D5. |
| Todo camino degradado termina en "todas", nunca en excepción (R13/R20/R21) | CUMPLIDO. `leerCrudoColumnas` da `null` sin `window` o si el storage lanza; `sanearOcultas` da `[]` ante JSON roto, forma inesperada, elementos no string y ante `saneadas.length >= publicadas.size`; `guardarOcultas` traga la excepción de escritura; `columnasAEmitir` degrada a la lista completa con 0 resultantes en vez de propagar el `throw` de `buildXlsxRows`. El único `throw` que sobrevive es el de `filas.length === 0`, que es de la 148 y sigue probado. |

Sobre `docs/conventions.md` ("nada de catch vacíos"): los tres `catch` silenciosos llevan
comentario que explica la decisión y replican literalmente el precedente aprobado
`lib/audio/preferencia-sonido.ts:29,42`. No es una violación.

**Accesibilidad**: disparador con `aria-label="Elegir columnas del manifiesto"` (R1); cada casilla
con `aria-labelledby` al `Label` cuyo texto es `Etiqueta legible (clave_maquina)`, de modo que el
nombre accesible contiene la clave (R4) —y el test lo resuelve por el `aria-labelledby` real, no
por proximidad en el DOM—; última marcada con `aria-disabled="true"` y ayuda visible (R12/D-B).
Correcto.

---

## 6. R25/R26 y detectores — verificado con `git`, no de palabra

- `git status --porcelain` sobre `lib/services`, `lib/actions/manifiesto.ts`,
  `lib/types/manifiesto.ts`, `app/api` y `db/schema.prisma` da salida VACÍA.
- Los 3 call-sites de D4 (`ManifiestoResultado.tsx`, `OrdenesCargaResumen.tsx`,
  `RecepcionSateliteModule.tsx`) NO aparecen en `git status`. Los 4 archivos de `app/` que sí
  aparecen son del WIP ajeno del escáner y del paginado.
- Los 4 detectores (`tests/unit/utils/manifiesto-xlsx.test.ts`,
  `tests/components/DescargarManifiestoButton.test.tsx`, `ManifiestoFlujos.test.tsx`,
  `GenerarGuiaModal.test.tsx`) NO aparecen en `git status`: cero líneas modificadas. Los cuatro
  pasan.
- Cero dependencias nuevas en `package.json`, cero migraciones.

---

## 7. Gate ejecutado por el reviewer (salida REAL)

`./init.sh --rapido` salió ROJO. No lo repito de la bitácora: lo corrí yo.

    ✓ typecheck paso
    ✖ 50 problems (0 errors, 50 warnings)   <- preexistentes, tests ajenos
    ✓ lint paso
    -> pnpm run test:rapido
     ❯ tests/unit/guards/no-embalaje.test.ts (1 test | 1 failed) 63550ms
       × no queda ninguna referencia a embalaje fuera del whitelist
       Error: Test timed out in 20000ms.
     Test Files  1 failed | 244 passed (245)
          Tests  1 failed | 3129 passed (3130)
       Duration  235.64s
    ✗ pnpm run test:rapido fallo

**Diagnóstico: flake de saturación, NO regresión de la 194.** Comprobado:

- El guard aislado pasa en 3,74 s contra un límite de 20 s (`Test Files 1 passed`). El archivo
  recorre el árbol del repo buscando una cadena; bajo la corrida completa tardó 63 s por
  contención de I/O, no por su contenido.
- Nada de la 194 toca ese guard.
- La etapa de guardias, que `--rapido` no llegó a ejecutar por el fallo previo, la corrí aparte:
  `Test Files 81 passed (81) · Tests 1101 passed (1101)`, incluido el guard que falló.
- Perímetro de la feature + los 5 detectores + el route handler de API key, corrida propia:
  `Test Files 10 passed (10) · Tests 118 passed (118)`, 12,22 s.
- ESLint acotado a los 9 archivos de la feature: salida vacía, 0 warnings propios.

El rojo es real en la salida pero ajeno a esta feature, y el veredicto no se apoya en él. Queda
anotado para que nadie lo lea como "el implementer mintió": el flake existe y cambia de archivo
entre corridas.

---

## 8. Hallazgos

### Bloqueantes

**Ninguno.**

### Menores

**menor-1 — R5 se prueba por composición, no de extremo a extremo.**
`ColumnasManifiestoPopover.test.tsx` R5 comprueba el fallback llamando a
`etiquetaColumna("columna_inventada")` y, aparte, que ninguna casilla del popover renderizado
queda sin texto. Pero NUNCA renderiza el selector con una columna publicada que carezca de
etiqueta, porque las 12 actuales la tienen. El cableado popover -> `etiquetaColumna` queda
inferido, no observado. Justo la desviación del §4 lo vuelve barato de arreglar: ahora se puede
`vi.mock("@/lib/manifiesto/columnas-publicadas")` e inyectar un catálogo de prueba con una
cabecera sin etiqueta. No bloqueo porque la composición es de una línea, está tipada y R5 es un
requisito de degradación futura, no de comportamiento vigente.

**menor-2 — R12 prueba la afordancia, no la prohibición.**
Los dos tests verifican `aria-disabled="true"` sobre la última marcada y el aviso visible. Ningún
test INTENTA desmarcarla ni comprueba que el almacenamiento no cambia. Y el guard de carrera del
hook —`hooks/usePreferenciaColumnasManifiesto.ts:119`,
`if (COLUMNAS_MANIFIESTO.length - ocultas.length <= 1) return;`— es código de producción sin un
solo test que lo ejercite; hoy sólo se sostiene por el `disabled` de la UI. R12 dice "DEBE
impedir" y lo probado es "DEBE mostrar que no se puede". Falta un caso que llame a `alternar`
sobre la última visible y afirme que lo guardado no se mueve.

**menor-3 — dos rutas de import para el mismo catálogo, mezcladas en los tests nuevos.**
Ver §4(c). Unificar los tests nuevos en la ruta nueva y marcar el re-export como compatibilidad
hacia atrás ("no usar en código nuevo").

**menor-4 — indexación posicional del catálogo en los tests.** Ver §3.

**menor-5 — `columnasAEmitir` devuelve la referencia de `COLUMNAS_MANIFIESTO` sin copiar** cuando
no hay selección o cuando degrada, mientras que `columnasVisibles` sí copia (`[...publicadas]`).
El array exportado es mutable (`XlsxColumn[]`, no `readonly`). Asimetría heredada, no introducida
aquí, y ningún consumidor muta; se anota como deuda.

---

## 9. Condiciones para pasar a `done`

1. **`./init.sh` COMPLETO en verde** (T12 + `CLAUDE.md` regla 5). No sustituible por `--rapido`.
   Si vuelve a caer `no-embalaje.test.ts` por tiempo, verificarlo en aislado antes de contarlo.
2. Commit que seleccione SÓLO los 9 archivos de la §1 de `progress/impl_194.md` más el spec y las
   bitácoras: el working tree mezcla WIP del escáner y del paginado.
3. Entrada en `progress/history.md`.

Las cinco reservas menores NO condicionan el merge; menor-1 y menor-2 conviene atenderlas en el
mismo PR si sale barato, o anotarlas como deuda explícita si no.
