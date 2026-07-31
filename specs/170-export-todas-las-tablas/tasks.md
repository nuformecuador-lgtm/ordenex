# Feature 170 — Descarga a Excel en todas las tablas · tasks

> Checklist de pasos discretos y verificables. `[P]` = paralelizable con las tareas del
> mismo bloque. Cada task declara dependencias, criterio de HECHO y los `R<n>` que cubre.
> **Ninguna task arranca antes de la aprobación humana del spec (`spec_ready` → aprobado).**
>
> Cobertura obligatoria: R1–R39, todos mapeados a un test concreto (ver §Trazabilidad).
> Orden dentro de una tanda `fullstack`: **backend → frontend** (regla del arnés).

---

## Tanda 0 — Base compartida (bloquea todo lo demás)

### [ ] T0.1 [P] — Tipo del resultado «completo»
- Crear `lib/types/descarga-listado.ts` con `ListarCompletoResult<T>` (`ok` con
  `items`/`total`, `limite_excedido` con `total`/`limite`, y el `ActionError` común).
- Reexpresar `ListarOrdenesCompletoResult` (`lib/types/orden.ts:167-171`) en términos del
  tipo nuevo, sin cambiar su forma pública.
- **Depende de:** —
- **Hecho:** `pnpm typecheck` verde; el módulo no importa React, Prisma ni `lib/services`.

### [ ] T0.2 — Adaptadores cliente + mensajes canónicos
- Crear `components/shared/descarga-resultado.ts` con `filasDesdeResultado(res, proyectar)`
  (Familia A), `filasLocales(filas, proyectar)` (Familia B, con el tope de
  `descargaConfig.MAX_FILAS`), `mensajeLimite(total, limite)` y `SUFIJO_REINTENTO`.
  Los textos se PROMUEVEN sin editarlos desde `OrdenesModule.tsx:75-88`.
- Test: `tests/unit/components/descarga-resultado.test.ts`
  - «traduce el resultado ok a filas proyectadas, en el mismo orden» (R11)
  - «traduce limite_excedido a un error accionable con total y tope, sin filas» (R27)
  - «traduce cualquier error de acción a un mensaje accionable sin datos personales» (R36)
  - «filasLocales rechaza y no produce archivo cuando el array supera el tope» (R26, R27)
  - «filasLocales no trunca: o devuelve todas las filas o el error» (R28)
  - «devuelve el resultado vacío tal cual para que el control avise sin archivo» (R31)
- **Depende de:** T0.1
- **Cubre:** R11, R26, R27, R28, R31, R36
- **Hecho:** los 6 tests verdes; ningún literal de mensaje duplicado en `app/`.

### [ ] T0.3 — Migrar `OrdenesModule` a los adaptadores (refactor sin cambio funcional)
- Sustituir el bloque inline `OrdenesModule.tsx:378-403` por `filasDesdeResultado`.
- Test: `tests/components/OrdenesDescarga.test.tsx` **sin modificar** debe seguir verde.
- **Depende de:** T0.2
- **Cubre:** — (habilitante; evita dos caminos)
- **Hecho:** suite de la 151 verde sin editar ni un test.

### [ ] T0.4 [P] — Guardia de datos sensibles
- Test: `tests/unit/descarga/columnas-sensibles.guardia.test.ts`
  - «ninguna declaración de columnas de export contiene claves de credencial, token o
    secreto» (R21)
  - «ninguna fila de export emite una ruta de almacenamiento ni una URL firmada» (R22)
  - «ninguna fila de export emite un identificador interno con forma de uuid» (R23)
  - «la guardia cubre TODAS las declaraciones presentes en el árbol, no una lista fija»
    (R25)
- La guardia descubre los módulos `*-descarga-columnas.ts` por convención de nombre; una
  declaración nueva entra sin tocar el test.
- **Depende de:** —
- **Cubre:** R21, R22, R23, R25
- **Hecho:** los 4 tests verdes y la guardia falla si se le añade a mano una columna
  `passwordHash` de prueba (mutación comprobada).

### [ ] T0.5 [P] — Guardia de cobertura del censo
- Crear `specs/170-export-todas-las-tablas/censo.json` (o equivalente en el test) con las 25
  tablas dentro de alcance y las 6 exclusiones justificadas del Anexo II.
- Test: `tests/unit/descarga/cobertura-tablas.guardia.test.ts`
  - «toda tabla del árbol o declara descarga o figura como exclusión justificada» (R4)
  - «las tablas declaradas fuera de alcance no montan control de descarga» (R2)
- **Depende de:** —
- **Cubre:** R2, R4
- **Hecho:** ambos tests verdes; añadir un `<DataTable>` nuevo sin registrar hace fallar la
  guardia (mutación comprobada).

---

## Tanda A — Órdenes (frontend puro, cero backend)

### [ ] T A.1 — Apartado de órdenes por estado
- `OrdenesApartado`: construir `descarga` en el render con
  `listarOrdenesCompleto({ estatusId })` + `COLUMNAS_DESCARGA_ORDENES` +
  `filaDescargaOrden` (ya existen, `ordenes-descarga-columnas.ts`).
- Test: `tests/components/descarga/OrdenesApartadoDescarga.test.tsx`
  - «ofrece la descarga del dataset completo del apartado» (R1)
  - «el archivo trae una fila por orden del apartado, no solo la página visible» (R9)
  - «envía el estado del apartado como filtro vigente» (R10)
  - «el listado paginado sigue comportándose igual» (R3)
- **Depende de:** T0.3
- **Cubre:** R1, R3, R9, R10
- **Hecho:** los 4 tests verdes; cero código nuevo en `lib/services`.

### [ ] T A.2 [P] — Órdenes de la bodega satélite
- Crear `app/(app)/recepcion-satelite/_components/satelite-descarga-columnas.ts`
  (`COLUMNAS_DESCARGA_SATELITE`, `filaSatelite`) y cablear `SateliteOrdenesListado` con
  `filasLocales` sobre el array **YA filtrado** por `construirFiltrosSatelite`.
- Test: `tests/components/descarga/SateliteDescarga.test.tsx`
  - «ofrece la descarga de las órdenes de la bodega» (R1)
  - «el archivo respeta los filtros de estado, cantón y distrito aplicados» (R10)
  - «la descarga no ejecuta ninguna lectura adicional al servidor» (R30, R32)
  - «el archivo solo contiene órdenes de la zona del actor» (R14, R20)
- **Depende de:** T0.2, T0.4
- **Cubre:** R1, R10, R14, R20, R30, R32
- **Hecho:** los 4 tests verdes; el módulo no importa `lib/actions` en el camino de descarga.

---

## Tanda B — Configuración (backend → frontend)

### [ ] T B.1 — `listarCompleto` en usuarios, plantillas y API keys
- Para CADA uno de los tres servicios: extraer el armado del `where` a un privado
  `construirWhere(input, actor)` **sin cambio de comportamiento** y añadir
  `listarCompleto(input, actor)` según `design.md §2.1` (`skip: 0`,
  `take: descargaConfig.MAX_FILAS + 1`, guard de tope). Ampliar su interfaz en
  `lib/interfaces/services/`.
- Test: `tests/unit/services/{usuario,plantilla,api-key}-descarga.test.ts`, en cada uno:
  - «devuelve todas las filas sin recorte por página» (R9)
  - «devuelve forbidden y ninguna fila cuando el rol no está autorizado» (R17)
  - «pide al repositorio el mismo criterio de orden que el listado paginado» (R11)
  - «excluye las filas que el listado excluye por borrado lógico o estado» (R19)
  - «devuelve limite_excedido con total y límite, sin filas» (R27)
  - «nunca pide al repositorio más de N+1 filas» (R29)
- **Depende de:** T0.1
- **Cubre:** R9, R11, R17, R19, R27, R29
- **Hecho:** 18 tests verdes (6 × 3) y las suites de listado existentes verdes SIN editar.

### [ ] T B.2 — Server Actions de los tres listados
- `lib/actions/{usuarios,plantillas,api-keys}.ts`: `listarXCompleto(input, deps)` calcada de
  `listarOrdenesCompleto` (`lib/actions/ordenes.ts:99-109`). Schema `.strict()` derivado del
  de listado, sin `page`/`pageSize`.
- Test: `tests/unit/actions/{usuarios,plantillas,api-keys}-descarga-action.test.ts`:
  - «devuelve unauthenticated y ninguna fila sin sesión» (R16)
  - «devuelve validation_error y ninguna fila con una clave fuera de la lista blanca» (R18)
  - «propaga limite_excedido tal cual» (R27)
- **Depende de:** T B.1
- **Cubre:** R16, R18
- **Hecho:** 9 tests verdes; ninguna rama devuelve filas junto a un error.

### [ ] T B.3 — Columnas de export de los tres listados
- Crear `usuarios-descarga-columnas.ts`, `plantillas-descarga-columnas.ts` y
  `api-keys-descarga-columnas.ts` junto a sus pantallas. **Usuarios:** nombre, email, rol
  legible, estado legible — sin `passwordHash` ni `id`. **API keys:** identificador, prefijo,
  usuario dedicado, fecha, estado — **sin `keyHash`, sin la clave, sin el secreto de
  webhook**. **Plantillas:** nombre, canal, estado, fecha — sin ids internos.
- Test: `tests/unit/descarga/{usuarios,plantillas,api-keys}-descarga-columnas.test.ts`:
  - «proyecta cada fila a valores crudos: texto, número o celda vacía» (R7)
  - «resuelve rol/estado/canal a su etiqueta legible, no a su valor interno» (R8)
  - «no expone identificadores internos ni banderas de borrado» (R23)
  - «no emite ningún campo que el listado no muestre en pantalla» (R24)
  - «un campo nuevo del DTO no aparece en el archivo hasta declararlo» (R6)
- **Depende de:** T0.4
- **Cubre:** R6, R7, R8, R23, R24
- **Hecho:** 15 tests verdes; la guardia de T0.4 los cubre además de forma genérica.

### [ ] T B.4 — Cableado de los tres módulos
- `UsuariosModule`, `PlantillasModule`, `ApiKeysModule`: `descarga` construida en el render
  con `filasDesdeResultado`.
- Test: `tests/components/descarga/ConfiguracionDescarga.test.tsx`
  - «cada uno de los tres listados ofrece su control de descarga con nombre accesible»
    (R1, R13)
  - «el archivo trae todas las filas, no solo la página visible» (R9)
  - «el nombre del archivo identifica el listado y la fecha» (R12)
  - «muestra el error de tope y no descarga archivo» (R27)
  - «los tres listados paginados siguen comportándose igual» (R3)
- **Depende de:** T B.2, T B.3
- **Cubre:** R1, R3, R9, R12, R13
- **Hecho:** los 5 tests verdes.

---

## Tanda C — Ledgers paginados (backend → frontend)

### [ ] T C.1 — `listarCompleto` en los cuatro servicios de dinero
- `WalletService` (caja), `WalletMensajeroService` (desglose de un mensajero **y** mis pagos)
  y `WalletTiendaService` (mis movimientos). Mismo procedimiento que T B.1.
- **Punto caliente:** «mis movimientos» acota por la tienda del actor y «mis pagos» por su
  `mensajero_id`. Ese acotamiento se escribe AL FINAL del `where`, como en órdenes.
- Test: `tests/unit/services/wallet-*-descarga.test.ts`, por servicio:
  - «devuelve todas las filas sin recorte por página» (R9)
  - «el archivo de la tienda A no contiene ni una fila de la tienda B» (R14)
  - «un filtro inyectado no amplía el alcance del actor» (R15)
  - «devuelve forbidden y ninguna fila cuando el rol no está autorizado» (R17)
  - «devuelve limite_excedido sin filas y nunca pide más de N+1» (R27, R29)
  - «mantiene el orden más reciente primero del listado» (R11)
- **Depende de:** T0.1
- **Cubre:** R9, R11, R14, R15, R17, R27, R29
- **Hecho:** los tests verdes en los 4 servicios; suites de listado existentes verdes sin
  editar. **R14/R15 son los tests que impiden la fuga: no se cierra la task sin ellos.**

### [ ] T C.2 — Server Actions de los cuatro ledgers
- Igual que T B.2, en `lib/actions/{wallet,wallet-mensajero,wallet-tienda}.ts`.
- Test: `tests/unit/actions/wallet-*-descarga-action.test.ts`:
  - «unauthenticated sin filas» (R16) · «clave fuera de la lista blanca» (R18)
  - «el actor no puede pedir el desglose de otro mensajero» (R14)
- **Depende de:** T C.1
- **Cubre:** R14, R16, R18
- **Hecho:** tests verdes; ninguna acción devuelve filas junto a un error.

### [ ] T C.3 [P] — Columnas de export de los cuatro ledgers
- Un módulo por pantalla. Money-safe: el monto viaja como **STRING tal cual**, sin
  `parseFloat`/`Number` (regla vigente en las 4 pantallas). Se exportan fecha, tipo legible,
  categoría/concepto legible, monto y origen legible; nunca ids ni `origen_id`.
- Test: `tests/unit/descarga/wallet-*-descarga-columnas.test.ts`:
  - «el monto se emite tal cual llegó, sin recalcularlo» (R7)
  - «tipo, categoría y origen salen como etiqueta legible» (R8)
  - «no expone identificadores internos» (R23)
- **Depende de:** T0.4
- **Cubre:** R7, R8, R23
- **Hecho:** tests verdes en los 4 módulos.

### [ ] T C.4 — Cableado de los cuatro ledgers
- `WalletLedger`, `DesglosePagosMensajero`, `DesgloseTiendaLedger`, `DesglosePagos`. Los
  componentes que reciben datos por props **no pasan a fetchear**: reciben el `obtenerFilas`
  (o el callback que lo construye) desde el módulo padre, que es quien conoce los filtros.
- Test: `tests/components/descarga/WalletDescarga.test.tsx`
  - «cada ledger ofrece su control con nombre accesible» (R1, R13)
  - «la descarga usa los filtros de fecha vigentes» (R10)
  - «el archivo trae todo el ledger, no la página visible» (R9)
  - «los componentes de presentación no fetchean: reciben la función por props» (R32)
  - «los cuatro listados paginados siguen comportándose igual» (R3)
- **Depende de:** T C.2, T C.3
- **Cubre:** R1, R3, R9, R10, R13, R32
- **Hecho:** los 5 tests verdes.

---

## Tanda D — Dinero por props (frontend puro)

### [ ] T D.1 [P] — Saldos de tiendas
### [ ] T D.2 [P] — Cuentas por pagar a mensajeros (respeta la búsqueda de cliente)
### [ ] T D.3 [P] — Plantillas de gasto fijo
- Para cada una: módulo `*-descarga-columnas.ts` + `descarga` con `filasLocales` sobre el
  array que la tabla ya pinta (en D.2, sobre `filtrados`, no sobre `mensajeros`).
- Test: `tests/components/descarga/WalletPropsDescarga.test.tsx`
  - «las tres tablas ofrecen su control de descarga» (R1)
  - «cuentas por pagar exporta solo lo que la búsqueda deja a la vista» (R10)
  - «ninguna de las tres ejecuta una lectura adicional al descargar» (R30, R32)
  - «los montos se emiten tal cual, sin recalcularlos» (R7)
  - «rechaza con el error de tope si el dataset supera N» (R26)
- **Depende de:** T0.2, T0.4
- **Cubre:** R1, R7, R10, R26, R30, R32
- **Hecho:** los 5 tests verdes.

---

## Tanda E — Cierres e incidentes (frontend puro, 11 tablas)

### [ ] T E.1 [P] — Cierres del día del admin (pendientes + histórico)
### [ ] T E.2 [P] — Cierres de bodega del admin (pendientes + resueltos)
### [ ] T E.3 [P] — Consolidación de bodega (consolidables + solicitados)
### [ ] T E.4 [P] — Cierre del día del mensajero (gestiones por resultado + cierres solicitados)
### [ ] T E.5 [P] — Gestiones del cierre en el detalle compartido (`DetalleSecciones`)
### [ ] T E.6 [P] — Incidentes (pendientes + histórico)
- Para cada grupo: su módulo `*-descarga-columnas.ts` + `descarga` con `filasLocales`.
- **E.5:** una descarga POR SECCIÓN de resultado, con el resultado en el título
  («Cierre · Entregadas»). El detalle trae URL FIRMADAS de evidencia: **no se exportan**; si
  se quiere el dato, va como «Tiene evidencia: sí/no».
- Test: `tests/components/descarga/CierresDescarga.test.tsx` y
  `tests/components/descarga/IncidentesDescarga.test.tsx`
  - «cada una de las 11 tablas ofrece su control de descarga» (R1)
  - «el archivo del adminSatelite solo contiene cierres de su zona» (R14, R20)
  - «ninguna URL firmada ni ruta de almacenamiento llega al archivo» (R22)
  - «los estados y las causas salen como etiqueta legible» (R8)
  - «el archivo respeta el orden que muestra la pantalla» (R11)
  - «descargar no cambia la fila expandida ni el modal abierto» (R37)
- **Depende de:** T0.2, T0.4
- **Cubre:** R1, R8, R11, R14, R20, R22, R37
- **Hecho:** los tests verdes para las 11 tablas; ninguna evidencia firmada en ningún
  archivo (mutación comprobada: añadir la URL hace fallar T0.4).

---

## Tanda F — Ranking

### [ ] T F.1 — Ranking del día
- `ranking-descarga-columnas.ts` (posición, mensajero, porcentaje, entregadas, asignadas) +
  `descarga` con `filasLocales`. El porcentaje y el conteo se emiten **tal cual llegan del
  servidor**, sin recalcular.
- Test: `tests/components/descarga/RankingDescarga.test.tsx`
  - «el ranking ofrece su control de descarga» (R1)
  - «emite el porcentaje y el conteo tal cual los resolvió el servidor» (R7)
  - «respeta el orden del ranking» (R11)
  - «la tabla de premios del podio NO ofrece control de descarga» (R2)
- **Depende de:** T0.2, T0.5
- **Cubre:** R1, R2, R7, R11
- **Hecho:** los 4 tests verdes.

---

## Tanda Z — Cierre

### [ ] T Z.1 — Consistencia transversal del control
- Test: `tests/components/descarga/ControlDescargaTransversal.test.tsx`, parametrizado sobre
  una muestra de las tres formas (A con filtros, A sin filtros, B con filtro de cliente):
  - «genera xlsx cuando la tabla no declara otro tipo» (R34)
  - «el contenido lo produce la función común: ninguna tabla arma su archivo» (R33)
  - «el control queda en carga y no admite una segunda ejecución simultánea» (R35)
  - «no altera página, selección ni filas visibles» (R37)
  - «el archivo no se sube a ningún servidor ni se almacena» (R38)
- **Depende de:** todas las tandas
- **Cubre:** R33, R34, R35, R37, R38
- **Hecho:** los 5 tests verdes.

### [ ] T Z.2 — Round-trip de volumen
- Test: `tests/integration/descarga-170-volumen.test.ts`
  - «un archivo de N filas se relee con las mismas cabeceras y el mismo número de filas»
    (R28)
  - «con N+1 filas no se produce archivo y el mensaje trae total y tope» (R26, R27)
- Registrar en `progress/impl_170.md` el peso medido del `xlsx` de N filas para la tabla más
  ancha; si supera lo estimado, la salida es BAJAR `N`, nunca truncar.
- **Depende de:** T Z.1
- **Cubre:** refuerzo R26, R27, R28
- **Hecho:** ambos tests verdes y la medición anotada.

### [ ] T Z.3 — Entregas parciales y verificación final
- Comprobar que tras CADA tanda el sistema queda usable: tablas cableadas descargan, tablas
  no cableadas se comportan como antes.
- Test: `tests/components/descarga/rollout-parcial.test.tsx`
  - «una tabla sin la prop no renderiza control y se comporta como antes» (R39)
- `./init.sh` verde, `pnpm typecheck` y `pnpm lint` sin deltas nuevos, suite completa sin
  regresiones respecto al baseline medido AL INICIO de la implementación.
- Escribir `progress/impl_170.md` con la tabla `R<n> → archivo::nombre del test` y el estado
  final del censo (25 dentro / 6 fuera).
- **Depende de:** T Z.2
- **Cubre:** R39 + trazabilidad
- **Hecho:** `init.sh` verde y tabla completa sin huecos R1–R39.

---

## Trazabilidad R → task / test

| R | Task | Test |
| --- | --- | --- |
| R1 | T A.1, T A.2, T B.4, T C.4, T D.1-3, T E.1-6, T F.1 | un «ofrece la descarga» por tabla |
| R2 | T0.5, T F.1 | `cobertura-tablas.guardia` :: exclusiones sin control |
| R3 | T A.1, T B.4, T C.4 | «el listado paginado sigue comportándose igual» |
| R4 | T0.5 | `cobertura-tablas.guardia` :: tabla nueva sin registrar falla |
| R5 | T B.3, T C.3, T D.*, T E.*, T F.1 | cada `*-descarga-columnas.test` (columnas enumeradas) |
| R6 | T B.3 | «un campo nuevo del DTO no aparece hasta declararlo» |
| R7 | T B.3, T C.3, T D.*, T F.1 | «valores crudos» / «monto tal cual» / «porcentaje tal cual» |
| R8 | T B.3, T C.3, T E.* | «etiqueta legible, no valor interno» |
| R9 | T A.1, T B.1, T B.4, T C.1, T C.4 | «sin recorte por página» (servicio + componente) |
| R10 | T A.1, T A.2, T C.4, T D.2 | «filtros vigentes en el momento de descargar» |
| R11 | T0.2, T B.1, T C.1, T E.*, T F.1 | «mismo criterio de orden que el listado» |
| R12 | T B.4 | «el nombre del archivo identifica listado y fecha» |
| R13 | T B.4, T C.4 | «control con nombre accesible» |
| R14 | T A.2, T C.1, T C.2, T E.* | «no contiene ni una fila ajena al alcance del actor» |
| R15 | T C.1 | «un filtro inyectado no amplía el alcance» |
| R16 | T B.2, T C.2 | «unauthenticated y ninguna fila» |
| R17 | T B.1, T C.1 | «forbidden y ninguna fila» |
| R18 | T B.2, T C.2 | «clave fuera de la lista blanca → validation_error» |
| R19 | T B.1 | «excluye las filas que el listado excluye» |
| R20 | T A.2, T E.* | acotamiento verificado tabla a tabla |
| R21 | T0.4 | `columnas-sensibles.guardia` :: credenciales |
| R22 | T0.4, T E.5 | `columnas-sensibles.guardia` :: rutas y URL firmadas |
| R23 | T0.4, T B.3, T C.3 | «no expone identificadores internos» |
| R24 | T B.3 | «no emite campos que el listado no muestra» |
| R25 | T0.4 | «la guardia cubre todas las declaraciones del árbol» |
| R26 | T0.2, T D.*, T Z.2 | «rechaza con el error de tope» |
| R27 | T0.2, T B.1, T B.2, T C.1, T B.4, T Z.2 | «limite_excedido con total y tope, sin filas» |
| R28 | T0.2, T Z.2 | «sin truncado silencioso» + round-trip |
| R29 | T B.1, T C.1 | «nunca pide al repositorio más de N+1 filas» |
| R30 | T A.2, T D.* | «no ejecuta ninguna lectura adicional» |
| R31 | T0.2 | «resultado vacío: sin archivo, con aviso» |
| R32 | T A.2, T C.4, T D.* | «no aumenta las consultas del listado» |
| R33 | T Z.1 | «el contenido lo produce la función común» |
| R34 | T Z.1 | «xlsx por defecto» |
| R35 | T Z.1 | «sin reentrada mientras está en curso» |
| R36 | T0.2 | «mensaje accionable sin datos personales» |
| R37 | T E.*, T Z.1 | «no altera página, selección ni modal» |
| R38 | T Z.1 | «sin subida ni almacenamiento» |
| R39 | T Z.3 | `rollout-parcial` :: tabla sin la prop se comporta como antes |

## Orden de ejecución sugerido

```
T0.1 ─┬─ T0.2 ── T0.3
      └─ T0.4 [P]      T0.5 [P]
             │
   ┌─────────┼──────────┬──────────┬──────────┬──────────┐
   A         B          C          D          E          F      (tandas independientes)
 A.1,A.2   B.1→B.2    C.1→C.2   D.1,D.2,   E.1…E.6     F.1
   [P]       B.3 [P]    C.3 [P]    D.3 [P]     [P]
             └→ B.4     └→ C.4
   └─────────┴──────────┴──────────┴──────────┴──────────┘
                              │
                       T Z.1 → T Z.2 → T Z.3
```

**Reparto por PR sugerido:** un PR por tanda (0, A, B, C, D, E, F, Z). La tanda E puede
partirse en dos (E.1-E.3 admin · E.4-E.6 mensajero e incidentes) si el diff supera lo
revisable. Ninguna tanda deja el sistema roto: la prop es opt-in (R39).
