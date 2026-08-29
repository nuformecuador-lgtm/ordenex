# Ficha 334 — Un solo diálogo para mover dinero en la wallet · Diseño

> Todo lo que aparece aquí como «hoy» está verificado **leyendo el archivo real**, no el grafo. El
> índice del MCP se usó para localizar; las líneas citadas se comprobaron una a una.

---

## 1. Alcance

**Entra:** fusionar los dos diálogos de registro manual de `/wallet` en uno solo con cuatro
conceptos, y darle al movimiento una FECHA con tope en hoy.

**No entra:** gastos fijos y sus plantillas (fichas 85, 332, 333); el rediseño del ledger; el
renombrado de categorías; el arreglo del desfase de la tarde (pregunta abierta 3).

Es **una fusión de dos formularios más una fecha**, no una refundación. Todo lo que sigue está
acotado por eso: cero tablas nuevas, cero migraciones, cero endpoints nuevos.

---

## 2. Lo que hay hoy (medido)

| pieza | archivo | qué hace |
| --- | --- | --- |
| Botón «Registrar movimiento» | `app/(app)/wallet/_components/RegistrarMovimientoManualDialog.tsx` | tipo ingreso/egreso → `categoriaDe()` → `ingreso_ajuste`/`egreso_ajuste`; llama `registrarMovimientoManualAction` |
| Botón «Registrar egreso» | `app/(app)/wallet/_components/RegistrarEgresoAdministrativoDialog.tsx` | `gasto_variable`/`sueldo`, label de descripción adaptado; llama `registrarEgresoAdministrativoAction` |
| Los monta | `WalletModule.tsx:202-207` | uno al lado del otro en la barra de acciones |
| Borde ajustes | `lib/actions/wallet.ts:156` + `registrarMovimientoManualSchema` (`lib/types/wallet.ts:303`) | zod; `refine` que exige que tipo y categoría casen |
| Borde egresos | `lib/actions/wallet-egresos.ts:76` + `registrarEgresoAdministrativoSchema` (`lib/types/wallet.ts:365`) | zod; `z.enum(TIPO_EGRESO_MANUAL_SEED)` |
| Servicio ajustes | `lib/services/WalletService.ts:175-206` | `origen_tipo = manual`, `origen_id = null` |
| Servicio egresos | `lib/services/WalletEgresoService.ts:39-73` | `origen_tipo = gasto`, `origen_id = null`, categoría por `TIPO_EGRESO_MANUAL_A_CATEGORIA` |
| Repositorio | `lib/repositories/WalletMovimientoRepository.ts` | `crearMovimientos` (createMany + skipDuplicates), `listar`, dos agregados, `obtenerPorId` |

**La regla que hay que conservar (R11), localizada:** el gasto FIJO no se registra a mano. Vive en
CUATRO sitios y ninguno se debilita:

1. `lib/types/wallet.ts:351` — `TIPO_EGRESO_MANUAL_SEED = ["gasto_variable", "sueldo"]`.
2. `lib/types/wallet.ts:357` — `TIPO_EGRESO_MANUAL_A_CATEGORIA` no mapea `gasto_fijo`.
3. `lib/types/wallet.ts:365` — el schema del borde re-valida con `z.enum(...)` → `validation_error`.
4. `app/(app)/wallet/_components/wallet-labels.ts:244` — el `Select` se puebla del SEED.

Emisor único de `egreso_gasto_fijo`: `lib/services/GeneracionGastosFijosService.ts:61` (el cron).
Origen documental: R19/R27 de `specs/45-wallet-gastos-sueldos/requirements.md`.

---

## 3. ⟨D1⟩ La fecha: **se reutiliza `fecha_movimiento`. No hay columna nueva, no hay migración.**

### 3.1 Por qué columna filtran de verdad los filtros — verificado

- `WalletFiltros.tsx:104-140` emite `desde`/`hasta` como texto `YYYY-MM-DD` de un `<input type="date">`.
- `listarMovimientosSchema` (`lib/types/wallet.ts:325-326`) los convierte con `z.coerce.date()`.
- `WalletMovimientoRepository.buildWhere` (líneas 51-62) los aplica **sobre `fechaMovimiento`**:
  `where.fechaMovimiento = { gte: desde, lte: hasta }`.
- `listar` (línea 103) ordena **`orderBy: { fechaMovimiento: "desc" }`**.
- Los dos agregados (`agregarPorCategoriaYTipo`, `agregarPorCategoria`) usan el MISMO `buildWhere`.

**Conclusión: los filtros y el orden del libro ya viven en `fecha_movimiento`, no en `created_at`.**

### 3.2 La columna ya existe, ya es escribible y ya la escribe alguien

`db/schema.prisma:1509-1528`:

```
fechaMovimiento DateTime @default(now()) @map("fecha_movimiento")
createdAt       DateTime @default(now()) @map("created_at")
// SIN updatedAt / deletedAt: la fila es INMUTABLE (R3)
```

Son **dos columnas distintas desde el día uno**. Y la feature 173 ya abrió el camino de escritura:
`CrearMovimientoInput.fechaMovimiento?: Date`
(`lib/interfaces/repositories/IWalletMovimientoRepository.ts:26-35`), que el repositorio **omite si
el llamador no la trae** para que caiga el `DEFAULT CURRENT_TIMESTAMP`
(`WalletMovimientoRepository.ts:87-90`). El camino vivo de pagos a tienda ya la usa
(`medianocheUtcDelDia(input.fechaPago)`, `lib/utils/descripcion-pago.ts:82`).

**Consecuencia directa: esta ficha no necesita migración, ni `down.sql`, ni cambio de RLS.** La
columna existe, tiene índice (`@@index([fechaMovimiento])`) y el contrato del repositorio ya la
admite. Lo único que falta es que el borde manual la deje elegir.

### 3.3 `created_at` NO cambia de significado — y esto se comprobó

`created_at` de `wallet_movimiento` **no lo lee nadie en `lib/`**. Comprobado con tres búsquedas,
reproducibles: `createdAt` en los módulos `*Wallet*` de `lib/` → 0; `createdAt|created_at` en
`lib/repositories/FinanzasDiarioRepository.ts` → 0; `walletMovimiento` seguido de `createdAt` en
cualquier archivo de `lib/` → 0 archivos. Sigue siendo lo que dice ser: el rastro de cuándo se creó
la fila. Esta ficha **no lo reinterpreta**; al contrario, le da su primer lector útil como criterio
de desempate (⟨D2⟩), que es exactamente su semántica.

### 3.4 Qué consumidores se mueven, con nombre de archivo

Se mueven **solo porque una fila puede quedar fechada en un día pasado**, no porque la columna
cambie de significado:

| consumidor | archivo | efecto |
| --- | --- | --- |
| Libro paginado + filtros `desde`/`hasta` | `lib/repositories/WalletMovimientoRepository.ts:51-110` | la fila aparece en la posición de su día, no arriba del todo |
| Descarga del libro completo | `app/(app)/wallet/_components/wallet-ledger-descarga-columnas.ts:58` (`fechaDiaISO`) | emite el día elegido |
| Tabla del libro | `app/(app)/wallet/_components/WalletLedger.tsx:215` (`slice(0,10)`) | pinta el día elegido |
| Las dos cifras de la caja y el desglose | `agregarPorCategoriaYTipo` / `agregarPorCategoria` | con filtros de fecha puestos, la fila cuenta en su día |
| **Rollup DIARIO por día calendario CR** | `lib/repositories/FinanzasDiarioRepository.ts:60-103` (`DIA_CR`, ventana `[desde,hasta)` con `::timestamp`) | **la fila suma en el día elegido** |
| **Cubos de la analítica financiera** | `lib/repositories/IngresosAnaliticaRepository.ts:294-305` (`width_bucket(fecha_movimiento, …)`) + métricas con `fuente.tablas: ["wallet_movimiento"]` en `lib/analytics/metrics.ts:488,503,518,554,596,632` | **la fila cae en el cubo del día elegido** |
| Backfill de tesorería (histórico) | `lib/services/CajaBackfillTesoreriaService.ts` | no se toca; ya escribe `fechaMovimiento` retroactivo |

**Y quién NO se mueve, comprobado para no inventar:**
`lib/repositories/ConciliacionCierresAnaliticaRepository.ts:234` filtra
`origenTipo = cierre_dia` con `origenId IN (…)`; un movimiento manual tiene origen `manual` o
`gasto`, así que **nunca entra en la conciliación de cierres**.
`RecaudoAnaliticaRepository.ts:40` y `CuentasPorPagarAnaliticaRepository.ts` leen
`wallet_tienda_movimiento` / `pago_mensajero_movimiento`, **otras tablas**.

**Esto complica la ficha y se dice igual:** el rollup diario y los cubos financieros son series
temporales que ya se sirvieron. Registrar hoy un gasto de hace tres semanas **cambia una cifra de
un día ya reportado**. Eso es exactamente lo que el humano pidió («registrar el gasto de ayer con su
fecha real») y es la lectura correcta del dato, pero no es gratis: por eso la **pregunta abierta 1**
propone acotar cuánto se puede ir hacia atrás y la deja en la puerta humana.

### 3.5 El instante concreto que se guarda

| caso | qué se escribe en `fecha_movimiento` | por qué |
| --- | --- | --- |
| fecha = **hoy CR** (valor por defecto) | **nada**: la clave no viaja, manda el `DEFAULT CURRENT_TIMESTAMP` | R23. Coste CERO: es byte a byte el comportamiento de hoy, el movimiento sigue encabezando el libro y las 38 filas de producción conservan su semántica |
| fecha **anterior a hoy CR** | `inicioDelDiaCREnUtc(fecha)` = `${fecha}T06:00:00.000Z` (`lib/utils/fecha-cr.ts:118`) | R22/R25. Es el instante en que empieza ese día en Costa Rica, y es **la misma frontera que usan el rollup y los cubos** para decidir a qué día pertenece una fila |
| fecha **posterior a hoy CR** | nada: se rechaza | R20 |

Comprobación de R25 con la fórmula real del rollup
(`FinanzasDiarioRepository.ts:60`, `(m.fecha_movimiento − 6h)::date`):
`2026-08-28T06:00:00Z − 6h = 2026-08-28T00:00:00` → día `2026-08-28`. ✔

Comprobación de R27 (`desde` con `z.coerce.date()` → `2026-08-28T00:00:00Z`):
`06:00Z ≥ 00:00Z` → entra. ✔

### 3.6 Alternativas descartadas para la fecha

**(a) Columna nueva `fecha_negocio`.** Descartada. Obligaría a migración con `down.sql`, a decidir
por cuál de las dos filtran los filtros y ordena el libro, y a hacer convivir dos fechas en un libro
inmutable. La columna que la ficha necesita **ya existe y ya es la que manda** (§3.1/§3.2): añadir
otra sería crear el problema que se viene a evitar.

**(b) Reutilizar `created_at` como fecha de negocio.** Descartada, y por eso la ficha lo pedía
argumentado: `created_at` es el único rastro de cuándo se creó la fila en un libro que no tiene
`updated_at` ni soft-delete. Convertirlo en un dato que el usuario elige deja al libro **sin ningún
campo que diga cuándo pasó de verdad**, y para nada: los seis consumidores de §3.4 ya leen
`fecha_movimiento`, no `created_at`, así que el cambio no compraría ni un consumidor.

**(c) Medianoche UTC (`medianocheUtcDelDia`, convención de la ficha 172).** Descartada **para esta
tabla**, y merece explicación porque es un precedente vivo del mismo repo:
la 172 eligió `00:00Z` para los ledgers de tienda y mensajero con un argumento medido
(`lib/utils/descripcion-pago.ts:70-84`): los desgloses filtran con `z.coerce.date()` y con `06:00Z`
el pago quedaría fuera de su propio día al filtrar por `hasta`. Ese argumento es correcto **para
aquellos consumidores**. Aquí no aplica igual porque el consumidor decisivo es otro: con `00:00Z`,
`(00:00Z − 6h)::date` cae en el día **ANTERIOR**, y el rollup diario y los cubos financieros
contarían el gasto de ayer como de anteayer — un número mal puesto en un informe, que es peor que
una fila que no entra por un filtro. Coste asumido y declarado: con `06:00Z` la fila **no** entra
por `hasta = D`… igual que no entran hoy las filas fechadas con `now()`, que son casi todas. Se
prefiere ser consistente con la mayoría del libro antes que con la excepción (pregunta abierta 4).

**(d) Fijar siempre `06:00Z`, también para hoy.** Descartada. Un movimiento registrado hoy dejaría
de encabezar el libro (quedaría por debajo de todos los automáticos del día, que llevan hora real):
el usuario registra y **no lo ve donde espera verlo**. Es un fallo mudo, de la familia que este repo
ya tiene medida.

**(e) Conservar la hora del reloj y mover solo el día.** Descartada por complejidad injustificada:
evita el empate de ⟨D2⟩, pero guarda un instante que no es ni el del registro ni una marca canónica
del día, y hay que explicarlo cada vez que alguien lea la columna.

---

## 4. ⟨D2⟩ Orden total determinista del libro

**El problema no es hipotético y ya está en el árbol:** `listar` ordena por una sola columna
(`orderBy: { fechaMovimiento: "desc" }`, línea 103) y pagina con `skip`/`take`. Dos filas con el
MISMO `fecha_movimiento` quedan en orden indefinido, y con paginación eso significa **una fila que
aparece dos veces o ninguna**. Hoy ya puede pasar: dos `egreso_pago_tienda` con la misma
`fecha_pago` reciben exactamente `${fecha}T00:00:00.000Z` (§3.6c). Con la fecha elegida, dos
movimientos fechados en el mismo día pasado reciben exactamente el mismo instante y el empate deja
de ser raro.

**Decisión:** `orderBy: [{ fechaMovimiento: "desc" }, { createdAt: "desc" }, { id: "desc" }]`.

- `createdAt` como primer desempate: dentro de un mismo día de negocio, el orden es el de creación
  real — que es la semántica de esa columna y su primer uso (§3.3).
- `id` como cierre: garantiza orden **total** aunque dos filas compartieran también `created_at`.
- **Sin índice nuevo.** El desempate solo actúa dentro de un `fecha_movimiento` idéntico; el índice
  `@@index([fechaMovimiento])` sigue sirviendo al filtro de rango. Si algún día el libro crece hasta
  que esto se note, la medida se hace entonces y con números, no ahora por si acaso.

Toca un literal que **es contrato** — `tests/unit/repositories/wallet-movimiento-repository.test.ts:159`
(`expect(arg.orderBy).toEqual({ fechaMovimiento: "desc" })`). Se re-escribe con el array completo,
NO se relaja a `expect.anything()` ni se deriva de la propia fuente.

---

## 5. ⟨D3⟩ Devolver el movimiento que se acaba de crear

**Defecto que la fecha convierte en determinista.** Los dos servicios releen así el movimiento
recién insertado:

```ts
const { movimientos } = await this.repo.listar({ page: 1, pageSize: 1, tipo, categoria });
return { status: "ok", movimiento: movimientos[0] };
```

(`WalletService.ts:198-205` y `WalletEgresoService.ts:66-72`). Como `listar` ordena por
`fecha_movimiento desc`, eso devuelve **el más reciente de esa categoría**. Hoy funciona por
accidente (todo se fecha con `now()`). Registrado un gasto variable con fecha de la semana pasada,
devuelve **otro gasto variable**: el servicio afirma «este es el movimiento que registraste» sobre
una fila ajena. R28.

**Decisión:** el `id` lo genera el SERVICIO con `randomUUID()` y viaja en la inserción; la relectura
es `repo.obtenerPorId(id)`.

- `CrearMovimientoInput` gana `id?: string` **opcional**, exactamente con la forma —y por el mismo
  motivo— con que la 173 le añadió `fechaMovimiento?: Date`: ausente ⇒ manda el `@default(uuid())`
  y **ninguno de los cinco escritores existentes cambia de comportamiento**.
- Precedente idéntico y ya razonado en el repo:
  `lib/repositories/registrar-cambio-dia-reparto.ts:55-83` — «`createMany` sobre Postgres NO devuelve
  los ids generados… generarlos arriba permite seguir haciendo UN SOLO `createMany`».

**Alternativa descartada: un método nuevo `crearManual()` en el repositorio** que use `create()` y
devuelva la fila. Es más limpio en abstracto y ahorra una consulta, pero rompe una afirmación
deliberada del arnés: `wallet-movimiento-repository.test.ts:284-301` fija que **la superficie del
repositorio son exactamente cinco métodos**, lista cerrada, para que el libro no gane escrituras a
escondidas. Un campo opcional en un input existente respeta esa frontera; un método nuevo la abre.

---

## 6. ⟨D4⟩ Un diálogo, **dos** Server Actions

**Decisión:** se unifica la **interfaz**, no el backend. El diálogo enruta según el concepto:

| concepto | action | payload |
| --- | --- | --- |
| gasto variable | `registrarEgresoAdministrativoAction` | `{ tipoEgreso: "gasto_variable", monto, descripcion, fecha? }` |
| sueldo | `registrarEgresoAdministrativoAction` | `{ tipoEgreso: "sueldo", monto, descripcion, fecha? }` |
| ajuste que suma | `registrarMovimientoManualAction` | `{ tipo: "ingreso", categoria: "ingreso_ajuste", monto, descripcion, fecha? }` |
| ajuste que resta | `registrarMovimientoManualAction` | `{ tipo: "egreso", categoria: "egreso_ajuste", monto, descripcion, fecha? }` |

**Por qué no una action nueva que lo unifique todo** (alternativa descartada): los cuatro conceptos
**no son intercambiables en la base**. Escriben `origen_tipo` distinto (`gasto` vs `manual`), y de
ese campo cuelga una regla viva: `esEgresoAdministrativo` (`wallet-labels.ts:272`) declara reversable
exactamente `tipo = egreso ∧ origen_tipo = gasto`. Una action única que escribiera `manual` para
todo **volvería reversables los ajustes y dejaría de serlo los sueldos**, o al revés — un cambio de
comportamiento en dinero que nadie pidió, colado dentro de un cambio de formulario. Además obligaría
a reescribir dos servicios probados y sus dos bordes por un beneficio que el usuario no ve: el
usuario ve UN botón y UN formulario, y eso ya lo entrega esta decisión.

---

## 7. Modelo de datos, migraciones y RLS

**Ninguna migración. Ninguna tabla nueva. Ningún cambio de RLS.** Justificación en §3.2: la columna
`fecha_movimiento` existe desde la feature 42, tiene índice y su escritura opcional ya está en el
contrato del repositorio desde la 173. El libro sigue siendo append-only e inmutable (R17): no se
añade `update`, ni `delete`, ni `updated_at`.

---

## 8. Contratos de entrada/salida

### 8.1 `lib/types/wallet.ts` — la fecha en el borde

```ts
// Día calendario YYYY-MM-DD, existente y NO posterior a hoy en Costa Rica (R19/R20/R21).
export function esFechaMovimientoValida(value: string, now: Date = new Date()): boolean {
  if (!esFechaCalendarioValida(value)) return false;   // lib/utils/fecha-cr.ts:73 (round-trip)
  return value <= fechaCalendarioCR(now);              // lib/utils/fecha-cr.ts:47 (UTC-6, sin off-by-one)
}

export const fechaMovimientoSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "La fecha debe tener el formato YYYY-MM-DD.")
  .refine((v) => esFechaMovimientoValida(v), "La fecha no puede ser posterior a hoy.");
```

Y los dos schemas existentes ganan `fecha: fechaMovimientoSchema.optional()`
(`registrarMovimientoManualSchema`, `registrarEgresoAdministrativoSchema`). Opcional a propósito:
sin la clave, el comportamiento es el de hoy.

**Por qué se escribe aquí y no se promueve `esFechaPagoValida`** (alternativa descartada): esa
función (`lib/types/liquidacion.ts:108`) hace exactamente lo mismo, y su propio comentario dice por
qué no se comparte: «Lo único propio de esta función es la DIRECCIÓN de la comparación… que es justo
lo que no se debe compartir». Lo que sí se reutiliza —y es donde está la trampa real— son las dos
piezas comunes de `lib/utils/fecha-cr.ts`: el round-trip que caza `2026-02-31` y el cálculo del día
CR sin off-by-one. Promover la función obligaría a tocar `lib/types/liquidacion.ts`, un segundo
camino de dinero, por dos líneas.

### 8.2 Servicios

Los dos `registrar*` traducen `fecha` (texto) → `fechaMovimiento` (instante), que es una decisión de
negocio y por eso vive en el servicio, no en el borde ni en el repositorio:

```ts
private instanteDe(fecha?: string): Date | undefined {
  if (fecha === undefined || fecha === fechaCalendarioCR()) return undefined; // R23: manda el DEFAULT
  return inicioDelDiaCREnUtc(fecha);                                          // R22
}
```

`undefined` ⇒ la clave no viaja al repositorio (`WalletMovimientoRepository.ts:90`).
Testeable con `vi.useFakeTimers()`; no se añade reloj inyectado (ningún servicio de la wallet lo
tiene y esta ficha no viene a cambiar ese patrón).

### 8.3 Resultados

Sin cambios de forma: `RegistrarMovimientoManualServiceResult` y `RegistrarEgresoServiceResult`
siguen devolviendo `{ status: "ok", movimiento: WalletMovimientoDTO }`. Lo que cambia es que ahora
el movimiento devuelto **es el correcto** (⟨D3⟩). Un `fecha` inválida sale por la rama que ya existe:
`ZodError → VALIDATION_ERROR → { status: "validation_error", fieldErrors }` con la clave `fecha`,
que el diálogo pinta bajo su campo.

---

## 9. El catálogo de conceptos (frontend)

Módulo nuevo `app/(app)/wallet/_components/wallet-conceptos-manuales.ts`. No va dentro de
`wallet-labels.ts` porque no es solo texto: lleva el enrutado. Es la **única** fuente de los cuatro
conceptos y por eso la regla del gasto fijo se puede afirmar sobre él.

| id | etiqueta en el diálogo | sale en el libro como | destino | descripción: etiqueta |
| --- | --- | --- | --- | --- |
| `gasto_variable` | Gasto variable | `CATEGORIA_LABEL.egreso_gasto_variable` → «Gasto variable» | egreso administrativo | «Concepto del gasto» *(sin cambio)* |
| `sueldo` | Sueldo | `CATEGORIA_LABEL.egreso_sueldo` → «Sueldo» | egreso administrativo | «Trabajador y periodo» *(sin cambio)* |
| `ajuste_ingreso` | Ajuste que suma dinero | `CATEGORIA_LABEL.ingreso_ajuste` → «Ajuste (ingreso)» | ajuste manual | «Motivo del ajuste» |
| `ajuste_egreso` | Ajuste que resta dinero | `CATEGORIA_LABEL.egreso_ajuste` → «Ajuste (egreso)» | ajuste manual | «Motivo del ajuste» |

- La columna «sale en el libro como» **se deriva de `CATEGORIA_LABEL`**, no se copia: si alguien
  renombra una categoría, el diálogo lo sigue solo (R4, y pregunta abierta 5).
- Las dos etiquetas de descripción existentes se conservan **byte a byte**: son las que asertan hoy
  los tests que deben sobrevivir (R29).
- `gasto_fijo` no está, y hay un test que afirma que la lista de categorías destino es exactamente
  `{egreso_gasto_variable, egreso_sueldo, ingreso_ajuste, egreso_ajuste}` (R11).

---

## 10. La interfaz

**Componente nuevo:** `app/(app)/wallet/_components/RegistrarMovimientoCajaDialog.tsx`.
**Se borran:** `RegistrarMovimientoManualDialog.tsx` y `RegistrarEgresoAdministrativoDialog.tsx`
(sus dos únicos consumidores son `WalletModule.tsx:202-207`; sus dos únicos llamadores de action son
ellos mismos — verificado por grep sobre `*.tsx`).

Composición **con las primitivas de la ficha 200, sin inventar ninguna**: `Button` + `Modal`
(`components/shared/Modal.tsx`) + `Select` (`components/ui/select`) + `FormField`
(`components/shared/FormField`) + `Input` + `Label`. Mismo esqueleto que los dos diálogos que
sustituye: `open` controlado, `closeOnConfirm={false}`, `confirmLabel="Registrar"`, toast por
`useToast`, `router.refresh()` + `onRegistrado?.()` al terminar (R18).

Campos, en orden: **Concepto** (Select, `aria-label="Concepto del movimiento"`) → **Monto**
(`inputMode="decimal"`, placeholder `0.00`) → **Fecha** (`<Input type="date">` con `Label` visible,
`max={fechaCalendarioCR()}`, valor inicial `fechaCalendarioCR()`) → **Descripción** (textarea con la
etiqueta del concepto). Bajo el Select, una línea de ayuda: «Se registra en el libro como
«{nombre}».» (R4).

Textos, en **voseo** y sin siglas, alineados con los que ya existen:

| situación | texto |
| --- | --- |
| botón | «Registrar movimiento» |
| título | «Registrar movimiento en la caja» |
| descripción del modal | «Elegí el concepto, el monto y la fecha. El movimiento es inmutable una vez registrado.» |
| éxito | «Movimiento registrado correctamente.» |
| `forbidden` | «No tenés permiso para registrar movimientos.» |
| `unauthenticated` | «Tu sesión expiró. Iniciá sesión de nuevo.» |
| fecha futura (cliente) | «La fecha no puede ser posterior a hoy.» |
| monto | «El monto debe ser un número mayor que 0.» *(sin cambio)* |
| descripción | «La descripción es obligatoria.» *(sin cambio)* |

Money-safe (R15): el monto se valida con `montoValido` (`components/shared/monto-cliente.ts`) y viaja
como STRING; **cero `Number(` y cero `parseFloat`** en el componente nuevo.

`WalletModule.tsx` queda con **un** hijo en la barra de acciones y el mismo `onRegistrado`.

---

## 11. Riesgos y efectos colaterales declarados

1. **Series ya servidas.** Fechar hacia atrás cambia cifras de días pasados en el rollup diario y en
   los cubos (§3.4). Es el efecto buscado, pero conviene acotarlo — pregunta abierta 1.
2. **Se borra código, y aquí eso ya costó una regresión.** El test
   `tests/unit/components/wallet-registrar-egreso-dialog.test.tsx` **no está citado por ningún
   `specs/*/tasks.md` ni `design.md`** (verificado), así que la guardia
   `tests/unit/guards/test-citado-desaparecido.guardia.test.ts` no lo protege. Lo protege R29 y una
   task explícita: sus tres casos se migran, no se pierden.
3. **El gate rápido se va a negar solo.** El diff toca `lib/types/wallet.ts` (`lib/types/**`) y
   archivos con nombre de dinero. Es `fail`, no aviso (`docs/verification.md`): esta ficha se cierra
   con **`./init.sh` completo**.
4. **Empates preexistentes.** ⟨D2⟩ arregla de paso una inestabilidad de paginación que ya podía
   darse con dos pagos a tienda de la misma fecha. No se anuncia como feature; se deja anotado.

---

## 12. Mapa `R<n> → test` (el detalle, en `tasks.md`)

Trazabilidad completa en `tasks.md > Mapa R→test`. Resumen: 32 requisitos, todos con test nombrado;
**cuatro** archivos de test nuevos
(`tests/unit/types/wallet-fecha-movimiento-schema.test.ts`,
`tests/unit/components/wallet-conceptos-manuales.test.ts`,
`tests/unit/components/wallet-registrar-movimiento-dialog.test.tsx`,
`tests/integration/db/wallet-fecha-elegida.test.ts`)
y seis existentes ampliados.
