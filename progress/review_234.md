> **RENUMERADA A 234 el 2026-08-19.** Nacio como «feature 230» en la rama `ux`, pero `dev`
> ya tenia una 230 distinta («el dinero se pinta sin centimos») con su propio directorio de
> spec y sus commits. Se renumera esta conservando el slug, que es el precedente del repo.
> El PR #391 y los commits de la rama siguen diciendo 230: es historia, no se reescribe.

# Feature 230 — review · descarga de cierres general y detallada

> Reviewer. Worktree `C:/w230`, rama `feature/230-descarga-cierres-general-y-detallada`,
> HEAD `76fe655b`. Base: **`ux` (`643bd73c`)**, no `dev` — decisión del humano del 2026-08-18.
> El diff propio de la feature es `git diff 643bd73c 76fe655b`: **56 archivos, +6344 / -27**.
> Lo que trae el merge `54fccc4b` NO se cuenta como cambio de la 230.

## VEREDICTO: **APROBADO**

**52 de 52 requisitos verificados.** Cero hallazgos BLOQUEANTES. Siete menores, ninguno
funcional, listados en §4.

- [x] `specs/234-.../requirements.md` con R1…R52 en EARS, más D1…D13 cerradas por el humano.
- [x] `specs/234-.../design.md` con **nueve** alternativas descartadas y su porqué (§9.1-§9.9).
- [~] `specs/234-.../tasks.md`: **24 de 25 tasks en `[x]`. T8.1 (el gate) sigue `[ ]`.** Es la
      única, y es la que corre el leader. Ver menor **m1**.

### Trazabilidad
- [x] Cada `R<n>` mapea a un test que EXISTE y que EJERCE el requisito. Tabla en §2.
- [x] `progress/impl_230.md` contiene el mapa `R<n> -> test`, partido en §3 (backend) y §8
      (frontend). Entre los dos cubren los 52.

### Calidad de código (medido por mí, no por la bitácora)
- [x] `pnpm typecheck` -> **0 errores**.
- [x] `pnpm lint` -> **0 errores, 76 warnings**. 75 son el baseline del repo
      (`no-unused-vars`); el 76 es `_recorte` en `DescargarGestionesDialog.test.tsx`,
      declarado y justificado (tipar `mock.calls[0][0]`, sobre lo que afirma R34).
- [x] Tests, corridos por mí:
      - `tests/unit/{services,repositories,actions,types,guards}`: **405 archivos / 6150
        tests, TODO VERDE.**
      - `tests/unit/descarga` + guardias de la feature: **38 archivos / 251 tests, verde.**
      - `tests/components/descarga` + las 6 suites `CierresAdmin*` + `CierresAdminFiltros`:
        **28 archivos / 257 tests, verde.**
      - `tests/unit/components` + `tests/components` (236 archivos): **5 rojos, 39 tests.**
        38 son los AJENOS de `ux`; el nº 39 (`BajoRiesgoPaginacion`) **pasa 5/5 en aislado**:
        flake por saturación.
      - **DELTA DE ROJOS RESPECTO AL BASELINE: 0.**
- [x] No aplica E2E: la feature **no escribe** — es una lectura pura.

### Datos y seguridad
- [x] Sin migración y sin tabla nueva => nada de RLS que exigir. El diff no toca
      `db/schema.prisma` ni `db/migrations/`.
- [x] Sin secretos. Sin ruta `app/api/` nueva (lo atornilla
      `cierres-descarga-detallada-frontera.guardia.test.ts`, que recorre `app/api` entero).
- [x] Sin webhooks.

### Patrón de capas
- [x] Server Action: resuelve actor, parsea la lista blanca y delega. Cero Prisma, cero negocio.
- [x] Servicios: no conocen HTTP. Resuelven alcance, aplican el tope, devuelven union tipado.
- [x] Repositorios: solo Prisma. El `where`, el `orderBy` y el `select` viven ahí y solo ahí.
- [x] Interfaces en `lib/interfaces/{services,repositories}/`, ampliadas, no duplicadas.

### Permisos
- [x] Alcance resuelto desde la SESIÓN (`resolveActorFromSession` -> `resolveAlcance`), nunca
      desde la entrada. Ver §3.1.
- [x] Mutaciones: no hay. Lectura por Server Action, no por API route.

### Multi-país / configuración
- [x] Nada hardcodeado. El tope sale de `descargaConfig.MAX_FILAS`; las fechas de calendario,
      de `inicioDelDiaCREnUtc` / `inicioDelDiaSiguienteCREnUtc`. Ni un símbolo de moneda en el
      módulo de columnas (lo prohíbe su guardia).

### Verificación final
- [~] `./init.sh` completo: **lo corre el leader** (T8.1). Yo he corrido sus tres partes por
      separado y en verde, con delta 0. Ver **m1**.
- [x] Este archivo existe y su veredicto es APROBADO.
- [ ] `progress/history.md` **sin entrada de la 230**. Es del leader al mergear. Ver **m2**.

---

## 2. Trazabilidad · `R<n> -> test -> estado`

Todos los tests de esta tabla los he **ejecutado yo**, no solo leído. «VERIFICADO» significa
que el test existe, nombra el requisito y llega a una aserción que lo mide.

| R | Test | Estado |
| --- | --- | --- |
| R1 | `CierresAdminDescargaDetallada.test.tsx` > `la pantalla ofrece un control de descarga detallada además del general (R1)` — dos controles, y en las DOS pestañas | VERIFICADO |
| R2 | `CierresDescarga.test.tsx` + `cierres-admin-descarga-columnas.test.ts` + `cierres-bodega-descarga-columnas.test.ts`, **sin una sola aserción tocada** (el diff de `CierresDescarga` son 6 líneas, todas de `vi.mock`) + `CierresBodegaDescargaDetallada.test.tsx` > `los cuatro controles de descarga que ya existían siguen en su sitio` | VERIFICADO |
| R3 | `cierre-gestiones-descarga-columnas.test.ts` (intacto) + fundida > `las constantes de la marca de evidencia siguen exportadas y sin cambios (R3)` | VERIFICADO |
| R4 | `CierresAdminDescargaDetallada.test.tsx` > `descargar no cambia la página, ni los filtros, ni el detalle abierto (R4)` — cuenta lecturas del listado antes/después, `refresh` no llamado, pestaña y contador idénticos | VERIFICADO |
| R5 | fundida > `emite una fila por gestión y ninguna fila agregada (R5/D2)` | VERIFICADO |
| R6 | `CierresAdminDescargaDetallada.test.tsx` > `produce un solo archivo de una sola hoja... (R6)` — UNA llamada a `buildXlsxRows`, UN `sheetName`, 5 resultados en 5 filas | VERIFICADO |
| R7 | fundida > `toda fila lleva la columna Resultado con la etiqueta singular de su resultado (R7)` | VERIFICADO |
| R8 | fundida > `toda fila lleva el nombre del mensajero dueño del cierre (R8)` + `cierres-gestiones-descarga-dto.test.ts` > `lleva el mensajero y la fecha del cierre...` | VERIFICADO |
| R9 | fundida > `las 26 columnas salen en el orden declarado sea cual sea el resultado (R9)` + `declara las 26 columnas en el orden decidido (design §6)`, con la lista LITERAL | VERIFICADO |
| R10 | fundida > `una columna que no aplica al resultado deja la celda vacía y no se omite (R10)` + los CINCO casos por resultado | VERIFICADO |
| R11 | `cierres-admin-gestiones-where.test.ts` > `ordena por fecha de solicitud del cierre y luego por la gestión (R11)` + `cierres-bodega-gestiones-where.test.ts` > `usa el MISMO orden...` | VERIFICADO |
| R12 | fundida > `la fundida no declara ni estado del cierre ni destino (R12)` | VERIFICADO |
| R13 | `cierres-descarga-detallada-puerta.test.ts` > `las filas salen de la Server Action de esa pantalla y de ninguna otra fuente (R13)` + `cierres-gestiones-descarga-action.test.ts` > `con sesión y entrada válida, delega...` | VERIFICADO |
| R14 | `CierresAdminService.gestiones-completo.test.ts` > `el satélite no recibe gestiones de cierres fuera de su zona destino (R14)` + `cierres-admin-gestiones-where.test.ts` > `pone el alcance del satélite DENTRO de la relación cierre...` | VERIFICADO |
| R15 | servicio > `el alcance no se lee de la entrada: pedir mensajeros ajenos no amplía nada (R15)` + el `toEqual` exacto del `where` en el test de repositorio | VERIFICADO |
| R16 | `frontera.guardia` > `el borde de descarga no importa servicio, repositorio ni Prisma (R16)` (y prohíbe `where:` / `orderBy:` en el subárbol) | VERIFICADO |
| R17 | `cierres-gestiones-descarga-action.test.ts` > `devuelve unauthenticated sin parsear la entrada y sin filas (R17)`, en los DOS bordes | VERIFICADO |
| R18 | servicio > `it.each(ROLES_SIN_ACCESO)` -> `forbidden` antes de tocar el repositorio | VERIFICADO |
| R19 | `filtros-descarga-gestiones-schema.test.ts` > `it.each` sobre seis claves ajenas + la acción con la misma tabla en los dos bordes | VERIFICADO |
| R20 | servicio > `un adminSatelite sin zona recibe conjunto vacío sin consultar la base, y NO forbidden (R20)` | VERIFICADO |
| R21 | servicio A > `superar el tope... (R21)` + `justo EN el tope todavía devuelve el conjunto entero` + gemelo de bodega + acción > `propaga limite_excedido con sus conteos y sin filas` | VERIFICADO |
| R22 | servicios A y B > `no se firma ninguna URL de evidencia al producir el conjunto (R22)` (doble que CUENTA invocaciones) + repositorio > `la proyección NO lee evidencia_storage_path` | VERIFICADO |
| R23 | `CierresBodegaDescargaDetallada.test.tsx` > `el listado de cierres de bodega ofrece el control de descarga detallada (R23)` | VERIFICADO |
| R24 | `cierres-bodega-gestiones-where.test.ts` > `sólo devuelve gestiones de cierres del día consolidados en un cierre de bodega (R24)` + mitad de UI > `descargar aquí llama al borde de BODEGA y no al de cierres del día` | VERIFICADO |
| R25 | `CierresBodegaAdminService.gestiones-completo.test.ts` > `it.each(ROLES_SIN_ACCESO_TOTAL)` -> `forbidden` sin tocar el repositorio | VERIFICADO |
| R26 | `cierres-gestiones-descarga-dto.test.ts` > `los DOS caminos producen la MISMA fila para la misma gestión (R26)` (ejecuta los DOS repositorios) + `cierres-gestiones-paridad.test.ts` (b)/(c) | VERIFICADO |
| R27 | `cierres-gestiones-descarga-dto.test.ts` > `una gestión de un cierre con destino bodega central sale por el camino A sin trato especial (R27)` + `frontera.guardia` > `el código nuevo no ramifica por esCentral (R27)`. Comprobado además a mano sobre TODO el diff | VERIFICADO |
| R28 | `DescargarGestionesDialog.test.tsx` > `pulsar el control abre el diálogo y no descarga nada todavía (R28)` | VERIFICADO |
| R29 | diálogo > `el diálogo solo ofrece mensajeros del catálogo del alcance (R29)`. Comprobada la cadena real: `page.tsx` -> `obtenerCatalogoFiltrosCierres` -> `findCatalogoFiltros(alcance)`, que acota por `zonaId` cuando el actor tiene zona | VERIFICADO |
| R30 | diálogo > `permite seleccionar varios mensajeros a la vez (R30)` | VERIFICADO |
| R31 | diálogo > `ofrece un rango de fechas opcional que viaja al borde (R31)` + `el rango es opcional de verdad...` + repositorio > `el rango... con hasta inclusivo` | VERIFICADO |
| R32 | schema > `un rango invertido produce validation_error (R32)` + acción > `sin tocar el servicio` + diálogo > `un rango invertido no produce archivo (R32)` (no solo toast: también `role="alert"`) | VERIFICADO |
| R33 | `CierresAdminDescargaDetallada.test.tsx` > `el archivo solo contiene gestiones de los mensajeros y el rango confirmados (R33)` (`toHaveBeenCalledWith` exacto) | VERIFICADO |
| R34 | diálogo > `el objeto enviado al borde contiene solo lo elegido en el diálogo (R34)` — `Object.keys(...).sort()` exacto | VERIFICADO |
| R35 | diálogo > `el control detallado no lee ni modifica ningún filtro de la pantalla (R35)` + `puerta.test.ts` (no importa `@/lib/actions/`, no tiene prop de filtros) | VERIFICADO |
| R36 | `puerta.test.ts` > `lo elegido viaja como filtro del mismo borde, sin consulta paralela (R36)` — UNA sola invocación de la acción, sin `fetch`, sin `swr`, sin `useEffect` | VERIFICADO |
| R37 | servicio > `pedir un mensajero fuera de alcance devuelve cero filas, no filas ajenas (R37)` + repositorio > `un mensajero de otra zona NO se convierte en un OR: se cruza con el alcance (R37)` | VERIFICADO |
| R38 | servicio > `«fuera de alcance» y «sin cierres en el rango» son el MISMO desenlace (R38)` + UI > `un mensajero sin cierres y uno fuera de alcance producen el mismo mensaje (R38)` | VERIFICADO |
| R39 | schema > `mensajeroIds es obligatorio...` + `una lista vacia de mensajeros se rechaza y NO degrada a «todo el alcance» (R39)` + acción > `confirmar sin ningún mensajero muere en el borde` + diálogo > `cancelar o confirmar sin selección no produce archivo ni llama al borde (R39)` | VERIFICADO |
| R40 | fundida > `la fundida no declara ninguna columna de evidencia y ninguna celda la lee (R40)` — barre claves, encabezados y VALORES de los cinco resultados con un patrón amplio y con `https?://`. Mutación: añadir «Tiene evidencia» lo pone rojo | VERIFICADO |
| R41 | fundida > `el DTO que alimenta la fila no declara campo de evidencia alguno (R41)` + `frontera.guardia` > mismo invariante + servicio de bodega > `ninguna fila... campos de evidencia ni identificadores internos` + la proyección Prisma no SELECCIONA `evidenciaStoragePath` | VERIFICADO |
| R42 | `cierres-gestiones-descarga-dto.test.ts` > `no emite ningún identificador interno de registro (R42)` + `columnas-sensibles.guardia.test.ts` > `ninguna fila de export emite un identificador interno con forma de uuid` (la fundida entra por convención) + `frontera.guardia` prohíbe gestionId/ordenId/cierreId/mensajeroId/zonaId en el DTO | VERIFICADO |
| R43 | fundida > `los montos salen como el string del snapshot, sin símbolo ni separador (R43/R44)` + DTO > `escala 2, sin símbolo ni separador` + `money.guardia` > `tampoco emite el símbolo de la moneda ni separadores de miles (R43)` | VERIFICADO |
| R44 | `cierres-descarga-detallada-money.guardia.test.ts` > `el módulo de la fundida no contiene parseFloat, Number ni aritmética sobre montos (R44)` (además `parseInt`, `toFixed`, `Math.`, `money(`, y dos regex de aritmética sobre `monto*`) | VERIFICADO |
| R45 | fundida > `resultado, método, causa y origen salen como etiqueta legible (R45)` + `cierre-resultado-fila-label.test.ts` > `ninguna etiqueta es el value del enum (R45)` y `NO se deriva del plural quitando la s` | VERIFICADO |
| R46 | fundida > `un dato nulo deja la celda vacía y nunca el guion de pantalla (R46)` + DTO > `un dato nulo llega nulo, nunca como el marcador de pantalla` | VERIFICADO |
| R47 | fundida > `una indemnización sin capturar deja la celda vacía y nunca cero (R47)` (`not.toBe("0")`, `not.toBe("0.00")`) + DTO > `una indemnización sin capturar llega null y NUNCA cero (R47)` | VERIFICADO |
| R48 | `columnas-sensibles.guardia.test.ts` descubre por `import.meta.glob` de `**/*-descarga-columnas.ts` sobre `app/` y `components/`: el módulo nuevo cumple la convención y entra en el censo | VERIFICADO |
| R49 | `frontera.guardia` > `el módulo de columnas de la fundida es puro: no importa React ni toca el DOM (R49)` (además prohíbe `use client` y cualquier import `.tsx`) | VERIFICADO |
| R50 | `columnas-asercion-de-orden.guardia.test.ts`: la constante nueva deja de estar «desnuda» gracias a la aserción LITERAL de T3.2, que la NOMBRA. La guardia se autocomprueba con canarios | VERIFICADO |
| R51 | `CierresAdminDescargaDetallada.test.tsx` > `los controles de la pantalla tienen nombres accesibles distintos y el archivo se llama distinto (R51)` — compara `aria-label` y afirma el patrón `gestiones-de-cierres-AAAA-MM-DD.xlsx` | VERIFICADO |
| R52 | `cierre-gestiones-cabecera.guardia.test.ts` > `la cabecera ya no afirma que no existe un archivo único y conserva la razón de la P2` + `el detector responde a los dos canarios sintéticos` (positivo + dos negativos, uno de ellos «cabecera amputada») | VERIFICADO |

---

## 3. Los puntos calientes, uno por uno

### 3.1 Alcance multi-tenant — LIMPIO

`CierresAdminRepository.findGestionesPorAlcanceCompleto` compone
`cierre: { ...alcanceWhere(alcance), AND: filtrosWhere(filtros) }`. Comprobado a mano que
`alcanceWhere` devuelve **solo** `{ destinoTipo, destinoZonaId? }` — ninguna clave `AND` que el
spread pudiera pisar. El recorte no puede sustituir al alcance: van en niveles distintos y se
exigen los dos. `filtrosWhere` está unificada (una sola declaración para los cuatro listados y
las dos descargas), que es exactamente lo que el backend arregló al borrar
`recortesDescargaGestionesWhere`.

El test lo fija con igualdad EXACTA, no con `toMatchObject`:

    expect(consulta.where).toEqual({
      cierre: { destinoTipo: "bodega_satelite", destinoZonaId: "z-a",
                AND: [{ mensajeroId: { in: [M1, M2] } }] },
    });

y el caso del mensajero ajeno afirma además que el `where` serializado no contiene `OR`.
Un `adminSatelite` que pida el mensajero de la zona vecina obtiene la intersección: VACÍO.
**No hay ningún camino en que el input ensanche el alcance:** el schema es `.strict()` y no
declara `destinoZonaIds` ni `destinoTipo`, y el servicio nunca lee del input nada de alcance.

### 3.2 `evidenciaUrl` — CUMPLIDO EN CUATRO CAPAS, y con su test propio

1. La consulta **no selecciona** `evidenciaStoragePath` (`GESTION_DESCARGA_SELECT`): un campo
   que no se lee no puede firmarse «de paso».
2. El DTO no lo declara (dos tests lo comprueban leyendo el FUENTE de la interfaz).
3. Los servicios no llaman a `this.signedUrls` ni una vez (dobles que cuentan invocaciones).
4. La fundida no declara columna alguna, y su test T3.4 barre claves, encabezados y VALORES.
   **Es el test que fallaría si alguien añadiera la columna**, que era el punto.

### 3.3 Money-safe — CUMPLIDO

Todo monto viaja como el `string` de `decimalToString` sobre el snapshot. `celdasEspecificas`
no hace una sola operación aritmética; la guardia de fuente prohíbe `parseFloat`, `parseInt`,
`Number(`, `toFixed`, `Math.`, `money(`, `toLocaleString`, `Intl.NumberFormat`, los símbolos de
moneda y dos formas de aritmética sobre identificadores `monto*`. `null` produce celda vacía
(nunca el guion de pantalla), y `indemnizacion: null` está afirmado explícitamente como distinto
de cero en DOS capas (DTO y fila).

### 3.4 UUIDs — FUERA, y el matiz de `cierreId` está bien resuelto

El DTO no lleva `gestionId`, `ordenId`, `cierreId`, `mensajeroId` ni `destinoZonaId`.
`cierreId` está en la PROYECCIÓN Prisma y en `DETALLE_DESCARGA_SELECT` como clave del join, y
**muere ahí**: `toGestionDescargaDTO` no lo copia. La razón (el grano `@@unique([cierreId,
ordenId])` de `cierre_detail`, que al cruzar cierres haría que dos gestiones de la misma orden
cogieran el mismo snapshot y por tanto los mismos montos) está documentada en el módulo y
**tiene su caso dedicado**: `empareja el snapshot por (cierre, orden) y no sólo por orden`.
El H4 del backend es correcto: es una corrección real del design, no una desviación.

### 3.5 Las dos particiones — DISJUNTAS, sin unificar y sin `if` de GAM

- Camino A: `alcanceWhere` fija SIEMPRE `destinoTipo`; para el maestro, `bodega_central`.
- Camino B: `cierreBodegaId: { not: null }`. Comprobado en `CierreBodegaRepository:154` que
  `consolidablesWhere` exige `destinoTipo: DESTINO_SATELITE`, así que un cierre con destino
  central **nunca** llega a consolidarse. Conjuntos disjuntos por construcción; su unión es el
  total.
- Dos bordes, dos servicios, dos repositorios, dos botones. El test de puerta afirma que
  **ninguna pantalla conoce la acción de la otra**.
- **Ni un solo `if` sobre `esCentral` o GAM en el código nuevo.** Grepeado el diff completo de
  la 230 (`lib/` + `app/`): las cinco apariciones de «GAM» son todas prosa de comentario.

### 3.6 Las tres anotaciones `@sin-superficie` — LAS TRES CORRECTAS

Comprobado sobre el diff `643bd73c -> 76fe655b` de `lib/actions/`: **61 líneas, TODAS de adición,
CERO borrados**. Es decir:
- las dos anotaciones de la 230 nunca llegaron a HEAD: se pusieron y se quitaron dentro de la
  feature, como exigía H7;
- la ajena de `listarCierresBodegaAdmin` (features 170 T M.1 y 184 T E.3) sigue **intacta byte
  a byte** en `lib/actions/cierre-bodega.ts:151`. La restauración fue correcta;
- `superficie-de-uso.guardia.test.ts` pasa **por el motivo correcto**: las dos acciones nuevas
  SÍ son alcanzables desde una raíz de ruta (las montan `CierresAdminModule` y
  `CierresBodegaAdminModule`), así que ni la mitad «ninguna acción es inalcanzable» ni la mitad
  «ninguna anotación sobrevive a su motivo» tienen nada que reprochar.

### 3.7 `mensajeroIds` obligatorio y no vacío — CORTADO EN LOS DOS SITIOS

- UI: `obtenerFilas()` devuelve error con `seleccion.length === 0`, **antes** de tocar la
  acción. Test: la acción no se llama.
- Schema: `listaDeIdsRequerida` = `array(uuid).max(MAX_IDS_POR_FILTRO).nonempty()`, **sin
  `.optional()`**. Tres casos: ausente, vacía y no-uuid. Partir `listaDeIds` en dos (H1) es la
  forma correcta: no duplica el tope ni el `uuid`, y `listaDeIds = listaDeIdsRequerida.optional()`
  deja intacto el comportamiento de los cinco listados. `filtros-cierres-alcance` sigue verde.

### 3.8 Controles propios de fecha — PRESENTES Y AISLADOS

Dos entradas de tipo `date` con su etiqueta propia dentro del `Modal`, con estado local, texto
de ayuda que dice que recortan por la fecha de SOLICITUD del cierre, y aviso `role="alert"`
cuando el rango se invierte. No heredan nada de `FiltrosCierresBarra`: el diálogo ni siquiera
recibe una prop de filtros. El recorte omite las claves vacías (una fecha sin poner no viaja
como `undefined`, que una lista blanca `.strict()` rechazaría) — detalle correcto y afirmado
por `el rango es opcional de verdad`.

### 3.9 La cesión declarada (R2 de la 134) — ACEPTADA, no reportada

Registrada y no contada como defecto. Lo que sí se exige se cumple: **fuente única** (guardia de
puerta + guardia de frontera + ninguna ruta `app/api/`), **alcance desde sesión compuesto con
`AND`** (§3.1) y **lista blanca `.strict()`** (R19, seis claves probadas).

### 3.10 La prosa de la cabecera (T3.5 / R52) — CORREGIDA SIN AMPUTAR

El diff de `cierre-gestiones-descarga-columnas.ts` es **solo comentario** (17 líneas de
cabecera, ni una de código). La cabecera ya no afirma que no existe archivo único; **conserva**
«decisión del humano, P2 de la feature 170» y el motivo original (las celdas vacías al fundir
las cinco secciones); y añade dónde vive ahora el archivo único y que **las cinco no se
retiran**. Las cinco declaraciones por sección **siguen existiendo**, su test sigue intacto
(R3), y `TIENE_EVIDENCIA_COL/_SI/_NO` + `tieneEvidencia` siguen exportadas y en uso.

La guardia de prosa no busca la frase literal sino lo que AFIRMA (regex semántica), y se
autocomprueba con un canario positivo y dos negativos, uno de ellos el caso «cabecera
amputada», que es el que un `includes` de la frase vieja no cubriría.

### 3.11 Los cuatro hallazgos declarados (H9, H10, H12, H13) — LOS CUATRO LEGÍTIMOS

- **H9** (el design cita una UI que `ux` ya reescribió). Adaptación legítima. La intención de
  R1/R23 —«un control más, junto al general, visible en las dos pestañas»— se cumple, y el test
  lo comprueba en las DOS pestañas. Que el detallado no se condicione a la pestaña activa es
  CORRECTO y se deriva de D11: su conjunto no depende de la pestaña.
- **H10** (el `DescargarDatasetButton` es el confirmar del diálogo, no algo que el diálogo
  «llama»). Legítimo y mejor que la letra del design: el binario, el tope y la traducción de
  `limite_excedido` / `forbidden` / `unauthenticated` salen del MISMO sitio que las otras 25
  descargas, y de ahí sale D12/R38 sin una sola rama que distinga los dos casos. El precio —que
  R39 y R32 se corten dentro de `obtenerFilas`— está resuelto y probado con espía sobre la
  acción.
- **H12** (tests ajenos tocados). **Confirmado: ninguna aserción ajena cambió de significado.**
  - H12.1 — las diez suites de componente: comprobado sobre el diff que en **todas** ellas (y en
    las seis suites de servicio del H8) hay **cero líneas de borrado**. Solo se añade
    `listarGestionesCierres*Completo: vi.fn()` a la factoría del `vi.mock`, obligatorio porque
    una factoría explícita enumera los exports.
  - H12.2 — `CierresAdminFiltros.test.tsx` > «(3) el filtro se lleva a la descarga»: el único
    cambio es el selector, de una regex `/Descargar/` al nombre accesible EXACTO del control
    general. **Lo que el caso afirma es idéntico** — el bloque `toHaveBeenCalledWith` de debajo
    no se tocó. El cambio era inevitable: la regex encontraba dos controles. Es exactamente el
    riesgo que R51 nombra.
- **H13** (las 16 celdas se calculan siempre; el `??` que «parece de más»). Legítimo y bien
  razonado: bajo la sonda de `columnas-sensibles.guardia`, `resultado` no es ninguno de los
  cinco, y sin el respaldo la guardia vería dieciséis nulos en vez de dieciséis LECTURAS
  vigiladas. Está documentado en el módulo. No es código muerto disfrazado: es la condición
  para que la guardia de datos sensibles muerda de verdad sobre este módulo.

---

## 4. Hallazgos

### MAYORES (bloqueantes)

**Ninguno.**

### menores

- **m1 — `T8.1` sigue en `[ ]` en `tasks.md`.** Es el único punto de CHECKPOINTS que no se
  cumple literalmente («todas las tasks marcadas `[x]`»). Corresponde al leader: es el
  `./init.sh` completo antes del PR. Yo he corrido sus tres partes por separado y en verde
  (typecheck 0, lint 0 errores, 405+38+28 archivos de test verdes, delta 0 de rojos), así que
  no hay riesgo vivo: solo bookkeeping pendiente.
- **m2 — `progress/history.md` no tiene entrada de la 230.** Checkpoint de «verificación
  final». Es del leader, al mergear.
- **m3 — la guardia `filtros-cierres-alcance.guardia.test.ts` (d) no cubre los dos métodos
  nuevos.** Enumera `historicoWhere` y `colaWhere` y comprueba que cada uno lea `filtrosWhere`,
  componga con `AND:` y aplique `alcanceWhere`. `findGestionesPorAlcanceCompleto` no está en esa
  lista: si mañana alguien volviera a claves hermanas ahí, la guardia no mordería. **No hay
  hueco vivo** —`cierres-admin-gestiones-where.test.ts` fija el `where` con `toEqual` exacto y lo
  pondría rojo—, pero la defensa en profundidad se queda a medias. Añadirlo a la lista es una
  línea.
- **m4 — la aserción (a) de `cierres-gestiones-paridad.test.ts` es vacua por sí sola**:
  compara `filaDescargaGestionFundida(gestion())` consigo mismo, y eso siempre es igual. El peso
  real de R26 lo llevan (b)/(c) del mismo archivo (UNA declaración en el árbol; las dos pantallas
  montan el mismo diálogo) y sobre todo `cierres-gestiones-descarga-dto.test.ts` > `los DOS
  caminos producen la MISMA fila`, que sí ejecuta los dos repositorios. R26 queda cubierto; la
  (a) sobra o debería comparar dos rutas distintas.
- **m5 — el grep de `esCentral` de la guardia de frontera solo recorre los DOS archivos del
  subárbol de UI**, no el código nuevo de `lib/`. Lo he verificado a mano sobre el diff completo
  y está limpio, pero el test que lo mide no cubre el backend. Es literalmente lo que T7.5(b)
  pedía («grep del subárbol»), así que no es incumplimiento: es una cobertura más estrecha de lo
  que R27 podría exigir.
- **m6 — el radio de `CierreDetalleFaltanteError` crece, y conviene que el humano lo sepa.**
  Declarado en `design.md §10.2` y en el propio módulo, y la decisión (error duro antes que un
  fallback con datos VIVOS disfrazados de congelados) es la correcta. Pero antes tumbaba el
  detalle de UN cierre abierto a mano, y ahora un solo cierre corrupto tumba la descarga de un
  rango de meses sin decir cuál. Riesgo aceptado, no defecto; anotado por si se quiere un
  mensaje que nombre el cierre culpable.
- **m7 — el diálogo no ofrece «seleccionar todos» ni buscador de mensajeros.** Declarado en la
  bitácora §10.3. Con un catálogo largo la lista se hace incómoda. Ningún requisito lo pide y
  «todos» es justo la lectura que D5/R39 niegan por defecto, así que **no es un olvido**: es una
  decisión de producto que el humano puede reabrir.

---

## 5. Ruido descartado (no son hallazgos)

- **38 rojos preexistentes de `ux`**: `ordenes-listado-buscador` (3), `ordenes-listado` (13),
  `ordenes-listado-filtros` (16) y `OrdenesPageFiltros` (6). Medidos por mí en esta corrida:
  38 exactos. **Delta 0.**
- **1 rojo de `BajoRiesgoPaginacion.test.tsx`** en la corrida de 236 archivos: **pasa 5/5 en
  aislado**. Flake por saturación (`./init.sh` del leader en vuelo). No es regresión.
- **105 archivos borrados de `.claude/skills/impeccable`**: vienen de `6cd07f5c` de `ux`. Ajeno.
- **75 de los 76 warnings de lint**: baseline del repo. El 76 está justificado.
