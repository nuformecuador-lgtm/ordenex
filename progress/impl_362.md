# impl_362 — Historial de acciones · BACKEND

> Rama `feature/362-historial-de-acciones`. Spec: `specs/362-historial-de-acciones/`.
> **Alcance de esta bitácora: el BACKEND.** T0–T4, T6.1, T7.1–T7.4, T7.7 y T8.1–T8.4.
> **NO se tocó UI**: T5 (pantalla, navegación, barra de filtros), T6.2/T6.3 (columnas de descarga
> y censo de tablas) y las guardias T7.5/T7.6 quedan para el agente de frontend, con el contrato
> de §2 de este documento.

---

## 1. Qué se construyó

### 1.1 Cimientos (T0)

| Archivo | Qué es |
| --- | --- |
| `lib/types/historial-accion.ts` | Catálogo cerrado: **42 tipos**, 17 entidades, 3 categorías, `CATEGORIA_POR_ACCION` y `ACCION_LABELS` exhaustivos + el esquema zod del borde y los DTO. Módulo puro. |
| `lib/types/historial-accion-etiquetas.ts` | `etiquetaDeEntidad(tipo, fila)` — fuente **única** de `entidad_etiqueta`, con un caso por entidad. |
| `db/schema.prisma` | Enums `HistorialAccionTipo` / `HistorialAccionEntidad` + modelo `HistorialAccion` con sus 3 índices y la relación inversa en `Usuario`. **+180 líneas, 0 borradas.** |
| `db/migrations/20260902120000_historial_accion/` | `migration.sql` (2 `CREATE TYPE`, tabla, 3 índices, FK `RESTRICT`, `ENABLE ROW LEVEL SECURITY` sin políticas) y `down.sql`. |
| `lib/repositories/registrar-accion.ts` | **El punto único**: `appendAccion(tx, entradas, loteId?)` + `resolverActorCongelado(tx, actorUsuarioId)`. |
| `lib/interfaces/repositories/IHistorialAccionRepository.ts` | Contratos de escritura y de lectura. |

**Los 42 tipos y no los 40 del Anexo A**: Q1 añade `orden_ubicacion_corregida` y Q2
`usuario_fulfillment_cambiado`, las dos en la categoría **mueve dinero**.

### 1.2 Instrumentación (T1–T3) — 42 tipos, 29 métodos, 17 repositorios

Los tres borrados por lote pasaron de `updateMany` a **`UPDATE … RETURNING`** con
`Prisma.sql`/`Prisma.join` (sin interpolación de texto): `OrdenRepository.softDelete`,
`restore` y `softDeleteViaApi`. El `where` no cambió — la frontera multi-tenant de la 358
(`tienda_id`) sigue **dentro de la sentencia**, y `eliminar-orden-pantalla-frontera-tienda.test.ts`
sigue verde.

Formas de atomicidad, y su reparto:
- **`abre_tx` (22 métodos)** — el método envuelve su mutación en `prisma.$transaction` y el
  `appendAccion` va dentro del callback.
- **`recibe_tx` (7 métodos)** — el método ya recibía la transacción como primer parámetro; ahí la
  atomicidad es **del tipo**, no de la disciplina.

Dos productores **no mutan su propia entidad**, y está declarado en el censo de la guardia:
`LiquidacionRepartoRepository.registrarAnulacion` (la fila del reparto es inmutable: lo que se
anula son sus pagos hijos, en la misma tx) y `RankingSnapshotRepository.registrarAccionSobreFila`
(el snapshot del ranking es historia congelada; lo que se escribe es el devengo y su egreso).

Dos cortes deliberados, para que **una decisión no produzca N filas**:
- un `liquidacion_pago` que pertenece a un **reparto** no produce `pago_*_registrado` ni
  `pago_anulado`: el acto se registra una vez, sobre el reparto;
- los ~34 asientos de wallet que emite aprobar un cierre siguen entrando por `crearMovimientos` y
  **no dejan rastro**. Los tres movimientos que nacen de una **decisión humana** entran por
  `crearMovimientoRegistrado`, que es nuevo.

### 1.3 Lectura (T4, T6.1)

`HistorialAccionRepository` (un solo constructor de `where`, un solo `orderBy` armado con
`ordenTotal(criterios, {id:"asc"})`), `HistorialAccionService` (autorización + DTO money-safe) y
`lib/actions/historial-acciones.ts` con las tres Server Actions.

### 1.4 Q1 — D4 de la 312, reabierta

`CorregirDatosClienteService` tenía en su cabecera «SIN RASTRO … cambiarlo REABRE D4 y va a la
puerta de aprobación humana». **Esa cabecera se reescribió**, con quién y cuándo lo autorizó (el
humano, 2026-09-02, al cerrar Q1) y con el límite exacto: se registra el HECHO, y ni la dirección
vieja ni la nueva, ni el distrito, ni la zona, ni ningún dato del destinatario.

`tests/unit/guards/corregir-datos-sin-rastro.guardia.test.ts` **no se burló: se actualizó** para
afirmar la regla nueva (bloque «312/D4 REABIERTA por la 362/Q1», 6 casos). Antes solo podía medir
una ausencia; ahora mide además una presencia —que el rastro existe, que es exactamente uno y que
no lleva ni un dato de cliente— con su contraprueba.

### 1.5 Q4 — quién lo ve

Nace `ROLES_HISTORIAL_ACCIONES = ["maestro"]` en `lib/auth/menu-visibility.ts`, **lista nueva** y
no un estrechamiento de `ROLES_HISTORICO_CONVERSACIONES`. El motivo está escrito en la constante:
el registro guarda las decisiones de dinero que toma el **admin**, y no puede ser el admin quien
revise su propio registro; estrechar la constante existente le quitaría además el histórico de
conversaciones, que sí debe seguir viendo.

---

## 2. El contrato para el frontend

### 2.1 Las tres Server Actions — `lib/actions/historial-acciones.ts`

```ts
listarHistorialAccionesPaginado(input: unknown, deps?): Promise<ListarHistorialAccionesResult>
listarHistorialAccionesCompleto(input: unknown, deps?): Promise<ListarHistorialAccionesCompletoResult>
obtenerCatalogoActoresHistorial(deps?): Promise<CatalogoActoresHistorialResult>
```

`deps` es el **segundo** parámetro (el primero en la tercera), con default: Next nunca lo pasa y el
cliente no puede mandarlo. Sirve para inyectar dobles (`historialService`, `getActor`).

> ⚠️ Las tres llevan hoy `@sin-superficie` con su motivo. **Borra esa anotación** cuando el módulo
> las importe, o `superficie-de-uso.guardia` se fosiliza.

### 2.2 Entrada — `filtroHistorialAccionSchema` (`lib/types/historial-accion.ts`), `.strict()`

| clave | tipo | notas |
| --- | --- | --- |
| `q` | `string` | `trim`, **min `BUSQUEDA_MIN_CHARS`** (impórtala de `lib/types/orden.ts`, no escribas un `3`), max 120 |
| `actorId` | `string[]` no vacío | ids de `obtenerCatalogoActoresHistorial` |
| `accion` | `HistorialAccionTipo[]` no vacío | unión **cerrada** de los 42 |
| `categoria` | `CategoriaAccion[]` no vacío | `mueve_dinero` · `hace_desaparecer` · `cambia_permisos` |
| `entidadTipo` | `HistorialAccionEntidad[]` no vacío | los 17 |
| `desde` / `hasta` | `"YYYY-MM-DD"` | fecha **calendario CR**, no instante |
| `page` | `int > 0` | default `1` |
| `pageSize` | `int > 0` | default `25`, tope `100` |
| `sortBy` | `"created_at"` | default `"created_at"` |
| `sortDir` | `"asc" \| "desc"` | **default `"desc"`** (lo más reciente primero) |

Una clave desconocida es `validation_error`, **no** un descarte mudo. `categoria` y `accion` se
**intersecan**; una combinación imposible devuelve cero filas (no el conjunto entero).

Constantes exportadas para la barra: `HISTORIAL_ACCION_TIPOS`, `HISTORIAL_ACCION_ENTIDADES`,
`CATEGORIAS_ACCION`, `ACCION_LABELS`, `CATEGORIA_LABELS`, `ENTIDAD_LABELS`, `accionesDeCategoria`,
`HISTORIAL_SORT_FIELDS`, `HISTORIAL_PAGE_SIZE_DEFECTO`, `HISTORIAL_PAGE_SIZE_MAX`.

### 2.3 Todos los estados de salida

```ts
ListarHistorialAccionesResult =
  | { status: "ok"; items: HistorialAccionDTO[]; page: number; pageSize: number; total: number }
  | { status: "unauthenticated" }
  | { status: "forbidden" }
  | { status: "validation_error"; motivo: string }

ListarHistorialAccionesCompletoResult =
  | { status: "ok"; items: HistorialAccionDTO[] }
  | { status: "unauthenticated" }
  | { status: "forbidden" }
  | { status: "validation_error"; motivo: string }
  | { status: "limite_excedido"; maximo: number }      // ⚠ error accionable, NO truncado silencioso

CatalogoActoresHistorialResult =
  | { status: "ok"; actores: { id: string; nombre: string }[] }
  | { status: "unauthenticated" }
  | { status: "forbidden" }
```

### 2.4 La forma de la fila

```ts
interface HistorialAccionDTO {
  id: string;
  fecha: string;                        // ISO — la pantalla lo pinta en CR (R35)
  accion: HistorialAccionTipo;
  accionLabel: string;                  // ya traducido; NO lo re-derives
  categoria: CategoriaAccion;           // DERIVADA del tipo (R17)
  entidadTipo: HistorialAccionEntidad;
  entidadEtiqueta: string;              // congelada; nunca vacía
  actorNombre: string | null;           // null = SISTEMA → píntalo «Sistema», nunca en blanco (R36)
  actorRol: RolValue | null;            // congelado (R3)
  monto: string | null;                 // ⚠ STRING de escala 2. NUNCA `Number()` (R6)
  valorAnterior: string | null;
  valorNuevo: string | null;
  loteId: string;
}
```

**`entidadId` no cruza** (uuid → `columnas-sensibles.guardia`). **`motivo` no existe** (R5).

### 2.5 Lo que el frontend tiene que hacer y aún no está

1. **`app/(app)/historico/acciones/page.tsx`** con `notFound()` **antes** de cualquier lectura,
   leyendo `ROLES_HISTORIAL_ACCIONES` (sin literales de rol) e inyección por `deps`.
2. **El subítem «Acciones»** en `lib/auth/menu-visibility.ts`. ⚠️ **Aquí hay un obstáculo real que
   dejo señalado y no resuelvo porque es UI**: `MenuChild` **no admite `roles` propios** y los
   subítems heredan los del padre, que hoy es `["maestro","admin"]`. Con Q4 en maestro-only, o
   `MenuChild` gana `roles` opcional (y `Sidebar` los aplica), o el subítem se le enseñaría al
   admin y el gate le devolvería 404. **La constante ya existe; la decisión de forma es del
   frontend.**
3. Barra compartida (`BuscadorFiltros` + `FilterComponent`), `DataTable` + `Pagination`,
   `claveDeOrden(...)` en la clave de SWR, `EmptyState` que diga que el registro empieza el día del
   despliegue, módulo de columnas de descarga (10 columnas, **sin** `id`/`entidadId`/`loteId`) y el
   alta en `censo-tablas.ts`.
4. Las guardias **T7.5** (solo-lectura de la pantalla) y **T7.6** (fuente única de roles).

---

## 3. Cómo se garantizó la atomicidad, y cómo se probó

**La regla, en el choke point:** `appendAccion` recibe **la transacción**, no un cliente Prisma.
No puede abrir la suya. Eso convierte R10/R11 en propiedades estructurales: dentro de una
transacción de Postgres un error de sentencia aborta la transacción entera, así que el
`try/catch` que se lo trague no existe.

**La consecuencia que no se saltó:** los tres borrados por lote pasaron a `UPDATE … RETURNING`
porque `updateMany` devuelve un `count` y no los ids. Registrar «lo pedido» en vez de «lo
alcanzado» escribe auditoría de cosas que no ocurrieron.

**Cuatro capas de prueba, y ninguna sola basta:**

1. **Guardia estructural con censo cerrado** —
   `tests/unit/guards/historial-accion-escrituras-cubiertas.guardia.test.ts`. 42 tipos, 29
   entradas, cuerpo real recortado por llaves balanceadas, y tres exigencias por entrada
   (`appendAccion`, su sentencia de mutación, y que la llamada caiga dentro del callback de
   `$transaction` o que reciba el `tx`). **6 contrapruebas** sobre cuerpos mutados en memoria.
2. **Guardia de cobertura del enum** — mismo archivo: ni un tipo sin productor, ni un productor
   inventado. Y `HISTORIAL_ACCION_TIPOS` fijado a 42 con número duro.
3. **Integración contra Postgres real** —
   `tests/integration/db/historial-accion-atomicidad.test.ts`. Un `Proxy` hace que
   `historialAccion.createMany` **lance**, y el `$transaction` del repositorio se traduce a un
   **SAVEPOINT real**. Sin savepoint un `throw` no revertiría nada y el caso pasaría en verde por
   accidente. Por cada una de las tres familias: (a) el registro falla → la mutación **no**
   persiste; (b) la mutación no alcanza nada → **no** queda registro; (c) lote parcial → tantas
   filas como alcanzadas.
4. **Mutaciones medidas** — §5.

**El test simétrico que se pidió**, los dos sentidos, contra Postgres:
- «no se puede escribir la acción sin su registro» — la aserción que lo dice, con su línea:
  `historial-accion-atomicidad.test.ts:182` *«la orden se borro sin su registro: R10 roto»* ·
  `:368` *«la tarifa se creo sin su registro: R10 roto»* ·
  `:486` *«el estado cambio sin su registro: R10 roto»*.
- «un registro no puede existir sin su acción» →
  `:204` (orden ya borrada) · `:226` (lote parcial: 2 y no 3) · `:304` (recuperar lo no borrado) ·
  `:487` y `:513` (estado que no cambia / usuario inexistente) · `:604` (`fulfillment` sin cambio) ·
  `:625` (solo el teléfono), y en Q1 `historial-accion-q1-ubicacion.test.ts:265`
  (`conflict` → cero filas).

**Prohibido `if (!datos) return;`**: los `beforeAll` de los cinco archivos de integración
**lanzan** cuando la base no tiene datos, en vez de salir en silencio.

---

## 4. Mapa `R<n> → test`

Los `R` de UI (R20, R28, R34, R35, R37) los cierra la tanda de frontend y aquí se marcan como
tales; su parte de servidor, cuando la tienen, sí está cubierta.

| R | Qué exige | Dónde se prueba |
| --- | --- | --- |
| R1 | una fila por entidad | `unit/historial-accion/catalogo-y-choke-point.test.ts › R1: escribe UNA FILA POR ENTIDAD` · `integration/db/historial-accion-atomicidad › R12: de un lote de 3 …` |
| R2 | fila inmutable | `unit/guards/historial-accion-forma-tabla › el modelo NO tiene updatedAt ni deletedAt` · `› la migracion tampoco las crea` · `› el contrato de lectura NO declara …` · `integration/db/historial-accion-migration › R2: la tabla REAL no tiene …` |
| R3 | nombre y rol congelados | `catalogo-y-choke-point › R3: devuelve nombre y rol, y consulta EXACTAMENTE una vez` · `lectura-borde-y-servicio › R3: el nombre y el rol del actor son los CONGELADOS` · `atomicidad › R3/R4: la fila congela la GUIA … y el nombre y rol` |
| R4 | etiqueta congelada, sobrevive a la entidad | `atomicidad › ⭑ R4: la etiqueta CONGELADA sobrevive al borrado FISICO` · `catalogo-y-choke-point › T0.5` (14 casos) |
| R5 | sin datos de cliente ni texto libre | `unit/guards/historial-accion-sin-datos-cliente` (26 casos, con contraprueba) · `integration/db/historial-accion-q1-ubicacion › (2) la fila NO lleva la direccion …` |
| R6 | importe decimal exacto, nunca float | `unit/guards/historial-accion-money-safe` (18 casos) · `historial-accion-migration › R6: monto es numeric(12,2)` · `lectura-borde-y-servicio › R6: monto es un STRING` |
| R7 | mismo `lote_id` por acción | `catalogo-y-choke-point › R7` (×2) · `atomicidad › R7: las filas de UN borrado por lote comparten lote_id` · `› ⭑ R7: cambiar ROL y ZONA a la vez` |
| R8 | RLS habilitada sin políticas | `historial-accion-migration › ⭑ R8: RLS ACTIVA` · `› R8: y NO tiene policies` · `› R8: misma postura que orden_historial_estado` |
| R9 | registro en la misma transacción | `unit/guards/historial-accion-escrituras-cubiertas › los 42 tipos se registran DENTRO de la transaccion` (29 casos) |
| R10 | si falla el registro, no persiste la acción | `atomicidad › ⭑ R10` ×3 (orden, tarifa, usuario) |
| R11 | si falla la acción, no queda registro | `atomicidad › ⭑ R11` ×3 · `q1-ubicacion › ⭑ (4) R11` |
| R12 | lote parcial: solo lo alcanzado | `atomicidad › ⭑ R12: de un lote de 3 con UNA ya borrada se registran EXACTAMENTE 2` |
| R13 | punto único de escritura | `unit/guards/historial-accion-punto-unico` (7 casos, con contraprueba) |
| R14 | exactamente los tipos del Anexo A | `escrituras-cubiertas › los 42 tipos … siguen siendo 42` · `catalogo-y-choke-point › son 42 tipos …` |
| R15 | unión cerrada rechazada en el borde | `lectura-borde-y-servicio › R15: un tipo de accion INVENTADO da validation_error` |
| R16 | cada tipo con productor | `escrituras-cubiertas › TODO valor del enum tiene productor declarado` |
| R17 | categoría derivada, no almacenada | `forma-tabla › el modelo NO tiene columna categoria` · `› el mapa es EXHAUSTIVO` · `lectura-borde-y-servicio › 362/R17` (5 casos) · `integration/db/historial-accion-lectura › R29 (3/5) categoria equivale a sus tipos` |
| R18 | gate antes de la primera lectura | `lectura-borde-y-servicio › R18: <rol> recibe forbidden … y el repositorio NO se llama` (×5 roles + sesión ausente) — **la mitad de ruta la cierra T5.1** |
| R19 | una sola declaración de roles | `lectura-borde-y-servicio › Q4: la constante es exactamente [maestro]` — **guardia de ruta: T7.6, frontend** |
| R20 | posición en «Histórico», sin cambiar el aterrizaje | **frontend (T5.2)**; `destino-post-login.test.ts` sigue verde sin tocarlo |
| R21 | pantalla sin escrituras | `IHistorialAccionService` no declara ninguna mutación · **guardia: T7.5, frontend** |
| R22 | listado resuelto en el servidor | `historial-accion-orden-total › R22: la pagina trae pageSize filas y el total es del CONJUNTO` · `lectura-borde-y-servicio › R22` |
| R23 | orden total | `historial-accion-orden-total › R23: dentro del grupo empatado, el orden relativo es el del id ASC` |
| R24 | recorrer sin repetir ni perder | `historial-accion-orden-total › ⭑ R24` (desc y asc) — **corpus de 130 filas del mismo instante** |
| R25 | misma página dos veces = mismo resultado | `historial-accion-orden-total › ⭑ R25` |
| R26 | defecto reciente-primero, invertible, lista blanca | `lectura-borde-y-servicio › R26` (×4) · `historial-accion-orden-total › R26` |
| R27 | caché distingue el ordenamiento | **frontend (T5.4)**; `claveDeOrden` ya existe y se exporta |
| R28 | barra compartida | **frontend (T5.3)** |
| R29 | los cinco filtros | `integration/db/historial-accion-lectura › ⭑ R29 (1/5)…(5/5)` + `los filtros se COMBINAN en AND` |
| R30 | descarga = mismo conjunto filtrado | `historial-accion-lectura › ⭑ R30` · `historial-accion-orden-total › ⭑ R30: la DESCARGA sale en el MISMO orden` · `lectura-borde-y-servicio › T6.1` |
| R31 | la búsqueda alcanza exactamente lo anunciado | `historial-accion-lectura › ⭑ R31` (3 positivos + **2 casos negativos**) |
| R32 | mínimo de caracteres desde la constante | `lectura-borde-y-servicio › R32` (×2) — **frontend debe leerla también en el control** |
| R33 | mismo acotamiento en la descarga | `lectura-borde-y-servicio › R33: <rol> recibe forbidden tambien en la DESCARGA` (×5) |
| R34–R37 | lo que se muestra por fila | **frontend (T5.4)**; el DTO ya trae `accionLabel`, `categoria`, `actorNombre: null` y `monto: string` |
| R38 | descarga sin uuid ni columnas sensibles | `lectura-borde-y-servicio › R38: el DTO NO lleva entidadId` — **columnas: T6.2, frontend** |
| R39 | sin purga ni caducidad | `forma-tabla › ningun job ni cron nombra la tabla` · `› ninguna migracion borra filas del registro` |
| R40 | sin recorrido secuencial | `historial-accion-migration › ⭑ (1/3)(2/3)(3/3)` + su caso de anti-vacuidad |

**Requisitos sin cobertura de backend porque son de UI:** R20, R27, R28, R34, R35, R36 (pintado),
R37. Todos tienen su mitad de servidor cubierta arriba.

---

## 5. Las mutaciones — nueve, con su línea real, todas revertidas

| # | Mutación | Puesta roja en | Línea del fallo |
| --- | --- | --- | --- |
| 1 | quitar el `appendAccion` de `softDelete` | guardia + integración | `escrituras-cubiertas.guardia.test.ts:520` («no llama a `appendAccion`») · `atomicidad.test.ts:180, 226, 252, 269, 291` |
| 2 | **sacar el registro fuera del `$transaction`** | guardia + integración | `escrituras-cubiertas.guardia.test.ts:520` («el `appendAccion` cae FUERA del callback») · `atomicidad.test.ts:180` — *«la orden se borro sin su registro: R10 roto: expected 2026-09-02T23:41:42.492Z to be null»* |
| 3 | **registrar los ids PEDIDOS en vez de los ALCANZADOS** | integración | `atomicidad.test.ts:204` (se registró un borrado que no ocurrió) · `:226` (3 filas en vez de 2) · `:276` |
| 4 | `loteId` generado por fila | unit + integración | `catalogo-y-choke-point.test.ts:145` (*«79 borrados de UN acto tienen que distinguirse de 79 actos»*, 3 lotes en vez de 1) · `:175` · `atomicidad.test.ts:252` y `:556` (*«dos efectos de UN acto, un solo lote»*) |
| 5 | **quitar el desempate del `orderBy`** | integración | `orden-total.test.ts:170` (*«una fila salio dos veces y otra no salio en ninguna pagina: falta el desempate»*) — ***142 filas distintas de 150***, el defecto de la 352 reproducido · `:182` (144/150) · `:224` · `:255` |
| 6 | **dejar que el `admin` lea el módulo** | unit | `lectura-borde-y-servicio.test.ts:80, 92, …` (4 casos) |
| 7 | escribir el mínimo de caracteres a mano (`min(1)`) en vez de la constante | unit | `lectura-borde-y-servicio.test.ts:194, 204` |
| 8 | retirar el registro de Q2 (`fulfillment`) | integración | `atomicidad.test.ts:590` |
| 9 | retirar el rastro de Q1 (`orden_ubicacion_corregida`) | integración | `q1-ubicacion.test.ts:165, 185, 285` |

### ⚠️ Una mutación sobrevivió en verde, y se cerró

**La mutación 8, en su primer intento, SOBREVIVIÓ.** Poner `if (false && …)` delante de la rama del
`fulfillment` en `UserRepository.update` dejaba la guardia de censo **verde**: el literal
`"usuario_fulfillment_cambiado"` seguía en el cuerpo del método, que es todo lo que la guardia
sabe mirar.

Es un agujero real del mecanismo: una guardia de texto no puede distinguir una rama viva de una
muerta. Se cerró **añadiendo el caso de integración** `atomicidad › ⭑ Q2: cambiar el fulfillment
… SI registra` (más su gemelo no-op), que ejerce el camino contra Postgres y cuenta la fila. Con
él, la misma mutación se pone roja en `atomicidad.test.ts:590`. La lección vale para el resto del
censo: **la guardia estructural dice dónde mirar; solo la base dice qué pasó.**

---

## 6. Salida real de los comandos

```
$ pnpm run typecheck
> ordenex@0.1.0 typecheck R:\job\singularis\projects\ordenex
> tsc --noEmit
(sin salida — 0 errores)
```

```
$ pnpm run lint
✖ 147 problems (0 errors, 147 warnings)
  0 errors and 2 warnings potentially fixable with the `--fix` option.
```
Los 147 avisos son preexistentes (`no-unused-vars` en tests ajenos). **Ninguno en un archivo de
esta ficha** (comprobado con `grep historial-accion|registrar-accion` sobre la salida: vacío).

```
$ pnpm test
 Test Files  1 failed | 1676 passed (1677)
      Tests  1 failed | 23852 passed | 26 skipped (23879)

 FAIL  tests/unit/guards/superficie-de-uso.guardia.test.ts
   → ["lib/actions/tarifas.ts:67 obtenerTarifa"]
```

```
$ node scripts/comparar-baseline-rojos.mjs .vitest/rojos.json
sin rojos nuevos (1 archivo(s) rojo(s) sobre 1677 ejecutado(s), todos en el baseline conocido)
```

**El único rojo es el heredado y tolerado** (`lib/actions/tarifas.ts:67 obtenerTarifa`), que ya
está en `tests/baseline-rojos.json`. Las tres Server Actions nuevas llevan `@sin-superficie` con
su motivo hasta que la pantalla las importe.

### La migración, aplicada y revertida

```
$ pnpm exec prisma migrate deploy
Applying migration `20260902120000_historial_accion`
All migrations have been successfully applied.

$ pnpm exec prisma migrate diff --from-config-datasource --to-schema db/schema.prisma --script
-- This is an empty migration.          ← sin drift entre la base y el datamodel

$ pnpm run db:rollback
Rollback completado: 20260902120000_historial_accion
   (el diff pasa a 3 objetos pendientes: la tabla y los dos enums)

$ pnpm exec prisma migrate deploy     ← se vuelve a aplicar limpio
```

`prisma format` no toca ni una línea del bloque de esta ficha (medido: 129 líneas que el
formateador cambiaría, **0** dentro de `HistorialAccion` o de sus enums; son deuda preexistente de
otros modelos y **no se tocaron** para no ensuciar el diff).

---

## 7. Lo dudoso, y lo que hay que saber antes de mergear

1. **⚠️ El subítem de menú no está, y no es un olvido.** `MenuChild` no admite `roles` propios;
   con Q4 en maestro-only y el padre en `["maestro","admin"]`, el frontend tiene que decidir si
   `MenuChild` gana `roles` opcional o si el subítem se resuelve de otra forma. Añadirlo yo habría
   sido tocar UI.
2. **⚠️ `feature_list.json` aparece modificado y NO es mío.** Durante la sesión alguien dio de alta
   la **ficha 363** ahí. El árbol estaba limpio al empezar. Míralo antes de commitear.
3. **La base local es compartida entre worktrees** y esta migración ya está aplicada en ella: el
   gate de otras fichas puede ponerse rojo hasta que hagan `prisma migrate deploy`. **Avisado.**
4. **Cuatro filas quedaron commiteadas en `historial_accion` de la base local**, escritas por
   `gasto-fijo-cobro-aprobacion.test.ts` y por la suite de `rechazo_tienda_cobro`: esas dos suites
   ya commiteaban antes de esta ficha (no usan `enTransaccionRevertida` en ese camino). **No es un
   defecto que introduzca la 362** —de hecho es la evidencia de que la instrumentación funciona
   end-to-end— pero conviene saberlo. Los cinco archivos de integración **míos** revierten todo.
5. **`obtenerCatalogoActoresHistorial` devuelve el nombre VIVO**, no el congelado: es un selector,
   no una fila de historia. La consecuencia declarada: si alguien se cambia el apellido, el filtro
   lo ofrece con el nombre nuevo y las filas viejas siguen mostrando el de entonces. Es lo
   correcto, pero es una asimetría visible.
6. **La búsqueda libre alcanza `actor_nombre` congelado Y la relación viva.** Buscar solo por uno
   daría cero resultados en uno de los dos casos sin decir por qué. El coste: un `OR` de cuatro
   ramas. A esta escala (11k–38k filas/año) es irrelevante; a otra escala habría que revisarlo.
7. **`concepto` de `gasto_fijo_cobro` entra en la etiqueta**, y es la única fuente de texto escrito
   por una persona que se admite. Está justificada donde vive (es una etiqueta de catálogo de un
   gasto fijo de la casa, no un texto por transacción) y **no está** en la lista prohibida de T7.4,
   que la spec fija. Si el reviewer no lo compra, la alternativa es dejar la etiqueta en el periodo
   a secas y perder legibilidad.
8. **`monto` de `cobro_rechazo_tienda_*` es el flete, sin el IVA.** No se suman: R6 pide congelar
   EL importe de la acción, no inventar aritmética nueva sobre dinero. Queda declarado.
9. **La guardia de censo no distingue una rama muerta** (ver §5). Los 42 tipos tienen productor
   declarado y 29 métodos comprobados, pero solo los caminos con test de integración están
   protegidos contra la mutación «poner la rama en `false`». Los cubiertos hoy: `orden_eliminada`,
   `orden_recuperada`, `orden_ubicacion_corregida`, `tarifa_creada`, `tarifa_actualizada`,
   `tarifa_borrada`, `usuario_estado_cambiado`, `usuario_rol_cambiado`, `usuario_zona_cambiada`,
   `usuario_fulfillment_cambiado`. **Los otros 32 no.** No es una carencia inventada aquí: es el
   coste de instrumentar 42 puntos, y está medido y dicho.
10. **Dos suites de integración ajenas fallan bajo carga paralela y pasan aisladas**
    (`orden-nota-migration`, `ranking-snapshot-migration`). Es el flake de saturación que este repo
    ya tiene documentado; en la corrida completa final salieron verdes.

---

## Veredicto

Backend completo y medido: los 42 tipos instrumentados con su registro en la misma transacción,
la atomicidad probada contra Postgres en los dos sentidos, nueve mutaciones puestas rojas con su
línea (una sobrevivió, se dice y se cerró), typecheck y lint en verde y la suite entera con el
único rojo heredado que ya vive en el baseline — **falta la pantalla, que es de otro agente.**
