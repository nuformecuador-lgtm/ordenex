# Feature 170 — Descarga a Excel en todas las tablas · design

> El QUÉ está en `requirements.md`. Aquí van el censo, el contrato por tabla, el reparto
> backend/frontend, el tratamiento del volumen y las alternativas descartadas.
>
> Todas las rutas y símbolos citados fueron verificados leyendo el archivo real en el
> worktree. Los números de línea son del estado de `dev` al 2026-07-31.

---

## §0 — Lo que se HEREDA de la 151 y NO se reabre

La feature 151 (mergeada, PR #201) entregó la capacidad completa. Esta feature no toca
ninguna de estas piezas salvo para consumirlas:

| Pieza | Ruta | Rol en la 170 |
| --- | --- | --- |
| Contrato de export | `lib/types/descarga.ts` | REUSO |
| Función común (despachador) | `lib/utils/descarga-dataset.ts > construirDescarga` | REUSO |
| Generador `xlsx` | `lib/utils/xlsx-template.ts > buildXlsxRows` | REUSO |
| Generador `csv` | `lib/utils/csv-template.ts > buildCsvRows` | REUSO |
| Entrega al navegador | `components/shared/descargar-blob.ts` | REUSO |
| Control de descarga | `components/shared/DescargarDatasetButton.tsx` | REUSO |
| Prop opt-in | `components/shared/DataTable.tsx > DataTableDescarga` (:91-160) | REUSO |
| Tope de filas | `lib/config/descarga.ts > descargaConfig.MAX_FILAS` (5000) | REUSO |
| Patrón «modo sin paginación» | `lib/services/OrdenService.ts > listarCompleto` (:330-363) | MOLDE |

Decisiones cerradas en el gate F1.4 de la 151 que aquí son AXIOMAS: el binario se arma en
el NAVEGADOR (no viaja base64 ni se abre route handler interno); el `DataTable` recibe una
FUNCIÓN `obtenerFilas`, nunca filtros ni urls; las columnas de export se declaran APARTE de
`Column<T>`; el tope es un ERROR accionable, nunca truncado silencioso; y quien puede ver un
listado puede descargar lo que ese listado ya le muestra (sin permiso nuevo).

La 151 dejó escrito el criterio de éxito de esta feature (`151/design.md §8`):

> «Cualquier otra tabla que quiera descarga en el futuro solo tiene que declarar sus
> columnas de export y su `obtenerFilas`; no debe tocar `DataTable`, ni el despachador, ni
> `descargar-blob`. Si al cablear la segunda tabla hiciera falta modificar el contrato de
> `DataTableDescarga`, eso es una señal de que este diseño falló.»

**Este diseño NO necesita modificar `DataTableDescarga`.** Es la validación de la 151.

---

## §1 — Censo (verificado con búsqueda, no de memoria)

Método: `<DataTable` en `app/**/*.tsx` → **25 archivos, 30 instancias**. Más una `<table>`
HTML cruda en `RankingModule.tsx:108`. Total censado: **31 tablas**.

### §1.1 — Familia A: la página visible es un RECORTE server-side (10 instancias: 9 dentro + 1 fuera)

| # | Tabla | Archivo | Rol | Fuente de datos | Estado |
| --- | --- | --- | --- | --- | --- |
| 1 | Órdenes | `app/(app)/ordenes/_components/OrdenesModule.tsx:463` | maestro·admin·adminTienda | `listarOrdenes` + `listarOrdenesCompleto` | **YA** |
| 2 | Apartado por estado | `app/(app)/ordenes/_components/OrdenesApartado.tsx:248` | maestro·admin | `listarOrdenes({estatusId})` | falta |
| 3 | Usuarios | `app/(app)/configuracion/_components/UsuariosModule.tsx:143` | maestro | `listarUsuarios({page,pageSize})` | falta |
| 4 | Plantillas de mensaje | `app/(app)/configuracion/plantillas/_components/PlantillasModule.tsx:168` | maestro | `listarPlantillas` | falta |
| 5 | API keys | `app/(app)/configuracion/api/_components/ApiKeysModule.tsx:177` | maestro | `listarApiKeys` | falta |
| 6 | Libro de movimientos (caja) | `app/(app)/wallet/_components/WalletLedger.tsx:133` | maestro·admin | `listarMovimientosAction` (paginado por `WalletModule`) | falta |
| 7 | Desglose por cierre de mensajero | `app/(app)/wallet/mensajeros/_components/DesglosePagosMensajero.tsx:282` | maestro·admin | `listarPagosDeMensajeroAction` | falta |
| 8 | Desglose de movimientos (tienda) | `app/(app)/mi-wallet/_components/DesgloseTiendaLedger.tsx:69` | adminTienda | `listarMisMovimientosAction` (por `MiWalletModule`) | falta |
| 9 | Desglose de pagos (mensajero) | `app/(app)/mis-pagos/_components/DesglosePagos.tsx:72` | mensajero | `listarMisPagosAction` (por `MisPagosModule`) | falta |
| — | Zonas | `app/(app)/configuracion/_components/ZonasModule.tsx:127` | **nadie** | `listarZonas` | **FUERA** |

Hallazgo: `ZonasModule` **no está montado en ninguna página**. `ConfiguracionPage` solo
renderiza `UsuariosModule` (`app/(app)/configuracion/page.tsx:51`); el propio
`tests/integration/configuracion/zonas-page.test.tsx:85-87` lo deja anotado. Las zonas se
gestionan hoy en `configuracion/tarifas` con `ZonasTarifasModule`, que **no usa `DataTable`**
(lista de tarjetas). Ver P4.

### §1.2 — Familia B: el dataset completo ya está en el cliente (20 instancias: 16 dentro + 4 fuera)

| # | Tabla | Archivo | Rol | Fuente de datos | Estado |
| --- | --- | --- | --- | --- | --- |
| 10 | Órdenes de la bodega satélite | `app/(app)/recepcion-satelite/_components/SateliteOrdenesListado.tsx:320` | adminSatelite | props de `listarRecepcionSatelite`; **filtros de cliente** | falta |
| 11 | Plantillas de gasto fijo | `app/(app)/wallet/_components/GastosFijosPlantillasPanel.tsx:154` | maestro·admin | props de `listarPlantillasAction` | falta |
| 12 | Saldos de tiendas | `app/(app)/wallet/tiendas/_components/SaldosTiendasTable.tsx:62` | maestro·admin | props de `listarSaldosTiendasAction` | falta |
| 13 | Cuentas por pagar a mensajeros | `app/(app)/wallet/mensajeros/_components/CuentasPorPagarTable.tsx:86` | maestro·admin | props de `listarCuentasPorPagarAction`; **búsqueda de cliente** | falta |
| 14 | Cierres pendientes de decisión | `app/(app)/cierres-admin/_components/CierresAdminModule.tsx:396` | maestro·admin·adminSatelite | props de `listarCierresAdmin` | falta |
| 15 | Cierres — histórico | `…/CierresAdminModule.tsx:410` | ídem | ídem | falta |
| 16 | Cierres de bodega pendientes | `…/CierresBodegaAdminModule.tsx:210` | maestro·admin | props de `listarCierresBodegaAdmin` | falta |
| 17 | Cierres de bodega resueltos | `…/CierresBodegaAdminModule.tsx:227` | maestro·admin | ídem | falta |
| 18 | Cierres del día a consolidar | `…/ConsolidacionBodegaModule.tsx:165` | adminSatelite | props de `listarConsolidacion` | falta |
| 19 | Cierres de bodega solicitados | `…/ConsolidacionBodegaModule.tsx:215` | adminSatelite | ídem | falta |
| 20 | Gestiones del cierre por resultado | `…/cierre-detalle-shared.tsx:968` (`DetalleSecciones`) | maestro·admin·adminSatelite | detalle bajo demanda (`verCierreDetalle`) | falta |
| 21 | Gestiones del cierre del día | `app/(app)/cierre-dia/_components/CierreDiaModule.tsx:374` | mensajero | props de `listarCierreDia` | falta |
| 22 | Cierres solicitados (mensajero) | `…/CierreDiaModule.tsx:421` | mensajero | ídem | falta |
| 23 | Incidentes pendientes | `app/(app)/incidentes/_components/IncidentesAdminModule.tsx:292` | maestro·admin·adminSatelite | props de `listarIncidentes` | falta |
| 24 | Incidentes — histórico | `…/IncidentesAdminModule.tsx:306` | ídem | ídem | falta |
| 25 | Ranking del día | `app/(app)/ranking/_components/RankingModule.tsx:91` | maestro·admin·mensajero | props de `verRanking` | falta |
| — | Órdenes por numerar | `app/(app)/ordenes/_components/GenerarGuiaModal.tsx:154` | maestro·admin | selección en memoria | **FUERA** |
| — | Resumen de carga masiva | `app/(app)/ordenes/_components/OrdenesCargaResumen.tsx:144` | quien carga | `resumenCargaMasiva` | **FUERA** |
| — | Órdenes con error | `app/(app)/ordenes/_components/OrdenesConErrorTabla.tsx:52` | quien carga | memoria (`BulkSummary`) | **FUERA** |
| — | Órdenes ya existentes | `app/(app)/ordenes/_components/OrdenesExistentesTabla.tsx:32` | quien carga | memoria (`BulkSummary`) | **FUERA** |

Las cuatro exclusiones del flujo de carga masiva se justifican con código: `OrdenesCargaResumen.tsx:6`
ya importa `DescargarManifiestoButton` (feature 148) y `OrdenesCargaPreview.tsx:19-20,190`
ya monta la descarga de filas con error (feature 143). Ese flujo NO carece de export: tiene dos.

### §1.3 — Fuera del `DataTable`

`app/(app)/ranking/_components/RankingModule.tsx:108` — tabla de PREMIOS del podio, `<table>`
HTML crudo, 3 filas con montos editables (`PremioInputRow`). Es configuración, no un listado
de datos. FUERA; ver P1.

### §1.4 — Recuento

**31 tablas censadas · 25 dentro de alcance (1 ya cableada + 24 por cablear) · 6 fuera.**

---

## §2 — El contrato por tabla: dos familias, un solo contrato de UI

La respuesta a «¿el patrón de `OrdenService.listarCompleto` se generaliza?» es **sí, pero
solo para la Familia A**. Forzarlo en la Familia B inventaría una Server Action redundante
para leer un dato que la pantalla ya tiene.

```
                                   DataTableDescarga (151, SIN CAMBIOS)
                                   { titulo, columnas, obtenerFilas }
                                              ▲
                     ┌────────────────────────┴────────────────────────┐
             Familia A                                          Familia B
   obtenerFilas = Server Action                        obtenerFilas = proyección local
   `listarXCompleto(filtrosVigentes)`                  de las filas que ya están en props
             │                                                       │
   Servicio.listarCompleto  ──►  mismo `where`                 Server Component padre
   mismo acotamiento por rol      take = N+1                    ya autorizó y acotó
```

### §2.1 — Familia A (9 tablas por cablear; 1 ya hecha)

Cada servicio gana un `listarCompleto(input, actor)` **calcado** de
`OrdenService.listarCompleto` (`OrdenService.ts:330-363`):

1. Guard de rol idéntico al de `listar`.
2. El `where` se construye con el MISMO código que usa `listar`. Donde ese armado esté
   inline, se extrae primero a un privado `construirWhere(input, actor)` **sin cambio de
   comportamiento** (es exactamente lo que hizo la task T5 de la 151), de modo que ambos
   caminos no puedan divergir en autorización ni en acotamiento.
3. `repo.list({ where, sortBy, sortDir, skip: 0, take: descargaConfig.MAX_FILAS + 1 })`.
4. `total > MAX_FILAS` → `{ status: "limite_excedido", total, limite }`, descartando items.
5. Mismos enriquecimientos que `listar` (p. ej. el merge de intentos de la 160), para que la
   columna del archivo no diverja de la de pantalla.

**Excepción verificada: la tabla #2 (apartado por estado) NO necesita backend nuevo.**
`listarOrdenesCompletoSchema` es `listarOrdenesSchema.omit({page, pageSize})`
(`lib/types/orden.ts:161-165`) y `listarOrdenesSchema` ya incluye `estatusId`, así que
`listarOrdenesCompleto({ estatusId })` cubre el apartado tal cual. Cero código de servidor.

⇒ **7 `listarCompleto` nuevos**: usuarios, plantillas, api-keys, wallet (caja),
wallet-mensajero (desglose de un mensajero), wallet-tienda (mis movimientos),
wallet-mensajero (mis pagos).

### §2.2 — Familia B (16 tablas)

`obtenerFilas` NO llama a nada: proyecta a filas de export el mismo array que la tabla está
pintando, **después** de los filtros de cliente que esa pantalla aplique. Esto cumple R30
(sin segunda lectura) y R10 (filtros vigentes) a la vez, y es lo único correcto: el Server
Component padre ya resolvió permisos y alcance (`docs/architecture.md`), así que releer sería
duplicar trabajo y abrir una segunda superficie que autorizar.

Dos tablas tienen filtro de cliente y el export DEBE partir del array YA filtrado:
- `SateliteOrdenesListado`: `construirFiltrosSatelite` (estado/cantón/distrito).
- `CuentasPorPagarTable`: búsqueda por nombre (`filtrados`, :76-80).

---

## §3 — Piezas nuevas (compartidas) y por qué existen

Sin estas cuatro piezas, el rollout copia y pega el mismo bloque 24 veces.

| Pieza | Ruta | Qué resuelve |
| --- | --- | --- |
| Tipo del resultado «completo» | `lib/types/descarga-listado.ts` | `ListarCompletoResult<T> = {status:"ok"; items:T[]; total:number} \| {status:"limite_excedido"; total; limite} \| ActionError`. Hoy ese union está escrito a mano en `lib/types/orden.ts:167-171`; se generaliza para que los 7 servicios nuevos no lo reinventen cada uno con matices. |
| Adaptador cliente Familia A | `components/shared/descarga-resultado.ts > filasDesdeResultado(res, proyectar)` | Traduce `ListarCompletoResult<T>` a `DescargaFilasResult`, incluidos los mensajes de tope y de error. Es EXACTAMENTE el bloque `OrdenesModule.tsx:382-401`, hoy inline. |
| Adaptador cliente Familia B | `components/shared/descarga-resultado.ts > filasLocales(filas, proyectar)` | Aplica el tope sobre un array ya en memoria y devuelve `DescargaFilasResult`. Sin él, 16 tablas reinventan la comprobación (y alguna se la salta). |
| Mensajes canónicos | mismo módulo | `mensajeLimite(total, limite)` y `SUFIJO_REINTENTO`, hoy privados en `OrdenesModule.tsx:75-88`. Se PROMUEVEN sin cambiar el texto, para que las 25 tablas digan lo mismo. |

`OrdenesModule` se refactoriza para consumirlos, de modo que la tabla ya cableada y las 24
nuevas compartan literalmente el mismo camino (y el mismo test).

Por tabla, además: un módulo puro `<tabla>-descarga-columnas.ts` **junto a la pantalla**
(precedente exacto: `app/(app)/ordenes/_components/ordenes-descarga-columnas.ts`), con
`COLUMNAS_DESCARGA_<X>: DescargaColumna[]` y `fila<X>(dto): DescargaFila`. Sin React, sin
DOM. Se enumeran a mano, nunca por reflexión sobre el DTO (R6).

**Sin modelo de datos nuevo.** Esta feature NO crea tablas, NO altera columnas, NO añade
índices y NO tiene migración Prisma (y por tanto tampoco `down.sql`). Tampoco cambia RLS: no
hay superficie de lectura nueva — cada dataset completo es el mismo conjunto de filas que el
actor ya puede leer paginado o que ya recibe por props.

---

## §4 — Backend: los 7 `listarCompleto` nuevos

| Servicio | Interfaz | Entrada (schema) | Notas de acotamiento verificadas |
| --- | --- | --- | --- |
| `UsuarioService` | `IUsuarioService` | `listarUsuariosSchema` sin `page`/`pageSize` | Solo `maestro` llega aquí (`ConfiguracionPage:18`); el servicio mantiene su guard. |
| `PlantillaService` | `IPlantillaService` | ídem | Solo `maestro`. |
| `ApiKeyService` | `IApiKeyService` | ídem | Solo `maestro`. **El DTO ya excluye `keyHash` y el secreto** (`lib/types/api-key.ts:74`), invariante R6 de la 82. |
| `WalletService` (caja) | `IWalletService` | schema de `listarMovimientosAction` sin paginación | Roles de acceso total (`esAccesoTotal`, `wallet/page.tsx:25`). |
| `WalletMensajeroService` (desglose de UN mensajero) | `IWalletMensajeroService` | filtros `cierreId`/`desde`/`hasta` | Acceso total; el `mensajeroId` es parte del input. |
| `WalletTiendaService` (mis movimientos) | `IWalletTiendaService` | filtros de la pantalla | **Acotado a la tienda del actor** (`mi-wallet/page.tsx:25`, rol `adminTienda`). El acotamiento se escribe AL FINAL del `where`, igual que en órdenes. |
| `WalletMensajeroService` (mis pagos) | ídem | ídem | **Acotado al `mensajero_id` del actor** (`mis-pagos/page.tsx:26`). |

Borde: una Server Action por servicio, calcada de `listarOrdenesCompleto`
(`lib/actions/ordenes.ts:99-109`): `withErrorHandler` → `resolveActorFromSession` →
`UnauthenticatedError` si no hay actor (R16) → `parse` con el schema `.strict()` (R18) →
`service.listarCompleto` → `toActionError`. Ninguna devuelve filas junto a un error.

Las dos últimas filas de la tabla son el punto caliente de R14/R15: son las únicas de
Familia A con rol acotado por dato propio. Sus tests de fuga son obligatorios y explícitos
(«el desglose de la tienda A no contiene ni una fila de la tienda B aunque se inyecte el
filtro»).

---

## §5 — Frontend: cableado por tabla

Patrón único, idéntico al que ya usa `OrdenesModule.tsx:378-403`:

```ts
// Familia A
descarga={{
  titulo: "Usuarios",
  columnas: COLUMNAS_DESCARGA_USUARIOS,
  obtenerFilas: () => filasDesdeResultado(listarUsuariosCompleto(filtrosVigentes), filaUsuario),
}}

// Familia B
descarga={{
  titulo: "Saldos de tiendas",
  columnas: COLUMNAS_DESCARGA_SALDOS,
  obtenerFilas: () => filasLocales(tiendas, filaSaldoTienda),
}}
```

Reglas de cableado:
- La config se construye **en el render**, no en un `useMemo` con dependencias: así el
  closure lee los filtros de ESE render y la descarga siempre refleja lo vigente (R10).
- Ninguna tabla recibe filtros ni urls: solo la función (contrato de la 151, R29 de aquélla).
- `titulo` = el nombre que el usuario ve en la pantalla. Es también el nombre de la hoja, la
  base del nombre de archivo (R12) y parte del nombre accesible del control (R13).
- Los componentes que reciben datos por props y hoy son «tontos» (`SaldosTiendasTable`,
  `DesglosePagos`, `DesgloseTiendaLedger`, `WalletLedger`) construyen su `descarga` con lo
  que ya reciben; **no pasan a fetchear** (`docs/architecture.md`: componente con datos
  sensibles recibe por props).
- En `DesglosePagosMensajero` y `WalletLedger` (Familia A pero con las filas en el padre), la
  Server Action de export la invoca el componente que YA conoce los filtros; si eso obliga a
  bajar un callback desde el módulo padre, se baja el callback — nunca los filtros a la tabla.

---

## §6 — Volumen: el riesgo que hay que dimensionar

Una descarga sin paginación es la única operación de la app que puede materializar un
dataset entero. Lo que la 151 ya decidió y aquí **se parte de ahí, no se reinventa**:

- **Tope único `N = 5000`**, `DESCARGA_MAX_FILAS`, `lib/config/descarga.ts` (gate F1.4, P1).
- Se evalúa **en el servicio**, no en el cliente: un cliente manipulado no puede pedir más.
- `take: N + 1` acota la memoria por construcción; el `total` exacto sale del `count` que la
  consulta ya hace. Nunca se materializan más de `N + 1` filas (R29).
- Superarlo NO produce archivo: devuelve total, tope y qué acotar. Nunca truncado silencioso.

Lo que esta feature AÑADE sobre eso:

| Riesgo | Dónde aparece | Mitigación en este diseño | Cómo se prueba |
| --- | --- | --- | --- |
| Un `listarCompleto` nuevo se olvida el tope | los 7 servicios nuevos | El tope no es opcional: sale de `descargaConfig`, y hay un test POR SERVICIO de «nunca pide al repositorio más de N+1 filas» | test unitario por servicio, con doble de repositorio que registra el `take` |
| Familia B produce un archivo gigante | 16 tablas | `filasLocales` aplica el MISMO tope sobre el array; supera ⇒ mismo error accionable | test del helper + un test por tabla con `N+1` filas simuladas |
| Familia B relee el origen y duplica carga | 16 tablas | R30: `obtenerFilas` no puede llamar a ninguna acción; guardia estática por módulo | test de contrato: los módulos de Familia B no importan `lib/actions/*` en su camino de descarga |
| El binario revienta el navegador | todas | El archivo se arma en el cliente con `exceljs` cargado por `import()` dinámico. 5000 filas × ~15 columnas ≈ 0,5–1,5 MB de `xlsx`, medido en la 151 | round-trip de integración con 5000 filas |
| El payload RSC de 5000 filas satura la función | Familia A | Es el techo que el tope fija. Si una tabla resulta más pesada por fila que órdenes, la salida es BAJAR `N`, no truncar | se mide con el round-trip; queda registrado en `progress/impl_170` |

**Lo que este diseño NO resuelve y hay que decir:** los 16 listados de Familia B ya leen hoy
su dataset entero sin paginación, ANTES de esta feature. La descarga no lo empeora (no
relee), pero tampoco lo arregla. Ver P6 en `requirements.md`.

---

## §7 — Datos sensibles: lista de prohibidos y guardia

Regla estructural: **las columnas se enumeran a mano**. No hay reflexión sobre el DTO, no hay
«exporta todo lo que traiga la fila». Es lo que hace que un DTO que crece no publique nada en
silencio (R6) y es el precedente literal de `COLUMNAS_DESCARGA_ORDENES` y de
`COLUMNAS_MANIFIESTO`.

Sobre esa base, lista negra explícita (R21–R24):

| Prohibido | Dónde podría colarse | Nota verificada |
| --- | --- | --- |
| `passwordHash` | Usuarios | `UsuarioListItemDTO` ya no lo trae (`usuarios-columns.tsx:49`). La guardia lo vuelve a comprobar sobre la fila de export. |
| `keyHash`, clave de API en claro | API keys | El DTO ya lo excluye por invariante (`lib/types/api-key.ts:74`). Se exporta el `keyPrefix` (que ya se muestra) y NUNCA el resto. |
| Secreto de webhook | API keys | Solo se revela una vez tras el alta; no vive en la fila del listado. |
| Tokens / OTP / códigos de un solo uso | cualquiera | Ninguno está en un DTO de listado hoy; la guardia impide que entre mañana. |
| Rutas de almacenamiento y URL firmadas de evidencia | Cierres (gestiones) | El detalle trae URL FIRMADAS de evidencia (`cierre-detalle-shared.tsx:940`). **No se exportan**: una URL firmada en un `xlsx` que se reenvía por correo es un enlace a la foto sin sesión. Se exporta, si acaso, «tiene evidencia: sí/no». |
| Identificadores internos (uuid) | todas | Se exporta el identificador de NEGOCIO (`numGuia`, `numRemision`, `identificador` de la API key), nunca el `id`. |
| Banderas internas de borrado | todas | No se declaran como columna. |

**Guardia automatizada (R25):** un test que recorre TODAS las declaraciones
`COLUMNAS_DESCARGA_*` y todas las filas que producen sus `fila*()` con datos de prueba, y
falla si aparece una clave o un valor que case con la lista negra (nombres prohibidos +
formato uuid + `http(s)://…token=`). Es una guardia de FORMA, aplicable a cualquier tabla
futura sin tocarla. Precedente de guardia estática en el repo:
`tests/unit/components/datatable-descarga-contrato.test.ts`.

---

## §8 — Orden de ejecución: 6 tandas revisables

Agrupadas por DUEÑO DEL DATO y por forma (no por pantalla), para que cada tanda sea un PR
pequeño, con un solo servicio o un solo tipo de proyección, y verificable por sí sola.

| Tanda | Contenido | Tablas | Backend nuevo | Depende de |
| --- | --- | --- | --- | --- |
| **0 — Base** | Tipo `ListarCompletoResult`, `filasDesdeResultado`, `filasLocales`, mensajes canónicos, guardia de sensibles, guardia de cobertura del censo; `OrdenesModule` migrado a los helpers | 0 (refactor) | — | — |
| **A — Órdenes** | Apartado por estado + bodega satélite | 2 | **cero** (reusa `listarOrdenesCompleto`) | 0 |
| **B — Configuración** | Usuarios, plantillas de mensaje, API keys | 3 | 3 `listarCompleto` | 0 |
| **C — Ledgers paginados** | Caja principal, desglose de un mensajero, mi wallet (tienda), mis pagos (mensajero) | 4 | 4 `listarCompleto` | 0 |
| **D — Dinero por props** | Saldos de tiendas, cuentas por pagar, plantillas de gasto fijo | 3 | cero | 0 |
| **E — Cierres e incidentes** | Cierres admin ×2, cierres de bodega ×2, consolidación ×2, cierre del día ×2, gestiones del detalle, incidentes ×2 | 11 | cero | 0 |
| **F — Ranking** | Ranking del día | 1 | cero | 0 |

- **A, B, C, D, E, F son independientes entre sí** una vez cerrada la tanda 0: distintos
  archivos, distintos servicios. Pueden ir en paralelo o por lotes.
- Dentro de B y C, el orden es **backend → frontend** (regla del arnés para `fullstack`).
- La tanda E es la más numerosa pero la de menor riesgo unitario: 11 tablas de solo lectura,
  sin backend, con proyecciones casi idénticas (`money`, etiquetas de estado ya existentes).
- Ninguna tanda deja el sistema roto: la prop es opt-in y sin ella la tabla se comporta
  exactamente como antes (R39, garantizado por el contrato de la 151).

---

## §9 — Alternativas descartadas

**A1 — Encender la descarga POR DEFECTO en `DataTable`, derivando las columnas de export de
`Column<T>`.**
Descartada. Es la opción que parece «arreglarlo todo en un archivo», y es la peor: (a)
`Column<T>.render` devuelve `ReactNode` (`DataTable.tsx:47`) y las columnas reales devuelven
insignias y botones — una hoja de cálculo no admite eso (D5 de la 151); (b) encendería la
descarga en tablas cuya página visible es un recorte de 20 de 3000 filas, entregando un
archivo silenciosamente incompleto (viola R9/R28); y (c) publicaría por OMISIÓN lo que traiga
el DTO, que es exactamente el mecanismo por el que se filtra un campo sensible (§7).

**A2 — Un `DescargaService` genérico server-side con un registro «tabla → consulta».**
Descartada. Cada listado impone su acotamiento por rol dentro de SU servicio, y en órdenes
ese acotamiento se escribe deliberadamente AL FINAL del `where` para pisar cualquier filtro
inyectado (`OrdenService.ts:273-280`). Un servicio genérico tendría que reimplementar ese
acotamiento siete veces o parametrizarlo; la primera opción reabre la fuga que ese código
cerró y la segunda es el mismo código con una capa de indirección encima. La 151 ya lo
descartó (su A4) y aquí, con 7 servicios, el argumento es más fuerte, no menos.

**A3 — Exportar lo que el cliente tiene en memoria, para TODAS las tablas.**
Descartada como regla general: en Familia A serían 20 filas de 3000 (`skip/take` server-side).
Pero se ADOPTA deliberadamente en Familia B, donde ese array **es** el dataset completo por
construcción. La diferencia no se deja al criterio de quien implementa: cada tabla de Familia
B lleva un test que demuestra que su fuente no pagina.

**A4 — Un route handler `app/api/descargas/...` con streaming.**
Descartada, y no se reabre: ya la descartó la 151 (§1/A2) contra la tabla de
`docs/architecture.md` (`app/api/` = webhook / API pública / cron). Con tope duro nunca hay
un dataset lo bastante grande como para necesitar streaming.

**A5 — Esperar a la 145/169 y hacer búsqueda + filtros + export de una sola vez.**
Descartada por decisión del humano el 2026-07-31. El export **no depende** del buscador: usa
los filtros que cada tabla YA tiene, y en 16 de las 25 no hay filtros que esperar. Acoplarlo
retrasaba una capacidad terminada detrás de una que no lo está.

**A6 — Un solo PR con las 24 tablas.**
Descartada: 24 archivos de UI, 7 servicios y ~30 declaraciones de columnas en una sola
revisión es una revisión que no ocurre. De ahí las 6 tandas de §8.

**A7 — Un tope por tabla en vez de uno único.**
Descartada (propuesta, ver P5): multiplica configuración, mensajes y tests por 25 para
resolver un problema que hoy no existe. Si mañana una tabla concreta necesita otro techo, el
cambio es aditivo.

---

## §10 — Riesgos

| Riesgo | Mitigación |
| --- | --- |
| Divergencia entre lo que se ve y lo que se descarga | Las columnas de export se derivan del MISMO DTO que pinta la tabla, y la Familia A usa el MISMO `where` que el listado (`construirWhere` compartido). |
| Un `listarCompleto` nuevo reimplementa el `where` y pierde el acotamiento | La extracción de `construirWhere` es una task propia, con la suite de filtros existente como red de seguridad, ANTES de escribir `listarCompleto`. |
| 24 cableados casi iguales invitan a copiar y pegar el bloque de errores | Tanda 0: `filasDesdeResultado` / `filasLocales` centralizan el bloque; `OrdenesModule` se migra a ellos para que no queden dos caminos. |
| Un campo sensible entra por una tabla nueva dentro de un año | Guardia de FORMA sobre todas las `COLUMNAS_DESCARGA_*` (§7), no una revisión manual. |
| Una tabla nueva nace sin descarga y nadie se entera | Guardia de cobertura: enumera los `<DataTable>` del árbol y exige que cada uno declare `descarga` o figure en la lista de exclusiones (R4). |
| Los 16 listados de Familia B siguen leyendo sin paginación | Declarado, no oculto: P6. La descarga no agrava (R30). |
| El modal de detalle de cierre se llena de botones | Decisión consciente (una descarga por sección) + P2 abierta al humano. |
