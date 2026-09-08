# impl 381 — cobrarle un costo a una tienda desde «Registrar movimiento» (MITAD DE SERVIDOR)

**Fecha:** 2026-09-08 · **Rama:** `worktree-agent-afcd3a41ba815307d` (sale de `dev`, `0f75380f`)
**Alcance de esta bitácora:** modelo, migraciones, servicio, repositorio, Server Action y tests.
**La pantalla NO entra**: el diálogo «Registrar movimiento» y las dos vistas del saldo las escribe
`frontend_dev` en las tandas H e I de `specs/381-cargo-manual-a-tienda/tasks.md`.

> **El commit `wip` `486d5dee` no se reanudó ni se miró como referencia.** Construía el puerto a la
> caja (`CajaAjusteTiendaService`, `ICajaAjusteTiendaPort`) que la decisión D1 del humano eliminó.
> Se rearrancó desde el spec revisado. R24 y el test E.2 convierten esa eliminación en algo que se
> rompe si alguien la deshace, en vez de en una ausencia que nadie vigila.

---

## Lo que se construyó, en una frase

Un cobro es **UNA fila de débito** en `wallet_tienda_movimiento`, categoría **propia**
(`cobro_manual`), escrita en la misma transacción que su fila de historial. **No toca la caja de
Ordenex.** El disponible de la tienda baja, y **puede quedar negativo**: eso es correcto y se cobra
más adelante, cuando la gestión vuelva a generar dinero a su favor.

---

## Las DOS migraciones

### 1 · `db/migrations/20260908140000_wallet_tienda_categoria_cobro_manual/`

`ALTER TYPE "wallet_tienda_movimiento_categoria" ADD VALUE IF NOT EXISTS 'cobro_manual';` — una
sola sentencia, aditiva.

`down.sql`: Postgres no tiene `DROP VALUE`, así que **recrea el tipo con los 10 valores previos** y
recastea la columna. Coreografía completa: suelta primero el CHECK
`wallet_tienda_movimiento_tipo_categoria_check`, el índice
`wallet_tienda_movimiento_tienda_id_categoria_idx` y el único parcial
`wallet_tienda_movimiento_origen_uq` (lleva `categoria` en su clave) → renombra/crea/recastea/dropea
→ recrea los dos índices con el mismo nombre y la misma forma (el parcial con su
`WHERE "origen_id" IS NOT NULL`) y el CHECK con su lista original.

### 2 · `db/migrations/20260908140100_wallet_tienda_check_cobro_manual/`

Tres cosas: (1) `DROP`+`ADD` del CHECK con `cobro_manual` **en la rama `debito` y sólo ahí**;
(2) `ADD VALUE 'cobro_tienda_registrado'` en `historial_accion_tipo`; (3) `ADD VALUE
'wallet_tienda_movimiento'` en `historial_accion_entidad`.

`down.sql`: el CHECK vuelve a su lista original **primero** (nombra un valor que el down de la 1
retira después: los downs corren del más nuevo al más viejo), luego `historial_accion_tipo` con 50
valores y `historial_accion_entidad` con 20.

**Van separadas porque Postgres prohíbe USAR un valor de enum en la misma transacción que lo añade
(55P04)** y el CHECK lo nombra. Prisma corre cada `migration.sql` en su propia transacción.

### El catálogo de HOY, MEDIDO (no razonado) el 2026-09-08 antes de escribir los `down.sql`

Consulta a `pg_enum` contra la base local (`localhost:5432/ordenex`, `prisma migrate status` al día):

| enum | antes | después | último valor previo |
| --- | --- | --- | --- |
| `wallet_tienda_movimiento_categoria` | **10** | 11 | `ajuste_debito` (PRIMERA ampliación de su vida) |
| `historial_accion_tipo` | **50** | 51 | `zona_pago_mensajero_cambiado` (lo añadió la 380 unas horas antes) |
| `historial_accion_entidad` | **20** | 21 | `distrito` |

Los dos `down.sql` llevan escrito el aviso **«ESTA LISTA ES UNA FOTO DEL 2026-09-08»**, la consulta
a `pg_enum` con la que medir el catálogo del día, y la precondición ruidosa. Hay **tests estáticos
que comprueban que el aviso sigue ahí** (`FOTO DEL 2026-09-08`, `pg_enum`, `PRECONDICION RUIDOSA`) y
que corren **sin base**. Y los dos archivos de migración **reconstruyen el estado previo ejecutando
las migraciones reales anteriores, descubiertas leyendo `db/migrations`** —no escritas a mano—, de
modo que una ampliación que entre por `dev` mientras esta rama esté abierta ponga el test rojo en
vez de perderse en silencio.

**Ningún `down.sql` anterior se tocó.**

---

## La interfaz para la pantalla (esto es lo que `frontend_dev` necesita)

**Server Action:** `registrarCobroTiendaAction(input, deps?)` en `lib/actions/wallet-tienda.ts`.

Entrada (validada por `registrarCobroTiendaSchema`, `.strict()`):

```ts
{ tiendaId: string /* uuid */, monto: string, descripcion: string, fecha?: "YYYY-MM-DD" }
```

- **`monto` es un STRING** y lo sigue siendo hasta la columna. Nunca `number`, nunca `parseFloat`.
  Formato: `^\d+(\.\d{1,2})?$` y mayor que 0.
- **`fecha` es opcional.** Ausente o «hoy» ⇒ la clave no viaja y manda el `DEFAULT` de la columna
  (el movimiento lleva la hora real). Una fecha anterior ⇒ `06:00Z` de ese día.
- **`.strict()`**: `tipo`, `categoria`, `registradoPor`, `origenTipo` y `origenId` **NO viajan**;
  los fija el servidor. Colar cualquiera de ellos es `validation_error`.

Salida:

```ts
| { status: "ok"; cobro: WalletTiendaMovimientoDTO; saldo: SaldoTiendaDTO }
| { status: "validation_error"; fieldErrors: Record<string, string[]> }
| { status: "forbidden" }
| { status: "unauthenticated" }
```

- **`saldo.saldo` es el campo del disponible que puede ir en NEGATIVO** (`SaldoTiendaDTO`, ya
  existente): STRING escala 2, con el signo delante (`"-15000.00"`). Viene acompañado de
  `saldo.signo: "positivo" | "negativo" | "cero"`, derivado **en el servidor**. La pantalla no debe
  comparar ni convertir: pinta el string tal cual y usa `signo` para la marca legible.
- `cobro` es el `WalletTiendaMovimientoDTO` releído por id, con `monto` STRING.
- **No hay rama `sin_saldo` ni `excede`**, y es deliberado (R27): un cobro no se compara contra
  ningún disponible.

Mensajes que produce el borde, literales:

| campo | mensaje |
| --- | --- |
| `monto` | `El monto debe ser un numero con hasta 2 decimales.` / `El monto debe ser mayor que 0.` |
| `descripcion` | `La descripcion es obligatoria.` |
| `fecha` | `Esa fecha no existe en el calendario.` / `La fecha no puede ser posterior a hoy.` / `No se admiten movimientos anteriores al <YYYY-MM-DD>.` (los MISMOS que los otros cuatro conceptos) |
| `tiendaId` | `La tienda no existe` / `La cuenta elegida no es una tienda` / `La tienda no esta activa` |

Nombres del concepto:

| dónde | texto |
| --- | --- |
| valor de enum del ledger | `cobro_manual` |
| etiqueta en el libro (`CATEGORIA_TIENDA_LABEL`), que ven la tienda y el admin, y las dos descargas | **«Cobro de Ordenex»** |
| etiqueta del selector del diálogo (la escribe `frontend_dev`, tanda H.1) | **«Cobrar un costo a una tienda»** — propuesta del diseño, **Q1 sin firmar** (ver «Lo que hay que mirar») |
| tipo de historial | `cobro_tienda_registrado` → «Cobró un costo a una tienda», categoría `mueve_dinero` |
| entidad de historial | `wallet_tienda_movimiento` → «Movimiento de tienda» |

El catálogo de tiendas del selector **no estrena nada**: `listarAdminTiendas`
(`lib/actions/usuarios-por-rol.ts:43`) ya devuelve `id`/`nombre` de las cuentas `adminTienda`
`activo` ordenadas por nombre.

---

## Archivos

### Creados

| archivo | qué es |
| --- | --- |
| `db/migrations/20260908140000_wallet_tienda_categoria_cobro_manual/{migration,down}.sql` | migración 1 |
| `db/migrations/20260908140100_wallet_tienda_check_cobro_manual/{migration,down}.sql` | migración 2 |
| `lib/interfaces/services/ICobroTiendaService.ts` | contrato + `CobroTiendaTxRunner` + resultado |
| `lib/services/CobroTiendaService.ts` | la escritura: rol → escala 2 → tienda → uuid → tx → saldo |
| `tests/unit/types/wallet-tienda-cobro-schema.test.ts` | el borde (32 casos) |
| `tests/unit/services/cobro-tienda-service.test.ts` | el servicio, incluido R24 y R22 (33 casos) |
| `tests/unit/actions/wallet-tienda-cobro-action.test.ts` | borde + composition root (8 casos) |
| `tests/integration/db/wallet-tienda-cobro.test.ts` | Postgres real (13 casos) |
| `tests/integration/db/wallet-tienda-cobro-migration.test.ts` | migración 1 + el CHECK (24 casos) |
| `tests/integration/db/historial-accion-cobro-tienda-migration.test.ts` | los dos enums del historial (17 casos) |

### Modificados (producción)

| archivo | qué gana |
| --- | --- |
| `db/schema.prisma` | los tres valores de enum, con su comentario de ficha |
| `lib/types/wallet-tienda.ts` | `cobro_manual` en el SEED + `registrarCobroTiendaSchema` |
| `lib/utils/desglose-tienda.ts` | `CUBETA_POR_CATEGORIA.cobro_manual = "cargos"` |
| `lib/utils/aporte-por-orden.ts` | `FUENTE_TIENDA.cobro_manual = sin_reparto / no_nace_de_un_cierre` |
| `lib/analytics/metrics.ts` | `cobro_manual` en las categorías de la métrica de cuenta por pagar a tiendas (**va a mano: ese campo está tipado `readonly string[]` y el build NO lo obliga**) |
| `app/(app)/mi-wallet/_components/mi-wallet-labels.ts` | `CATEGORIA_TIENDA_LABEL.cobro_manual = "Cobro de Ordenex"` (**una línea; sin ella el build no compila**, ver «Lo que hay que mirar») |
| `lib/types/historial-accion.ts` | tipo, entidad, categoría y etiqueta (los cuatro `Record` son exhaustivos) |
| `lib/types/historial-accion-etiquetas.ts` | fuente `wallet_tienda_movimiento: { tiendaNombre }` y su resolvedor |
| `lib/interfaces/repositories/IWalletTiendaMovimientoRepository.ts` | `id?` en la entrada, `registrarCobroEnHistorial`, los dos tipos de tx |
| `lib/repositories/WalletTiendaMovimientoRepository.ts` | el `id` opcional y el método del rastro (forma `recibe_tx`) |
| `lib/interfaces/repositories/IUserRepository.ts` + `lib/repositories/UserRepository.ts` | `obtenerCuentaTienda(id)` → `{ rol, estado } \| null` |
| `lib/actions/wallet-tienda.ts` | `registrarCobroTiendaAction` + `buildCobroTiendaService` |

### Modificados (tests ajenos, y por qué)

- **11 archivos** con dobles de `IWalletTiendaMovimientoRepository` y **8** con dobles de
  `IUserRepository`: ganan el método nuevo. Es el coste declarado de extender una interfaz, y lo
  canta el typecheck.
- `tests/unit/guards/historial-accion-escrituras-cubiertas.guardia.test.ts`: **entrada nueva en el
  censo** (tipo `cobro_tienda_registrado`, archivo `WalletTiendaMovimientoRepository.ts`, método
  `registrarCobroEnHistorial`, forma `recibe_tx`, mutación `/tx\.usuario\.findUnique\(/`) y el
  conteo duro 50 → 51.
- `tests/unit/historial-accion/catalogo-y-choke-point.test.ts`: conteos 50→51 y 20→21, bloque nuevo
  de la 381 y el caso de la etiqueta (R43).
- `tests/integration/db/liquidacion-migration.test.ts`: el CHECK de `20260802120000` deja de ser
  exhaustivo sobre el enum de HOY. **Se ACTUALIZA con el mecanismo que ese mismo archivo ya usaba
  para el libro del mensajero desde la 293** (`AGREGADAS_DESPUES`), no se relaja: la igualdad sigue
  siendo exacta, así que un valor de enum que nadie clasifique ni en el CHECK ni en esa lista pone
  el caso rojo. La afirmación «el CHECK de HOY cubre el enum de HOY» se muda a
  `wallet-tienda-cobro-migration.test.ts`, que es donde ese CHECK vive ahora — y allí se mide
  **por conducta** (un `INSERT` por cada par tipo×categoría), no por regex.
- `tests/integration/db/historial-accion-orden-zona-reconciliada-migration.test.ts` y
  `historial-accion-zona-pago-mensajero-migration.test.ts`: los dos tenían literales sobre «el
  catálogo de hoy». Se actualizan con el mismo patrón de cadena verificable (`POSTERIORES`), y el
  `at(-1)` del 380 pasa a afirmar la **posición relativa** —inmediatamente antes del valor de la
  381—, que es **más** estrecho que «es el último» y no caduca con la siguiente ficha.
- `tests/unit/utils/desglose-tienda.test.ts`, `aporte-por-orden.test.ts`,
  `tests/unit/components/desglose-tienda-labels.test.ts`,
  `tests/unit/repositories/wallet-tienda-movimiento-repository.test.ts`: bloques nuevos de la 381.
- `tests/integration/db/geografia-registro-migration.test.ts`: el NOMBRE de un caso decía «las 20»
  y su aserción compara contra el catálogo. Se quita la cifra del título (un registro con número
  dentro caduca); la aserción no cambia.

---

## Mapa `R<n>` → test (los 43)

### A — la superficie (tanda H, **frontend**)

| R | dónde queda | estado |
| --- | --- | --- |
| R1 | `tests/unit/components/wallet-conceptos-manuales.test.ts` (tanda H.1) | **PENDIENTE — pantalla** |
| R2 | `tests/unit/components/wallet-registrar-movimiento-dialog.test.tsx` (H.2) | **PENDIENTE — pantalla** |
| R3 | idem | **PENDIENTE — pantalla** |
| R4 | idem. El NOMBRE que debe decir ya está fijado: `tests/unit/components/desglose-tienda-labels.test.ts` → «Cobro de Ordenex» | **PENDIENTE — pantalla** |
| R5 | servidor **sin cambio**: `listarAdminTiendas` → `UserRepository.listByRol("adminTienda")` filtra `estado: "activo"` y ordena por nombre. Su cobertura propia la escribe H.3 | **PENDIENTE — pantalla** |
| R6 | `wallet-registrar-movimiento-dialog.test.tsx` (H.3) | **PENDIENTE — pantalla** |
| R7 | idem (H.2). La mitad de borde SÍ está: `tests/unit/types/wallet-tienda-cobro-schema.test.ts` → «rechaza la peticion SIN tienda» | **parcial** |
| R8 | idem (H.4) | **PENDIENTE — pantalla** |
| R9 | idem | **PENDIENTE — pantalla** |
| R10 | idem. El contrato de `fieldErrors` por campo lo fija `tests/unit/actions/wallet-tienda-cobro-action.test.ts` → «una peticion mal formada muere en el borde, con sus campos» | **parcial** |
| R11 | `wallet-conceptos-manuales.test.ts` (H.1) | **PENDIENTE — pantalla** |

### B — el borde

| R | test |
| --- | --- |
| R12 | `tests/unit/services/cobro-tienda-service.test.ts` → «381/E.1 (R12) — el rol se evalua ANTES de tocar la base» (4 roles × cero llamadas a CUALQUIER doble, + el discriminador con `maestro`/`admin`) |
| R13 | `tests/unit/actions/wallet-tienda-cobro-action.test.ts` → «R13: sin sesion responde `unauthenticated` y NO llama al servicio» |
| R14 | `tests/unit/types/wallet-tienda-cobro-schema.test.ts` → 10 montos inválidos + 6 válidos |
| R15 | idem → «rechaza la descripcion vacia/solo espacios/tabuladores» |
| R16 | idem → los TRES textos, comparados literalmente contra los que emiten los otros cuatro conceptos |
| R17 | `cobro-tienda-service.test.ts` → «381/E.1 (R17)» (3 casos, cero escrituras) **+** `tests/integration/db/wallet-tienda-cobro.test.ts` → «R17: una cuenta que no es tienda, o esta inactiva, se rechaza SIN escribir nada» (contra filas REALES) |
| R18 | `wallet-tienda-cobro-schema.test.ts` (sigue siendo STRING) + `cobro-tienda-service.test.ts` → «381/E.1 (R18)» + `wallet-tienda-cobro.test.ts` → «R18: el importe X llega a la columna como Y, sin pasar por un float» (4 importes, incluidos `0.01` y `99999999.99`) |

### C — el asiento

| R | test |
| --- | --- |
| R19 | `cobro-tienda-service.test.ts` → «es UN debito de la categoria propia…» + `wallet-tienda-cobro.test.ts` (a) |
| R20 | `cobro-tienda-service.test.ts` → «R20: es un registro MANUAL y sin documento de origen» + integración (a) |
| R21 | `cobro-tienda-service.test.ts` → «R21: sin fecha elegida, la clave `fechaMovimiento` NO viaja» (+ «con HOY tampoco» + fecha anterior) + integración → «R21: sin fecha, el movimiento se fecha con el instante del registro; con una anterior, con ella» |
| R22 | `cobro-tienda-service.test.ts` → «el servicio expone `registrarCobro` y NADA MAS» (`toEqual` literal sobre el prototipo) |
| R23 | `cobro-tienda-service.test.ts` (`filaEscrita` exige `movs.length === 1`) + integración (a) («UNA fila y ni una mas en TODO el libro») |
| R24 | `cobro-tienda-service.test.ts` → «381/E.2» (cero llamadas a `walletMovimiento` + el archivo no importa la caja + el constructor tiene 3 parámetros) **+** `wallet-tienda-cobro-action.test.ts` → «y NO construye ningun escritor de la caja» **+** integración (a)(g) (`walletMovimiento.count()` idéntico antes y después) |
| R25 | `wallet-tienda-cobro.test.ts` → «(e) si el registro del historial falla, NO queda el asiento», con SAVEPOINT real y su control positivo |
| R26 | `tests/unit/utils/desglose-tienda.test.ts` → «381/R26: el saldo baja EXACTAMENTE el importe del cobro» + integración (a)(c) |
| R27 | `cobro-tienda-service.test.ts` → «un cobro mayor que el saldo se ACEPTA y devuelve `signo: negativo`» (+ el discriminador positivo + «NO existe ninguna rama `sin_saldo` ni `excede`») + `desglose-tienda.test.ts` → «381/R27» + integración (d) y «un SEGUNDO cobro sobre un saldo ya negativo lo hunde mas» |

### D — el negativo en pantalla (tanda I, **frontend**)

| R | dónde queda | estado |
| --- | --- | --- |
| R28 | `tests/unit/components/saldos-tiendas-table.negativo.test.tsx` (I.4) | **PENDIENTE — pantalla** |
| R29 | `tests/unit/components/saldo-tienda-card.negativo.test.tsx` (I.4) | **PENDIENTE — pantalla** |
| R30 | los dos anteriores, con los tres signos | **PENDIENTE — pantalla** |
| R31 | `tests/unit/components/pago-tienda-acciones.test.tsx` (I.5) | **PENDIENTE — pantalla** |

> El servidor ya entrega lo que esas cuatro necesitan: `saldo` STRING con signo y `signo` derivado
> en el servidor, comprobado contra Postgres en `wallet-tienda-cobro.test.ts` (d).

### E — lo que ve la tienda

| R | test | estado |
| --- | --- | --- |
| R32 | `wallet-tienda-cobro.test.ts` (f) afirma que el cobro SÍ sale en `listarPorTienda` de ESA tienda —la misma lectura que sirve `/mi-wallet`—. El render de la tabla es `desglose-tienda-ledger.test.tsx` (I.2) | **parcial** |
| R33 | `tests/unit/components/desglose-tienda-labels.test.ts` → «⭑ FICHA 381 (R33/R34)»: «Cobro de Ordenex», DISTINTO de `ajuste_debito`, que no cambió, y sin etiquetas repetidas en todo el diccionario | **CUBIERTO** |
| R34 | idem (es el MISMO objeto reexportado por `/wallet/tiendas`, afirmado con `toBe` de identidad) | **CUBIERTO** |
| R35 | idem → «las opciones del filtro salen del SEED» + `toContain("cobro_manual")`. El render de los dos selectores es I.2 | **parcial** |
| R36 | `tests/unit/utils/desglose-tienda.test.ts` → «381/R36: un cobro manual cae en CARGOS, no en `aFavor` ni en `pagado`» | **CUBIERTO** |
| R37 | `tests/unit/components/mi-wallet-labels.test.ts` (I.3, la única línea de producción de esa tanda: `cargosHint`) | **PENDIENTE — pantalla** |
| R38 | `wallet-tienda-cobro.test.ts` → «(f) el cobro NO aparece en el libro de otra tienda, ni le mueve el saldo», con discriminador sobre la tienda cobrada | **CUBIERTO** |
| R39 | la descarga lee el MISMO `CATEGORIA_TIENDA_LABEL`, cuya unicidad afirma `desglose-tienda-labels.test.ts`. El test por descarga es I.2 | **parcial** |

### F — el rastro

| R | test |
| --- | --- |
| R40 | `tests/unit/repositories/wallet-tienda-movimiento-repository.test.ts` → «381/D.3» (tipo, entidad, id del asiento, etiqueta, monto `Decimal`, actor congelado) + integración (a) (la fila REAL en `historial_accion`) |
| R41 | `tests/unit/historial-accion/catalogo-y-choke-point.test.ts` → «⭑ FICHA 381: `cobro_tienda_registrado` es DINERO…» (+ el reparto por categoría, 29 dinero) |
| R42 | `wallet-tienda-cobro.test.ts` → «(e)»: sin asiento no queda fila de historial |
| R43 | `catalogo-y-choke-point.test.ts` → «⭑ FICHA 381 — cobro a tienda: el NOMBRE DE LA TIENDA, nunca la descripcion» + `wallet-tienda-movimiento-repository.test.ts` → «R43: la fila NO lleva la descripcion» + integración (a) (`entidadEtiqueta` no contiene el texto tecleado) + la guardia `historial-accion-sin-datos-cliente.guardia.test.ts` |
| — | el productor censado existe y es atómico | `tests/unit/guards/historial-accion-escrituras-cubiertas.guardia.test.ts` (entrada nueva, forma `recibe_tx`) |
| — | migración 1 + su down, valor a valor y en orden, y el CHECK medido por conducta | `tests/integration/db/wallet-tienda-cobro-migration.test.ts` |
| — | migración 2: los dos enums del historial, up y down | `tests/integration/db/historial-accion-cobro-tienda-migration.test.ts` |

**Resumen:** de los 43, **24 quedan cubiertos por esta mitad** (R12–R27, R33, R34, R36, R38, R40–R43),
**4 quedan parciales** (R7, R10, R32, R35, R39 — su mitad de servidor está, falta el render) y
**15 son de pantalla** y los cubre `frontend_dev` (R1–R6, R8, R9, R11, R28–R31, R37).

---

## Verificación

### Gate — `./init.sh` COMPLETO

El rápido **se niega solo** con este diff (toca `db/migrations/**`, `db/schema.prisma`, `lib/types/`
y archivos con nombre de dinero), así que se corrió el completo. Log: `.gate-381.log` (borrado
antes de commitear; no se canalizó por `tail`, y el código de salida se escribió DENTRO del log
para que ningún `echo` posterior lo tapara).

```
✓ typecheck paso
✓ lint (0 errores; 174 warnings preexistentes del árbol)
 Test Files  1805 passed (1805)
      Tests  25888 passed | 26 skipped (25914)
✓ tests: sin rojos nuevos (0 archivo(s) rojo(s) sobre 1805 ejecutado(s), todos en el baseline conocido)
! migraciones sin down.sql: 20260814120000_ruta_optimizada_trazado 20260814140000_ruta_parada_tramo 20260814160000_ruta_tramo_vivo_at
✓ .env presente
== init OK ==
INIT_EXIT=0
```

- **`.env` copiado de la raíz antes del gate** (y borrado antes de commitear): sin él, ~138 archivos
  de `tests/integration/db` se saltan y el gate diría «OK» sin comprobar la capa de datos. El propio
  init lo confirma: `✓ .env presente`.
- **Los 26 `skipped` son los conocidos** y ninguno es de base de datos: 17 de
  `tests/components/AnaliticaPage.test.tsx` y 9 de `tests/components/AnaliticaShell.test.tsx`.
- **El aviso de «migraciones sin down.sql» son las TRES carpetas de agosto que ya venían sin él.**
  Las dos de esta ficha llevan el suyo; la deuda no crece.

> **La primera corrida del gate salió ROJA (`INIT_EXIT=1`), con 4 fallos en 2 archivos, y eran
> MÍOS**: `historial-accion-orden-zona-reconciliada-migration.test.ts` y
> `historial-accion-zona-pago-mensajero-migration.test.ts` afirmaban literales sobre «el catálogo de
> hoy» que mi enum movía. Se actualizaron —nunca se relajaron— y se volvió a correr el gate entero.
> Queda escrito porque es exactamente el radio de explosión que justifica que el modo rápido se
> niegue ante una migración.

### Mutaciones — 7, con autocomprobación, y las 7 murieron

El arnés aborta si el texto a sustituir no aparece **exactamente una vez**, aborta si vitest no
emite su línea de resultados (sin ella un «rojo» sería una invención) y **restaura releyendo el
archivo y comparando byte a byte**. Las cuatro obligatorias del encargo son M1, M2, M3 y M4.

| # | mutación | resultado |
| --- | --- | --- |
| **M1** | **el cobro se marca como INGRESO DE ORDENEX**: el servicio escribe además un `ingreso_ajuste` en `wallet_movimiento` dentro de la misma tx | **ROJO** — 3 fallos en 3 archivos: «el cliente de la transaccion recibe CERO llamadas a `walletMovimiento`», «y NO construye ningun escritor de la caja de Ordenex (R24)», «(a)(c)(g) el cobro se escribe, baja el saldo exactamente y NO toca la caja» |
| **M2** | **el disponible se RECORTA A CERO**: `derivarSaldoTienda` devuelve `max(saldo, 0)` | **ROJO** — 7 fallos: «un cobro mayor que el saldo se ACEPTA y devuelve `signo: negativo`», «(d) … lo deja NEGATIVO (R27)», «un SEGUNDO cobro … lo hunde mas», y los 4 de R18 |
| **M3** | **la TIENDA deja de ver el cobro en su wallet**: `listarPorTienda` añade `categoria: { not: "cobro_manual" }` al `WHERE` | **ROJO** — «(f) el cobro NO aparece en el libro de otra tienda, ni le mueve el saldo (R38)» (su discriminador sobre la tienda cobrada) |
| **M4** | **el importe pasa por `Number()`** antes de persistirse | **ROJO** — 4 fallos: «es UN debito … con su monto», «R40: el rastro lleva … el MISMO importe», «1500 se persiste como el STRING 1500.00», «1500.5 → 1500.50» |
| **M5** | **se borra la escritura del historial** del servicio | **ROJO** — 13 fallos en 2 archivos. ⚠️ **Y la guardia del censo se quedó VERDE (57/57)**: mide por MÉTODO, no por escritura. Es la trampa medida, reproducida a propósito |
| **M6** | **el `down.sql` se queda RANCIO**: pierde `zona_pago_mensajero_cambiado` (el valor que añadió la 380) y la lista queda con 49 en vez de 50, **siendo SQL válido** | **ROJO** — «⭑ el down devuelve LOS DOS enums a su lista previa, valor a valor y EN ORDEN», y el diff **nombra el valor perdido** |
| **M7** | **el CHECK de la migración 2 no admite `cobro_manual`** en la rama `debito` | **ROJO** — 3 fallos, incluidos «⭑ la 2 abre EXACTAMENTE un par» y «⭑ el CHECK de HOY cubre el enum de HOY» |

Las 7 se corrieron **dos veces** (antes y después de refactorizar los tipos de los dobles) con el
mismo resultado, y el `typecheck` de control tras la última restauración quedó verde.

### Lo que NO se pudo probar aquí, dicho en voz alta

- **Los tests de servicio usan dobles y no ven el SQL.** Todo lo que decide qué filas se escriben o
  se leen está en `tests/integration/db/wallet-tienda-cobro.test.ts`, contra Postgres real, dentro
  de una transacción que siempre se revierte y con `serializarEscriturasReales` como primera
  sentencia (sin ese lock, dos archivos en paralelo se dan un `40P01` que vitest reporta como
  SKIPPED). **No hubo ningún `40P01` en ninguna de las dos corridas completas del gate.**
- **No hay `if (!x) return;` en ninguno de los tres archivos de integración.** Cada caso tiene su
  control positivo: el que mide el rechazo del CHECK inserta antes el par correcto; el que mide la
  atomicidad tiene su gemelo con el registro sano; el que mide el alcance afirma también que la
  tienda cobrada SÍ se movió.
- **La app no se ha visto con los ojos** (tarea J.3 del spec): no hay pantalla todavía. Es la
  primera cosa que debe hacer `frontend_dev` al terminar su mitad.

---

## Lo que hay que mirar (no son detalles)

1. **Q1 del spec sigue SIN FIRMAR.** El diseño propone `cobro_manual`, «Cobro de Ordenex» y
   «Cobrar un costo a una tienda», y T0.2 exige los tres textos confirmados por escrito. **No
   consta esa confirmación.** Se implementó la propuesta del diseño para no bloquear la ficha.
   Coste de cambiar de opinión: la etiqueta del libro es **una línea** en un `Record`
   (`mi-wallet-labels.ts`); la del selector, **una línea** en el catálogo de conceptos (aún sin
   escribir). El **valor de enum** sí costaría una migración nueva.
2. **Se tocó `app/(app)/mi-wallet/_components/mi-wallet-labels.ts`, que es zona de frontend.** Una
   línea, y sin ella el build **no compila**: `CATEGORIA_TIENDA_LABEL` es un `Record` total sobre la
   categoría. Es la etiqueta que define el contrato («cómo lo ve la tienda»), no una decisión de
   presentación. `DESGLOSE_MI_WALLET_LABEL.cargosHint` (R37) **NO se tocó**: eso es tanda I.3.
3. **El spec se equivoca en la trampa de T C.3.** `tasks.md` avisa de que
   `tests/unit/analytics/catalogo-produccion.guardia.test.ts` escanea `progress/` y obliga a citar
   una decisión si el informe nombra el campo de categorías de la métrica de cuenta por pagar a
   tiendas. **Comprobado en el código:** `cambiosDecididosEnProgress()` lee **solo**
   `progress/decision*.md` (`/^decision.*\.md$/`), y la propia guardia afirma que una cita a un
   `progress/impl_*.md` devuelve `[]`. Un informe de implementación **no puede** disparar esa regla.
   Aun así, esta bitácora evita la forma `` `metrica.campo` `` para no depender de ese análisis.
4. **`registrarCobroTiendaAction` lleva `@sin-superficie` y hay que BORRARLO al cablear la
   pantalla.** La guardia de superficie falla en las dos direcciones: por una acción sin quien la
   monte, y por una anotación que sobrevive a su motivo. Está escrito dentro del docstring.
5. **C2 del spec, comprobada contra Postgres:** un cobro lleva `origen_id` NULL, queda **fuera** del
   índice único parcial y **no se deduplica**. Dos envíos idénticos son dos cobros. Lo único que hay
   entre medias es el anti-doble-envío del `Modal`, que es de pantalla. El test
   «un SEGUNDO cobro sobre un saldo ya negativo…» lo afirma para que no sea una sorpresa.
6. **La base local está migrada** con las dos migraciones. Cualquier otra rama que corra el gate
   sobre esta misma base necesita `prisma migrate deploy` + `pnpm run db:generate` antes.

---

## Veredicto

La mitad de servidor de la 381 está completa y verde: dos migraciones con su `down.sql` medido
contra `pg_enum` y probado por reconstrucción, un cobro que baja el disponible de la tienda sin
tocar la caja de Ordenex, un saldo que puede quedar negativo y se devuelve entero, y 7 mutaciones
—incluidas las cuatro firmadas— que mueren. Falta la pantalla, y con ella 15 requisitos.
