# Feature 170 — Descarga a Excel en todas las tablas (+ paginación) · tasks

> Checklist de pasos discretos y verificables. `[P]` = paralelizable con las tareas del mismo
> bloque. Cada task declara dependencias, criterio de HECHO y los `R<n>` que cubre.
> **Ninguna task arranca antes de la aprobación humana del spec (`spec_ready` → aprobado).**
>
> Cobertura obligatoria: **R1–R54**, todos mapeados a un test concreto (ver §Trazabilidad).
> Orden dentro de una tanda `fullstack`: **backend → frontend** (regla del arnés).

## Cómo se entrega: 2 fases, 14 tandas, 14 PRs

| Fase | Tandas | Qué entrega | Valor que aporta por sí sola |
| --- | --- | --- | --- |
| **1 — Export** | 0, A, B, C, D, E, F, G | La descarga a Excel en las 25 tablas | **Es el pedido literal del humano.** Cada tanda deja tablas nuevas descargando. |
| **2 — Paginación** | H, I, J, K, L, M | Paginación server-side de 13 de las 16 pantallas de Familia B (decisión P6) | Cada tanda quita carga de servidor y de red en las pantallas que toca. |

**Regla de cierre de tanda (todas):** `./init.sh` verde, suite completa sin regresiones
respecto al baseline medido AL INICIO de esa tanda, y la funcionalidad de la tanda usable en
producción sin esperar a la siguiente.

**Criterio del orden** (justificado en `design.md §8` y `§11.6`):
1. **Valor primero.** La fase 1 entrega el Excel completo antes de tocar paginación; el export
   no depende de ella. Coste asumido: un retoque de una línea por tabla en la fase 2
   (`design.md §11.5`). Ver Q3.
2. **Dueño del dato.** En la fase 1, una tanda = un servicio o un tipo de proyección.
3. **Riesgo creciente.** En la fase 2, de menor a mayor ruptura de comportamiento visible.
4. **Un rol por tanda.** Ninguna tanda cambia a la vez la experiencia de dos roles distintos.

---

# FASE 1 — EXPORT

## Tanda 0 — Base compartida (bloquea todo lo demás)

### [x] T0.1 [P] — Tipo del resultado «completo»
- Crear `lib/types/descarga-listado.ts` con `ListarCompletoResult<T>` (`ok` con
  `items`/`total`, `limite_excedido` con `total`/`limite`, y el `ActionError` común).
- Reexpresar `ListarOrdenesCompletoResult` (`lib/types/orden.ts:167-171`) en términos del tipo
  nuevo, sin cambiar su forma pública.
- **Depende de:** —
- **Hecho:** `pnpm typecheck` verde; el módulo no importa React, Prisma ni `lib/services`.

### [x] T0.2 — Adaptadores cliente + mensajes canónicos
- Crear `components/shared/descarga-resultado.ts` con `filasDesdeResultado(res, proyectar)`
  (Familia A), `filasLocales(filas, proyectar)` (Familia B, con el tope de
  `descargaConfig.MAX_FILAS`), `mensajeLimite(total, limite)` y `SUFIJO_REINTENTO`. Los textos
  se PROMUEVEN sin editarlos desde `OrdenesModule.tsx:75-88`.
- Test: `tests/unit/components/descarga-resultado.test.ts` (9 casos: los 6 declarados +
  «traduce el array local en el mismo orden», «vacío tal cual» también en Familia B y el
  test que fija los DOS textos promovidos palabra por palabra)
  - «traduce el resultado ok a filas proyectadas, en el mismo orden» (R11)
  - «traduce limite_excedido a un error accionable con total y tope, sin filas» (R27)
  - «traduce cualquier error de acción a un mensaje accionable sin datos personales» (R36)
  - «filasLocales rechaza y no produce archivo cuando el array supera el tope» (R26, R27)
  - «filasLocales no trunca: o devuelve todas las filas o el error» (R28)
  - «devuelve el resultado vacío tal cual para que el control avise sin archivo» (R31)
- **Depende de:** T0.1 · **Cubre:** R11, R26, R27, R28, R31, R36
- **Hecho:** los 6 tests verdes; ningún literal de mensaje duplicado en `app/`.

### [x] T0.3 — Migrar `OrdenesModule` a los adaptadores (refactor sin cambio funcional)
- Sustituir el bloque inline `OrdenesModule.tsx:378-403` por `filasDesdeResultado`.
- Test: `tests/components/OrdenesDescarga.test.tsx` **sin modificar** debe seguir verde.
- **Depende de:** T0.2 · **Cubre:** — (habilitante; evita dos caminos)
- **Hecho:** suite de la 151 verde sin editar ni un test.

### [x] T0.4 [P] — Guardia de datos sensibles
- Test: `tests/unit/descarga/columnas-sensibles.guardia.test.ts`
  - «ninguna declaración de columnas contiene claves de credencial, token o secreto» (R21)
  - «ninguna fila de export emite una ruta de almacenamiento ni una URL firmada» (R22)
  - «ninguna fila de export emite un identificador interno con forma de uuid» (R23)
  - «la guardia cubre TODAS las declaraciones del árbol, no una lista fija» (R25)
- Descubre los módulos `*-descarga-columnas.ts` por convención de nombre.
- **Depende de:** — · **Cubre:** R21, R22, R23, R25
- **Hecho:** 4 tests verdes; añadir a mano una columna `passwordHash` hace fallar la guardia.
- **MEDIDO (2026-07-31):** las tres formas de fuga se demostraron y se revirtieron —
  columna `passwordHash` (falla el test de declaración), celda que lee `orden.id` (falla el
  de uuid, y la sonda dice qué campo se leyó) y celda con URL firmada de Storage (falla el
  de rutas). Ver `progress/impl_170-export-todas-las-tablas.md`.
- Cómo prueba la PROYECCIÓN sin un fixture por módulo (que sería otra lista fija): ejecuta
  cada `fila*()` con una SONDA (proxy que responde a cualquier lectura con un marcador que
  recuerda el campo leído), así el valor emitido delata su origen sea cual sea el DTO.

### [x] T0.5 [P] — Guardia de cobertura del censo
- Crear el registro del censo (25 dentro / 6 fuera del Anexo II) →
  `tests/unit/descarga/censo-tablas.ts`. Cada tabla declara su estado: `con_descarga`,
  `pendiente` (con la tanda que la cablea; estado TRANSITORIO que debe quedar vacío al
  cerrar la fase 1) o `fuera` (con el motivo). La guardia contrasta ese estado declarado
  contra el código instancia a instancia, en los dos sentidos.
- Test: `tests/unit/descarga/cobertura-tablas.guardia.test.ts`
  - «toda tabla del árbol o declara descarga o figura como exclusión justificada» (R4)
  - «las tablas declaradas fuera de alcance no montan control de descarga» (R2)
- **Depende de:** — · **Cubre:** R2, R4
- **Hecho:** ambos tests verdes; un `<DataTable>` nuevo sin registrar hace fallar la guardia.
- **MEDIDO (2026-07-31):** demostrado con un componente nuevo con `<DataTable>` sin
  registrar — la guardia lo nombra (`… /TablaDemoGuardia.tsx #1`) y falla; revertido.

## Tanda A — Órdenes (frontend puro, cero backend)

### [x] T A.1 — Apartado de órdenes por estado
- `OrdenesApartado`: `descarga` en el render con `listarOrdenesCompleto({ estatusId })` +
  `COLUMNAS_DESCARGA_ORDENES` + `filaDescargaOrden` (ya existen).
- Test: `tests/components/descarga/OrdenesApartadoDescarga.test.tsx`
  - «ofrece la descarga del dataset completo del apartado» (R1)
  - «una fila por orden del apartado, no solo la página visible» (R9)
  - «envía el estado del apartado como filtro vigente» (R10)
  - «el listado paginado sigue comportándose igual» (R3)
- **Depende de:** T0.3 · **Cubre:** R1, R3, R9, R10
- **Hecho:** 4 tests verdes; cero código nuevo en `lib/services`.
- **MEDIDO (2026-07-31):** 5 verdes (el 5.º: sin `estatusId` resuelto NO se ofrece el
  control, porque descargar ahí mandaría un filtro vacío y traería todas las órdenes).
- **Efecto colateral, declarado:** montar el control hace que el apartado use `useToast`.
  `tests/components/OrdenesApartado.test.tsx` (feature 49) renderizaba sin proveedor y sus
  6 tests reventaban; se envolvió su `render` en `ToastProvider` — SOLO el arnés, ninguna
  aserción. En producción no cambia nada: `app/(app)/layout.tsx` ya envuelve el grupo.

### [x] T A.2 [P] — Órdenes de la bodega satélite
- `satelite-descarga-columnas.ts` + cableado con `filasLocales` sobre el array **YA filtrado**.
- Test: `tests/components/descarga/SateliteDescarga.test.tsx`
  - «ofrece la descarga de las órdenes de la bodega» (R1)
  - «respeta los filtros de estado, cantón y distrito aplicados» (R10)
  - «no ejecuta ninguna lectura adicional al servidor» (R30, R32)
  - «solo contiene órdenes de la zona del actor» (R14, R20)
- **Depende de:** T0.2, T0.4 · **Cubre:** R1, R10, R14, R20, R30, R32
- **Hecho:** 4 tests verdes.
- **MEDIDO (2026-07-31):** 4 verdes. R30/R32 se verifican de forma ESTÁTICA sobre el
  módulo (no importa `lib/actions|services|repositories`, no hay `fetch` ni `useSWR`, y
  usa `filasLocales` y no `filasDesdeResultado`): la propiedad «no relee» vive ahí, no en
  un espía que solo cubre el camino que el test recorra.

## Tanda B — Configuración (backend → frontend)

### [x] T B.1 — `listarCompleto` en usuarios, plantillas y API keys
- Por servicio: extraer `construirWhere(input, actor)` **sin cambio de comportamiento** y
  añadir `listarCompleto` (`design.md §2.1`). Ampliar su interfaz.
- **HALLAZGO (2026-07-31), declarado en vez de forzado:** en los TRES servicios NO HAY
  `construirWhere` que extraer, porque `listar` no construye ningún predicado. El
  repositorio lista todo (usuarios y API keys) o filtra por su cuenta (plantillas,
  `deletedAt: null`), y el módulo entero es exclusivo de `maestro`, que no está acotado a un
  subconjunto. **El alcance por rol de estos tres listados ES su guard `ALLOWED_ROLES`**, y
  `listarCompleto` usa literalmente el mismo objeto, evaluado antes de tocar la base. La
  paridad (R9/R11/R19) se sostiene sobre llamar al MISMO `repo.list`.
- Test: `tests/unit/services/{usuario,plantilla,api-key}-descarga.test.ts`, cada uno:
  - «todas las filas sin recorte por página» (R9) · «forbidden sin filas» (R17)
  - «mismo criterio de orden que el listado» (R11) · «excluye borradas» (R19)
  - «limite_excedido con total y límite, sin filas» (R27) · «nunca más de N+1 filas» (R29)
- **Depende de:** T0.1 · **Cubre:** R9, R11, R17, R19, R27, R29
- **Hecho:** 18 tests verdes y las suites de listado existentes verdes SIN editar.
- **MEDIDO (2026-07-31):** 26 verdes (9 usuarios + 8 plantillas + 9 API keys). Cada archivo
  añade la CONTRAPRUEBA de R17 (el maestro SÍ recibe filas, para que el test de acotamiento
  no pase por vacío) y el de «sin truncado» (R28). R19 se prueba de verdad en plantillas
  (borrada excluida) y como PARIDAD en usuarios y API keys, que no tienen borrado lógico: el
  conjunto completo == la concatenación de las páginas.
- **Efecto colateral, declarado:** al ampliar las 3 interfaces, 4 archivos de test con dobles
  que las implementan dejaban de compilar. Se les añadió el método al doble
  (`usuarios.test`, `plantillas-actions.test`, `api-keys.test`, `api-keys-listar.test`):
  SOLO el arnés, ninguna aserción tocada.

### [x] T B.2 — Server Actions de los tres listados
- `listarXCompleto(input, deps)` calcada de `listarOrdenesCompleto`.
- Test: `tests/unit/actions/{usuarios,plantillas,api-keys}-descarga-action.test.ts`:
  - «unauthenticated sin filas» (R16) · «clave fuera de la lista blanca» (R18)
  - «propaga limite_excedido tal cual» (R27)
- **Depende de:** T B.1 · **Cubre:** R16, R18
- **Hecho:** 9 tests verdes; ninguna rama devuelve filas junto a un error.
- **MEDIDO (2026-07-31):** 18 verdes (6 por action). Los `*CompletoSchema` se derivan del
  schema del listado con `.omit({page,pageSize}).strict()`; el `.strict()` se añade AQUÍ y no
  en el schema del listado (cuyo contrato esta feature no toca), así que R18 cubre tanto una
  clave inventada como `page`/`pageSize`, que en el modo completo no significan nada.

### [x] T B.3 — Columnas de export de los tres listados
- **Usuarios:** nombre, email, rol legible, estado — sin `passwordHash` ni `id`.
  **API keys:** identificador, prefijo, usuario dedicado, fecha, estado — **sin `keyHash`, sin
  la clave, sin el secreto de webhook**. **Plantillas:** nombre, canal, estado, fecha.
- Test: `tests/unit/descarga/{usuarios,plantillas,api-keys}-descarga-columnas.test.ts`:
  - «valores crudos» (R7) · «etiqueta legible, no valor interno» (R8)
  - «no expone identificadores internos» (R23) · «no emite campos que el listado no muestra» (R24)
  - «un campo nuevo del DTO no aparece hasta declararlo» (R6) · «columnas enumeradas» (R5)
- **Depende de:** T0.4 · **Cubre:** R5, R6, R7, R8, R23, R24
- **Hecho:** 18 tests verdes.
- **MEDIDO (2026-07-31):** 20 verdes. **DOS divergencias con lo que esta task proponía para
  PLANTILLAS, declaradas en vez de forzadas:** (a) «canal» NO EXISTE — `PlantillaListItem` no
  tiene ese campo y hoy la única superficie es WhatsApp; inventar una columna con un literal
  constante sería inventar un dato; (b) «fecha» sí existe en el DTO pero la TABLA NO LA
  MUESTRA, y R24 prohíbe emitir lo que el listado no enseña. Salen `nombre`, `estado` y
  `cuerpo` (éste COMPLETO, sin el truncado a 80 de pantalla: truncarlo sería entregar el dato
  a medias sin avisar). Usuarios y API keys sí salen tal cual proponía la task.
- **Efecto colateral, declarado:** las etiquetas de estado vivían dentro de los
  `*-columns.tsx`, que importan `Badge`/`Button`. Se PROMOVIERON sin editar ni un texto a
  tres módulos puros (`usuario-estado-label.ts`, `plantilla-estado-label.ts`,
  `api-key-estado-label.ts`) para que el módulo de export no arrastre React; los `.tsx` las
  leen de ahí. Misma operación que ya se hizo con `ROL_LABELS`.

### [ ] T B.4 — Cableado de los tres módulos
- Test: `tests/components/descarga/ConfiguracionDescarga.test.tsx`
  - «los tres ofrecen su control con nombre accesible» (R1, R13)
  - «todas las filas, no solo la página visible» (R9) · «nombre del archivo» (R12)
  - «error de tope sin archivo» (R27) · «los tres siguen comportándose igual» (R3)
- **Depende de:** T B.2, T B.3 · **Cubre:** R1, R3, R9, R12, R13
- **Hecho:** 5 tests verdes.

## Tanda C — Ledgers paginados (backend → frontend)

### [x] T C.1 — `listarCompleto` en los cuatro servicios de dinero
- `WalletService` (caja), `WalletMensajeroService` (desglose de un mensajero **y** mis pagos),
  `WalletTiendaService` (mis movimientos). Mismo procedimiento que T B.1.
- **Punto caliente:** «mis movimientos» acota por la tienda del actor y «mis pagos» por su
  `mensajero_id`; ese acotamiento se escribe AL FINAL del `where`.
- Test: `tests/unit/services/wallet-*-descarga.test.ts`, por servicio:
  - «todas las filas sin recorte» (R9) · «el archivo de la tienda A no trae ni una fila de la
    tienda B» (R14) · «un filtro inyectado no amplía el alcance» (R15)
  - «forbidden sin filas» (R17) · «limite_excedido y nunca más de N+1» (R27, R29)
  - «mantiene el orden más reciente primero» (R11)
- **Depende de:** T0.1 · **Cubre:** R9, R11, R14, R15, R17, R27, R29
- **Hecho:** tests verdes en los 4 servicios. **R14/R15 son los que impiden la fuga: la task
  no se cierra sin ellos.**
- **MEDIDO (2026-07-31):** 41 verdes (9 caja + 11 tienda + 11 mis pagos + 10 desglose). Los
  tres servicios ganaron su `construirFiltros(input)` privado —éste SÍ existía inline y se
  extrajo sin cambio de comportamiento—, compartido por el listado paginado, el balance/saldo
  y la descarga: los filtros no pueden divergir porque son el mismo código.
- **R14 con CONTRAPRUEBA, no por vacío:** en los dos ledgers acotados por dato propio el test
  corre con DOS actores y comprueba que cada uno recibe su conjunto NO VACÍO y disjunto del
  otro. En los dos acotados por rol, que maestro y admin SÍ reciben filas mientras el resto
  recibe `forbidden` sin una sola consulta.
- **R15 VERIFICADO POR MUTACIÓN (2026-07-31):** cambiar `tiendaId: actor.usuarioId` por
  `input.tiendaId ?? actor.usuarioId` (y su gemelo en mensajero) hace fallar exactamente el
  test de fuga y ningún otro. Revertido. El acotamiento se escribe AL FINAL del objeto que va
  al repositorio, después del spread de filtros, igual que en `OrdenService`.

### [x] T C.2 — Server Actions de los cuatro ledgers
- Test: `tests/unit/actions/wallet-*-descarga-action.test.ts`:
  - «unauthenticated sin filas» (R16) · «clave fuera de la lista blanca» (R18)
  - «el actor no puede pedir el desglose de otro mensajero» (R14)
- **Depende de:** T C.1 · **Cubre:** R14, R16, R18 · **Hecho:** tests verdes.
- **MEDIDO (2026-07-31):** 23 verdes en 3 archivos (los dos ledgers de mensajero comparten
  archivo porque comparten servicio). En el ledger de la TIENDA, `.strict()` convierte un
  `tiendaId` inyectado en `validation_error` sin llegar al servicio: es la PRIMERA de las dos
  barreras contra la fuga. En «mis pagos» el `mensajeroId` SÍ se acepta —el schema del
  listado lo admite y la paridad manda— y quien lo ignora es el servicio.

### [x] T C.3 [P] — Columnas de export de los cuatro ledgers
- Money-safe: el monto viaja como **STRING tal cual**. Fecha, tipo, concepto y origen legibles;
  nunca ids ni `origen_id`.
- Test: `tests/unit/descarga/wallet-*-descarga-columnas.test.ts`:
  - «el monto se emite tal cual, sin recalcularlo» (R7) · «etiquetas legibles» (R8)
  - «no expone identificadores internos» (R23)
- **Depende de:** T0.4 · **Cubre:** R7, R8, R23 · **Hecho:** tests verdes en los 4 módulos.
- **MEDIDO (2026-07-31):** 22 verdes. El monto viaja como STRING tal cual, sin `Number` y sin
  el símbolo de colón (que rompería la celda como número); el test lo demuestra con
  `"1000.10"`, que un `Number` intermedio devolvería como `"1000.1"` — los céntimos.
- **Pieza compartida nueva:** `lib/utils/fecha-dia-iso.ts`. Los cuatro ledgers exponen
  `fechaMovimiento` como STRING ISO y las cuatro tablas lo pintan con `.slice(0, 10)`;
  repetir ese `slice` en cuatro módulos son cuatro sitios donde el criterio puede divergir.
  Además, llamar a un MÉTODO sobre un campo revienta la sonda de la guardia T0.4, así que el
  helper coacciona con `String(...)` y usa una expresión regular: sobrevive a la sonda y
  CONSERVA su rastro, que es lo que permite a la guardia decir de qué campo salió la celda.
- Los dos ledgers de mensajero declaran módulos SEPARADOS (misma tabla, dos superficies con
  alcances distintos) y un test de paridad comprueba que hoy proyectan la misma fila.

### [ ] T C.4 — Cableado de los cuatro ledgers
- Los componentes de presentación **no pasan a fetchear**: reciben la función por props.
- Test: `tests/components/descarga/WalletDescarga.test.tsx`
  - «cada ledger ofrece su control con nombre accesible» (R1, R13)
  - «usa los filtros de fecha vigentes» (R10) · «trae todo el ledger» (R9)
  - «los de presentación no fetchean» (R32) · «los cuatro siguen igual» (R3)
- **Depende de:** T C.2, T C.3 · **Cubre:** R1, R3, R9, R10, R13, R32
- **Hecho:** 5 tests verdes.

## Tanda D — Dinero por props (frontend puro)

### [ ] T D.1 [P] — Saldos de tiendas
### [ ] T D.2 [P] — Cuentas por pagar a mensajeros (respeta la búsqueda de cliente)
### [ ] T D.3 [P] — Plantillas de gasto fijo
- Módulo de columnas + `descarga` con `filasLocales` sobre el array que la tabla ya pinta (en
  D.2, sobre `filtrados`, no sobre `mensajeros`).
- Test: `tests/components/descarga/WalletPropsDescarga.test.tsx`
  - «las tres ofrecen su control» (R1) · «cuentas por pagar exporta solo lo que la búsqueda
    deja a la vista» (R10) · «ninguna relee» (R30, R32)
  - «montos tal cual» (R7) · «rechaza con el error de tope» (R26)
- **Depende de:** T0.2, T0.4 · **Cubre:** R1, R7, R10, R26, R30, R32
- **Hecho:** 5 tests verdes.

## Tanda E — Cierres e incidentes (frontend puro, 11 tablas)

### [ ] T E.1 [P] — Cierres del día del admin (pendientes + histórico)
### [ ] T E.2 [P] — Cierres de bodega del admin (pendientes + resueltos)
### [ ] T E.3 [P] — Consolidación de bodega (consolidables + solicitados)
### [ ] T E.4 [P] — Cierre del día del mensajero (gestiones por resultado + cierres solicitados)
### [ ] T E.5 [P] — Gestiones del cierre en el detalle compartido (`DetalleSecciones`)
### [ ] T E.6 [P] — Incidentes (pendientes + histórico)
- **E.5 (P2 RATIFICADA):** una descarga POR SECCIÓN de resultado, con el resultado en el
  título. El detalle trae URL FIRMADAS de evidencia: **no se exportan**; si se quiere el dato,
  va como «Tiene evidencia: sí/no».
- Test: `tests/components/descarga/CierresDescarga.test.tsx` e `IncidentesDescarga.test.tsx`
  - «cada una de las 11 ofrece su control» (R1)
  - «el archivo del adminSatelite solo trae cierres de su zona» (R14, R20)
  - «ninguna URL firmada ni ruta de almacenamiento llega al archivo» (R22)
  - «estados y causas como etiqueta legible» (R8) · «respeta el orden de pantalla» (R11)
  - «descargar no cambia la fila expandida ni el modal abierto» (R37)
- **Depende de:** T0.2, T0.4 · **Cubre:** R1, R8, R11, R14, R20, R22, R37
- **Hecho:** tests verdes para las 11; añadir la URL firmada hace fallar T0.4.

## Tanda F — Ranking

### [ ] T F.1 — Ranking del día
- `ranking-descarga-columnas.ts` (posición, mensajero, porcentaje, entregadas, asignadas) +
  `filasLocales`. Porcentaje y conteo **tal cual llegan del servidor**.
- Test: `tests/components/descarga/RankingDescarga.test.tsx`
  - «el ranking ofrece su control» (R1) · «porcentaje y conteo tal cual» (R7)
  - «respeta el orden del ranking» (R11) · «la tabla de premios NO ofrece control» (R2)
- **Depende de:** T0.2, T0.5 · **Cubre:** R1, R2, R7, R11 · **Hecho:** 4 tests verdes.

## Tanda G — Cierre de la FASE 1

### [ ] T G.1 — Consistencia transversal del control
- Test: `tests/components/descarga/ControlDescargaTransversal.test.tsx`, parametrizado sobre
  las tres formas (A con filtros, A sin filtros, B con filtro de cliente):
  - «genera xlsx y ninguna tabla ofrece elección de formato» (R34)
  - «el contenido lo produce la función común» (R33)
  - «en carga y sin reentrada» (R35) · «no altera página/selección/filas» (R37)
  - «sin subida ni almacenamiento» (R38)
- **Depende de:** tandas A–F · **Cubre:** R33, R34, R35, R37, R38 · **Hecho:** 5 verdes.

### [ ] T G.2 — Round-trip de volumen y entrega parcial
- Test: `tests/integration/descarga-170-volumen.test.ts`
  - «un archivo de N filas se relee con las mismas cabeceras y el mismo nº de filas» (R28)
  - «con N+1 filas no se produce archivo y el mensaje trae total y tope» (R26, R27)
- Test: `tests/components/descarga/rollout-parcial.test.tsx`
  - «una tabla sin la prop no renderiza control y se comporta como antes» (R39)
- Registrar en `progress/impl_170.md` el peso medido del `xlsx` de N filas para la tabla más
  ancha; si supera lo estimado, la salida es BAJAR `N`, nunca truncar.
- **Depende de:** T G.1 · **Cubre:** R39 + refuerzo R26–R28
- **Hecho:** tests verdes, medición anotada, `./init.sh` verde.
- **FIN DE FASE 1: el pedido original del humano queda entregado.**

---

# FASE 2 — PAGINACIÓN SERVER-SIDE (decisión P6)

## Tanda H — Base de paginación (bloquea I–L)

### [ ] T H.1 [P] — Configuración de tamaño de página por dominio
- Ampliar `lib/config/<dominio>.ts` con `DEFAULT_PAGE_SIZE` / `MAX_PAGE_SIZE` para los dominios
  que hoy no lo tienen (cierres, cierre de bodega, incidentes, wallet-tienda, gasto fijo,
  recepción satélite), con el patrón `readPositiveInt` ya vigente. Ver Q2.
- Test: `tests/unit/config/paginacion-dominios.test.ts`
  - «cada dominio nuevo declara default y máximo, y el default no supera el máximo» (R40)
- **Depende de:** — · **Cubre:** R40 · **Hecho:** test verde; ningún literal de tamaño en `app/`.

### [ ] T H.2 — Contrato de listado paginado
- Documentar y tipar el contrato común `{ items, page, pageSize, total }` para los 13 listados,
  reusando lo que ya devuelven órdenes/usuarios/plantillas/API keys.
- Test: `tests/unit/descarga/contrato-paginado.test.ts`
  - «todo listado paginado devuelve el total junto a la página» (R41)
- **Depende de:** T H.1 · **Cubre:** R41 · **Hecho:** test verde.

### [ ] T H.3 [P] — Guardia de contadores de cabecera
- Test: `tests/unit/descarga/contadores-cabecera.guardia.test.ts`
  - «ninguna pantalla con listado paginado deriva su contador de la longitud del array» (R42)
- Guardia estática: busca `({X.length})` junto a un `DataTable` con `Pagination`.
- **Depende de:** — · **Cubre:** R42 · **Hecho:** test verde; falla si se reintroduce el patrón.

## Tanda I — Riesgo BAJO: 7 listados de solo lectura

### [ ] T I.1 — Backend: `listar` paginado de los 7
- Cierres del día histórico · Cierres de bodega resueltos · Cierres de bodega solicitados ·
  Cierres solicitados del mensajero · Incidentes histórico · Saldos de tiendas · Plantillas de
  gasto fijo.
- Reusar el `construirWhere` que la fase 1 ya extrajo para `listarCompleto` de cada servicio.
- Test: `tests/unit/services/*-paginado.test.ts`, por listado:
  - «devuelve la página pedida y el total del conjunto» (R40, R41)
  - «el conjunto paginado y el dataset completo coinciden para el mismo actor» (R44)
  - «conserva el criterio de ordenación actual» (R51)
  - «no ejecuta más consultas que el listado sin paginar, salvo el conteo» (R54)
- **Depende de:** T H.2, T B.1/T C.1 (por el `construirWhere`) · **Cubre:** R40, R41, R44, R51, R54
- **Hecho:** tests verdes en los 7.

### [ ] T I.2 — Frontend: `Pagination` + `initialData` en los 7
- Server Component pre-carga página 1; módulo con SWR + `<Pagination>`. Molde: `UsuariosModule`.
- Test: `tests/components/paginacion/BajoRiesgoPaginacion.test.tsx`
  - «cada listado navega entre páginas y el control tiene nombre accesible» (R43)
  - «la descarga sigue entregando el dataset completo, no la página» (R52)
  - «el usuario ve exactamente las mismas filas que antes en la página 1» (R44)
- **Depende de:** T I.1 · **Cubre:** R43, R44, R52 · **Hecho:** tests verdes en los 7.

## Tanda J — Riesgo MEDIO: 4 colas con contador de cabecera

### [ ] T J.1 — Backend: `listar` paginado de las 4 colas
- Cierres del día pendientes · Cierres de bodega pendientes · Cierres del día a consolidar ·
  Incidentes pendientes. Mismo procedimiento que T I.1.
- Test: mismos 4 casos de T I.1 por listado, más:
  - «los totales agregados de dinero siguen calculándose sobre el conjunto completo» (R49)
- **Depende de:** T H.2 · **Cubre:** R40, R41, R44, R49, R51, R54 · **Hecho:** tests verdes.

### [ ] T J.2 — Frontend: paginación + contador por `total`
- Sustituir `({array.length})` por el total del servidor en los 4 puntos verificados
  (`design.md §11.3`).
- Test: `tests/components/paginacion/ColasPaginacion.test.tsx`
  - «el contador de cabecera muestra el total del servidor, no el tamaño de página» (R42)
  - «cambiar de página no altera los totales, los avisos de bloqueo ni los formularios» (R50)
  - «la descarga sigue entregando el dataset completo» (R52)
- **Depende de:** T J.1, T H.3 · **Cubre:** R42, R43, R50, R52 · **Hecho:** tests verdes.

## Tanda K — Riesgo ALTO: bodega satélite (rol `adminSatelite`)

### [ ] K.1 — Backend: filtros al servidor + `listar` paginado
- Mover los tres filtros (estado ∧ cantón ∧ distrito) al servicio de recepción satélite, con
  lista blanca `.strict()`; paginar; conservar el acotamiento por zona del actor.
- Test: `tests/unit/services/recepcion-satelite-paginado.test.ts`
  - «para los mismos valores de filtro devuelve el mismo conjunto que el filtro de cliente» (R45)
  - «el filtro no amplía el alcance de zona del actor» (R44)
  - «devuelve la página y el total» (R40, R41) · «conserva el orden actual» (R51)
- **Depende de:** T H.2 · **Cubre:** R40, R41, R44, R45, R51
- **Hecho:** tests verdes; el conjunto filtrado se compara contra el resultado del filtro de
  cliente actual, caso a caso (es la red de seguridad del cambio).

### [ ] K.2 — Backend: catálogos de cantón y distrito acotados por rol
- Acción de catálogos independiente del recorte de página, molde `lib/actions/filtros-ordenes.ts`.
- Test: `tests/unit/actions/satelite-catalogos.test.ts`
  - «ofrece todas las opciones del conjunto del actor, no solo las de la página» (R46)
  - «no ofrece opciones de zonas ajenas al actor» (R44)
- **Depende de:** K.1 · **Cubre:** R44, R46 · **Hecho:** tests verdes. **Ver Q5.**

### [ ] K.3 — Frontend: paginación, selección por página y acciones de lote
- Test: `tests/components/paginacion/SatelitePaginacion.test.tsx`
  - «navega entre páginas» (R43)
  - «seleccionar todo marca exactamente las filas de la página visible» (R47)
  - «las acciones de lote se deciden sobre lo seleccionado, no sobre el conjunto» (R48)
  - «los desplegables de cantón y distrito conservan todas sus opciones» (R46)
  - «la descarga sigue entregando el dataset completo con los filtros vigentes» (R52)
- **Depende de:** K.2 · **Cubre:** R43, R46, R47, R48, R52
- **Hecho:** tests verdes. **Verificación en pantalla pendiente de Q4.**

## Tanda L — Riesgo ALTO: cuentas por pagar (roles de acceso total)

### [ ] L.1 — Backend: búsqueda por nombre al servidor + paginación
- Test: `tests/unit/services/wallet-cuentas-paginado.test.ts`
  - «para el mismo texto devuelve el mismo conjunto que la búsqueda de cliente» (R45)
  - «devuelve la página y el total» (R40, R41) · «conserva el orden» (R51)
- **Depende de:** T H.2 · **Cubre:** R40, R41, R45, R51 · **Hecho:** tests verdes.

### [ ] L.2 — Frontend: paginación + fila expandible
- Test: `tests/components/paginacion/CuentasPorPagarPaginacion.test.tsx`
  - «navega entre páginas» (R43)
  - «expandir el desglose funciona en cualquier página» (R50)
  - «la descarga sigue entregando el dataset completo» (R52)
- **Depende de:** L.1 · **Cubre:** R43, R50, R52
- **Hecho:** tests verdes. **Verificación en pantalla pendiente de Q4.**

## Tanda M — Cierre de la FASE 2

### [ ] M.1 — No-regresión transversal de la paginación
- Test: `tests/components/paginacion/paginacion-transversal.test.tsx`
  - «los 3 listados del Anexo IV siguen entregándose completos, sin control de página» (R53)
  - «ningún listado paginado hace más consultas por render que antes, salvo el conteo» (R54)
  - «toda descarga de un listado paginado entrega el dataset completo» (R52)
- **Depende de:** I, J, K, L · **Cubre:** R52, R53, R54 · **Hecho:** tests verdes.

### [ ] M.2 — Verificación final y bitácora
- `./init.sh` verde, `pnpm typecheck` y `pnpm lint` sin deltas, suite completa sin regresiones.
- Completar `progress/impl_170.md` con la tabla `R<n> → archivo::nombre del test`, el censo
  final (25 export / 13 paginados / 3 exclusiones del Anexo IV) y la medición de volumen.
- **Depende de:** M.1 · **Cubre:** trazabilidad · **Hecho:** tabla completa sin huecos R1–R54.

---

## Trazabilidad R → task / test

| R | Task | Test |
| --- | --- | --- |
| R1 | A.1, A.2, B.4, C.4, D.*, E.*, F.1 | un «ofrece la descarga» por tabla |
| R2 | T0.5, F.1 | `cobertura-tablas.guardia` :: exclusiones sin control |
| R3 | A.1, B.4, C.4 | «el listado sigue comportándose igual» |
| R4 | T0.5 | `cobertura-tablas.guardia` :: tabla nueva sin registrar falla |
| R5 | B.3, C.3, D.*, E.*, F.1 | cada `*-descarga-columnas.test` :: columnas enumeradas |
| R6 | B.3 | «un campo nuevo del DTO no aparece hasta declararlo» |
| R7 | B.3, C.3, D.*, F.1 | «valores crudos» / «monto tal cual» / «porcentaje tal cual» |
| R8 | B.3, C.3, E.* | «etiqueta legible, no valor interno» |
| R9 | A.1, B.1, B.4, C.1, C.4 | «sin recorte por página» (servicio + componente) |
| R10 | A.1, A.2, C.4, D.2 | «filtros vigentes al descargar» |
| R11 | T0.2, B.1, C.1, E.*, F.1 | «mismo criterio de orden que el listado» |
| R12 | B.4 | «el nombre del archivo identifica listado y fecha» |
| R13 | B.4, C.4 | «control con nombre accesible» |
| R14 | A.2, C.1, C.2, E.* | «ni una fila ajena al alcance del actor» |
| R15 | C.1 | «un filtro inyectado no amplía el alcance» |
| R16 | B.2, C.2 | «unauthenticated y ninguna fila» |
| R17 | B.1, C.1 | «forbidden y ninguna fila» |
| R18 | B.2, C.2 | «clave fuera de la lista blanca → validation_error» |
| R19 | B.1 | «excluye las filas que el listado excluye» |
| R20 | A.2, E.* | acotamiento verificado tabla a tabla |
| R21 | T0.4 | `columnas-sensibles.guardia` :: credenciales |
| R22 | T0.4, E.5 | `columnas-sensibles.guardia` :: rutas y URL firmadas |
| R23 | T0.4, B.3, C.3 | «no expone identificadores internos» |
| R24 | B.3 | «no emite campos que el listado no muestra» |
| R25 | T0.4 | «la guardia cubre todas las declaraciones del árbol» |
| R26 | T0.2, D.*, G.2 | «rechaza con el error de tope» |
| R27 | T0.2, B.1, B.2, C.1, B.4, G.2 | «limite_excedido con total y tope, sin filas» |
| R28 | T0.2, G.2 | «sin truncado silencioso» + round-trip |
| R29 | B.1, C.1 | «nunca pide al repositorio más de N+1 filas» |
| R30 | A.2, D.* | «no ejecuta ninguna lectura adicional» |
| R31 | T0.2 | «resultado vacío: sin archivo, con aviso» |
| R32 | A.2, C.4, D.* | «no aumenta las consultas del listado» |
| R33 | G.1 | «el contenido lo produce la función común» |
| R34 | G.1 | «xlsx y sin elección de formato» |
| R35 | G.1 | «sin reentrada mientras está en curso» |
| R36 | T0.2 | «mensaje accionable sin datos personales» |
| R37 | E.*, G.1 | «no altera página, selección ni modal» |
| R38 | G.1 | «sin subida ni almacenamiento» |
| R39 | G.2 | `rollout-parcial` :: tabla sin la prop se comporta como antes |
| R40 | H.1, I.1, J.1, K.1, L.1 | «devuelve la página pedida y el total» |
| R41 | H.2, I.1, J.1, K.1, L.1 | `contrato-paginado` :: total junto a la página |
| R42 | H.3, J.2 | «el contador muestra el total del servidor» |
| R43 | I.2, J.2, K.3, L.2 | «navega entre páginas con nombre accesible» |
| R44 | I.1, I.2, J.1, K.1, K.2 | «paginado y dataset completo coinciden para el mismo actor» |
| R45 | K.1, L.1 | «mismo conjunto que producía el filtro/búsqueda de cliente» |
| R46 | K.2, K.3 | «todas las opciones, no solo las de la página» |
| R47 | K.3 | «seleccionar todo marca exactamente la página visible» |
| R48 | K.3 | «las acciones de lote se deciden sobre lo seleccionado» |
| R49 | J.1 | «los totales agregados siguen sobre el conjunto completo» |
| R50 | J.2, L.2 | «cambiar de página no altera totales ni formularios» |
| R51 | I.1, J.1, K.1, L.1 | «conserva el criterio de ordenación actual» |
| R52 | I.2, J.2, K.3, L.2, M.1 | «la descarga sigue entregando el dataset completo» |
| R53 | M.1 | «los 3 del Anexo IV siguen completos, sin control de página» |
| R54 | I.1, J.1, M.1 | «sin más consultas por render, salvo el conteo» |

## Orden de ejecución

```
FASE 1 (export) — entrega el pedido del humano
  T0.1 ─┬─ T0.2 ── T0.3            T0.4 [P]     T0.5 [P]
        │
   ┌────┴────┬──────────┬──────────┬──────────┬──────────┐
   A         B          C          D          E          F     (independientes entre sí)
 A.1,A.2   B.1→B.2    C.1→C.2   D.1,D.2,   E.1…E.6     F.1
   [P]       B.3 [P]    C.3 [P]    D.3 [P]     [P]
             └→ B.4     └→ C.4
   └─────────┴──────────┴──────────┴──────────┴──────────┘
                          └→ G.1 → G.2      ◄── FIN DE FASE 1

FASE 2 (paginación) — riesgo creciente
  H.1 → H.2      H.3 [P]
        └──┬───────────┬───────────┬───────────┐
           I.1→I.2   J.1→J.2   K.1→K.2→K.3   L.1→L.2
           (bajo)    (medio)   (satélite)   (cuentas)
           └──────────┴───────────┴───────────┘ → M.1 → M.2
```

**Reparto por PR:** 14 PRs, uno por tanda. La tanda E puede partirse en dos (E.1-E.3 admin ·
E.4-E.6 mensajero e incidentes) y la I en dos (4 históricos · 3 catálogos) si el diff supera lo
revisable. Ninguna tanda deja el sistema roto.
