# Ficha 335 — Diseño técnico

> Referencias vivas confirmadas en el archivo real (no solo en el grafo), con línea:
> `app/(app)/mi-wallet/page.tsx`, `app/(app)/mi-wallet/_components/{MiWalletModule,MiWalletFiltros,SaldoTiendaCard,DesgloseTiendaLedger,mi-wallet-labels,mi-wallet-descarga-columnas}`,
> `app/(app)/wallet/_components/{WalletModule,WalletFiltros,CajaResumenCard}`,
> `lib/{actions,services,repositories,interfaces,types,config}` de `wallet-tienda`,
> `lib/auth/menu-visibility.ts`, `db/schema.prisma:1577`.

---

## 1. Modelo de datos

**Sin migración y sin cambio de esquema (R11).** La lectura nueva se resuelve sobre
`wallet_tienda_movimiento`, que ya existe (`db/schema.prisma:1577-1598`) y ya tiene lo necesario:

| Columna | Papel en esta ficha |
| --- | --- |
| `tienda_id` | el acotado por actor, en el `WHERE` |
| `origen_tipo` (`WalletOrigenTipo`) | `= 'cierre_dia'` selecciona lo que viene de un cierre |
| `origen_id` | **es** el `cierre_dia.id` (lo escribe `WalletTiendaFeedService.ts:150-151`) |
| `fecha_movimiento` | el instante con el que se ordena y se rotula la opción |

**Índices: no se añade ninguno, y por qué.** Los vigentes son `@@index([tiendaId, fechaMovimiento])`,
`@@index([tiendaId, categoria])` y `@@index([origenTipo, origenId])`. La consulta nueva lleva
`tienda_id` como columna de cabecera del predicado, que es la primera columna de un índice existente;
lo que agrega es el libro de **una** tienda, no la tabla. `docs/architecture.md` prohíbe «queries sin
índice en rutas calientes» — esta tiene índice y no es caliente (una vez por carga de página, sobre
un subconjunto ya selectivo). Añadir un `(tienda_id, origen_tipo, origen_id)` sería un índice más que
mantener en cada escritura del feed del cierre, a cambio de nada medible.

**Efecto de rebote deliberado:** al no tocar `db/schema.prisma` ni `db/migrations/`, esta ficha
**no dispara** la negativa del modo rápido del gate (`CLAUDE.md`, regla 5). El gate normal
`./init.sh --rapido` sigue valiendo para su PR.

---

## 2. Backend — forma de la lectura nueva

### 2.1 Dónde vive, y por qué ahí

Se **extiende el módulo existente**: repositorio → servicio → Server Action de `wallet-tienda`. No se
crea un repositorio/servicio paralelo (ver §7, alternativa A3).

```
app/(app)/mi-wallet/page.tsx
  └─ listarMisCierresAction()                 lib/actions/wallet-tienda.ts   (resuelve actor, sin zod)
       └─ WalletTiendaService.listarMisCierres(actor)                        (guard de rol + alcance)
            └─ IWalletTiendaMovimientoRepository.listarCierresDeTienda(tiendaId, limite)
                 └─ prisma.walletTiendaMovimiento.groupBy(...)               (1 sentencia)
```

### 2.2 Repositorio

```ts
// lib/interfaces/repositories/IWalletTiendaMovimientoRepository.ts
export interface CierreDeTiendaAgregadoRow {
  cierreId: string;       // = origen_id, un cierre_dia.id
  ultimaFecha: string;    // ISO del movimiento MAS RECIENTE de ese cierre en ESTE libro
  movimientos: number;    // cuantos movimientos de esa tienda trajo ese cierre
}

listarCierresDeTienda(tiendaId: string, limite: number): Promise<CierreDeTiendaAgregadoRow[]>;
```

Implementación (una sola sentencia, R10):

```
groupBy({
  by: ["origenId"],
  where: { tiendaId, origenTipo: "cierre_dia", origenId: { not: null } },
  _max:   { fechaMovimiento: true },
  _count: { _all: true },
  orderBy: [{ _max: { fechaMovimiento: "desc" } }, { origenId: "desc" }],
  take: limite,
})
```

- `tiendaId` va **primero en el objeto `where`, escrito por el caller**, exactamente como en
  `listarPorTienda` y `agregarDesglosePorTienda`. No hay spread encima que pueda pisarlo.
- `origenId: { not: null }` es necesario: la columna es nullable (`manual` no tiene origen) y sin él
  el `groupBy` devolvería un grupo `null` que no es ningún cierre.
- **Desempate (R7):** si el ORM rechazara el `orderBy` compuesto agregado+escalar en un `groupBy`, se
  deja el orden por `_max(fecha_movimiento) DESC` en SQL y el desempate por `cierreId` se aplica
  sobre las filas ya devueltas, **declarando la desviación en `progress/impl_335*.md`**: el
  desempate solo puede afectar al borde del tope.
- Salida **sin ningún importe** (R9): el `_sum` no se pide. Money-safe por construcción, no por
  disciplina.

### 2.3 Servicio

```ts
// lib/interfaces/services/IWalletTiendaService.ts
export type ListarMisCierresServiceResult =
  | { status: "ok"; cierres: CierreTiendaOpcionDTO[]; hayMas: boolean }
  | { status: "forbidden" };

listarMisCierres(actor: Actor): Promise<ListarMisCierresServiceResult>;
```

- **Guard primero** (`actor.rol !== ROL_TIENDA → forbidden`), antes de tocar el repositorio: mismo
  criterio y mismo motivo que `listarMisMovimientos` (`WalletTiendaService.ts:92`) y
  `listarSaldosTiendasPaginado` (`:237`). Con el guard después, la lista ya habría salido de la base.
- **Sin parámetro de entrada (R5).** Es la barrera más fuerte disponible: no hay ninguna clave que
  pueda ampliar el alcance porque no hay entrada donde escribirla. Precedente literal en este mismo
  servicio: `listarSaldosTiendasCompleto(actor)` (`:204`).
- **Tope (R8):** pide `limite + 1` al repositorio y responde `hayMas = filas.length > limite`,
  devolviendo como mucho `limite` elementos. Es el patrón `tope + 1` ya establecido aquí
  (`listarMisMovimientosCompleto`, `:157-166`). Se prefiere a un `count` aparte porque no añade una
  segunda consulta (R10).
- `ultimaFecha` se renombra a `fecha` en el DTO de frontera; no se transforma.

### 2.4 Server Action

```ts
// lib/actions/wallet-tienda.ts   (la novena; las 8 existentes no se tocan)
export type ListarMisCierresActionResult =
  | ListarMisCierresServiceResult
  | { status: "unauthenticated" };

export async function listarMisCierresAction(
  deps: WalletTiendaDeps = {},
): Promise<ListarMisCierresActionResult>;
```

Calcada de `verMiSaldoAction` (`:95-106`): `withErrorHandler`, resuelve el actor,
`throw new UnauthenticatedError()` **antes** de instanciar el servicio (R4), y **sin zod** porque no
hay entrada que validar. El único `AppErrorShape` posible es `UNAUTHORIZED`, así que no se usa
`toWalletTiendaActionError`.

### 2.5 Contratos I/O (frontera servidor → cliente)

```ts
// lib/types/wallet-tienda.ts
export type CierreTiendaOpcionDTO = {
  cierreId: string;    // el valor que viaja como `cierreId` al filtro existente
  fecha: string;       // ISO del movimiento mas reciente de ese cierre en este libro
  movimientos: number; // cardinal, NO es dinero
};
```

`cierreId` sigue siendo un `string` y sigue entrando por
`listarMovimientosTiendaSchema.cierreId: z.string().min(1).optional()`
(`lib/types/wallet-tienda.ts:164`). **El contrato del filtro no cambia**: lo que cambia es quién
produce ese string — antes los dedos de la persona, ahora una opción de una lista. Por eso no hace
falta tocar ni el schema, ni `construirFiltros`, ni `buildFiltrosWhere`.

### 2.6 Configuración del tope

`lib/config/wallet-tienda.ts` gana una clave, con el `readPositiveInt` que ese archivo ya tiene:

```ts
/** Tope de opciones del selector de cierre de `/mi-wallet` (ficha 335, R8). */
MAX_CIERRES_FILTRO: readPositiveInt("WALLET_TIENDA_MAX_CIERRES_FILTRO", 200);
```

Ese archivo **no** está en el censo money-safe de la 172, así que su `Number.parseInt` no lo pone
rojo (comprobado contra `tests/unit/guards/liquidacion-money-safe.test.ts:50-144`).

---

## 3. Frontend — la presentación

### 3.1 Lo que se copia de `/wallet`, y lo que no

Se copia el **lenguaje visual** de `WalletModule.tsx:294-353` (rediseño de la ficha 200); **no se
importa ni un componente de `/wallet`** (ver §7, alternativa A4 — hay una guardia viva que lo
prohíbe).

| Pieza | Hoy en `/mi-wallet` | Después |
| --- | --- | --- |
| contenedor | `div.flex.flex-col.gap-8` | `gap-6` (`DESIGN.md` §Espaciado: ritmo por defecto) |
| tarjeta del saldo | `SaldoTiendaCard` dentro de `div.lg:max-w-md` | la misma tarjeta, **a ancho completo** (se quita el envoltorio) |
| libro | `<section>` con tres hermanos sueltos (filtros, tabla, paginación) | `<section>` con **una** `<Card>` dentro |
| título del libro | solo `aria-label` | `CardHeader > CardTitle` visible **y** el `aria-label` intacto |
| filtros | bloque `flex-wrap items-end gap-4`, rótulos encima | banda `div.border-b.bg-muted/30.px-(--card-spacing).py-3` con `WalletFiltros`-style: `flex-wrap items-center gap-2`, rótulos `sr-only` en los selects, rótulo corto visible en las fechas, botones con `sm:ml-auto` |
| paginación | hermana suelta | `CardFooter` + `sticky={false}` + `className="w-full justify-between gap-3 py-0"` |

**`sticky={false}` no es cosmético.** En modo pegajoso `Pagination` devuelve un fragmento de dos
elementos (envoltorio + centinela de 1px) y el `display:flex` del `CardFooter` los colocaría como dos
columnas. Está escrito y razonado en `WalletModule.tsx:334-339`; se replica igual.

**Cards hermanas, nunca anidadas** (`DESIGN.md` §Componentes): la del saldo y la del libro son dos
hijas del mismo contenedor. `SaldoTiendaCard` **no** se mete dentro de la del libro.

### 3.2 `SaldoTiendaCard` no se toca por dentro

Decisión explícita: la tarjeta del saldo **conserva su árbol interno byte a byte**. Solo cambia el
ancho del envoltorio que la contiene, que vive en `MiWalletModule`.

Motivo medido: `tests/integration/mi-wallet-page.test.tsx` navega ese árbol con
`etiqueta.closest("div")` + `within(bloque).getByText(/^-?₡/)` (`:351-356`) y con
`screen.getByRole("region", { name: "Saldo a favor" })` (`:360`). Reestructurarla rompería seis
aserciones de la 172 sin que la ficha gane nada: esa tarjeta **ya es** una `Card` con cifra grande y
tres importes, que es justo lo que la 200 pide.

### 3.3 El aviso del tope NO lleva `role="note"`

`tests/integration/mi-wallet-page.test.tsx:466,476` hace `screen.getByRole("note")` **en singular**.
Hoy hay exactamente uno (el aviso de la 172 en `SaldoTiendaCard.tsx:121`). El texto de R30 se pinta
como párrafo normal (`<p className="text-xs text-muted-foreground">`), sin `role="note"`, para que
esas aserciones sigan verdes sin editarlas.

### 3.4 Sin controles de escritura

`/wallet` tiene una barra de acciones arriba (`RegistrarMovimientoCajaDialog`). `/mi-wallet` **no la
tiene y no la gana** (R17): esta pantalla es de solo lectura y el rediseño no puede ser la puerta por
la que entre un botón que escriba.

---

## 4. Frontend — el selector de cierre

### 4.1 Cadena de props (nada de fetch en el cliente)

```
page.tsx (Server Component)
  Promise.all([ verMiSaldoAction(), listarMisMovimientosAction({}), listarMisCierresAction() ])
     │
     └─ <MiWalletModule ... cierres={CierresDeLaTienda} />
            └─ <MiWalletFiltros ... cierres={CierresDeLaTienda} />
```

```ts
export interface CierresDeLaTienda {
  opciones: CierreTiendaOpcionDTO[];
  hayMas: boolean;
  /** `false` cuando la lectura NO respondio ok: el selector se deshabilita y lo dice (R29). */
  disponible: boolean;
}
```

La prop es **requerida y sin default** en los dos eslabones, igual que `ahoraIso` en `WalletModule`
(`:96-100`): la inyección la garantiza el compilador, no la buena voluntad de quien monte el módulo
mañana. Es la lección de «el composition root que no inyecta».

**Una sola lectura, en la carga.** La lista de cierres es el catálogo del libro de la tienda: no
depende de los filtros vigentes, así que `recargar()` **no** la vuelve a pedir. Precio: si entra un
cierre nuevo mientras la pantalla está abierta, no aparece hasta recargar la ruta. Aceptado y
declarado.

### 4.2 Degradación, no `notFound()` (R29)

`page.tsx` conserva **intacto** su contrato actual: si `verMiSaldoAction` o
`listarMisMovimientosAction` no responden `ok`, `notFound()` (`page.tsx:38-40`). La lectura de
cierres se trata **aparte**:

```ts
const cierres: CierresDeLaTienda =
  cierresResult.status === "ok"
    ? { opciones: cierresResult.cierres, hayMas: cierresResult.hayMas, disponible: true }
    : { opciones: [], hayMas: false, disponible: false };
```

Razón: el saldo y el libro **son** la pantalla; el filtro es una comodidad. Que se caiga un filtro no
puede esconderle a la tienda su dinero. (Y con el mismo guard de rol en los tres caminos, un
`forbidden` aquí y un `ok` allá es un estado que no debería existir: si ocurre, se degrada, no se
oculta.)

### 4.3 Etiquetado de las opciones — módulo puro nuevo

Archivo nuevo `app/(app)/mi-wallet/_components/mi-wallet-cierres.ts` (sin React, colocado junto a su
única pantalla, `docs/architecture.md` §«sin sobre-ingeniería»):

```ts
export const CIERRE_TODOS_OPTION = { value: "", label: "Todos los cierres" };
export function opcionesDeCierre(cierres: readonly CierreTiendaOpcionDTO[]): SelectOption[];
```

Regla de etiqueta:

1. base = `Cierre del ${fechaDiaISO(fecha)} · ${n} movimiento(s)` — `fechaDiaISO`
   (`lib/utils/fecha-dia-iso.ts`) es **la misma función** que ya usa la descarga, y produce el mismo
   día que la columna «Fecha» de la tabla (`DesgloseTiendaLedger.tsx:38` hace `slice(0,10)`).
   Cuidado con la trampa horaria: los dos son el **día UTC**; usar `fechaCalendarioCR` aquí haría que
   la opción dijera un día y las filas otro.
2. Si una etiqueta base sale **repetida** en la lista, a **todas** sus instancias se les añade la hora
   (`fecha.slice(11, 16)`, sin parsear a `Date`): `Cierre del 2026-07-12 14:30 · 4 movimientos`
   (R24). Se añade solo donde hace falta, para no meter ruido en el caso común.
   El colapso al minuto queda declarado como límite: los `value` siguen siendo distintos, así que el
   filtro funciona igual; lo que se pierde es poder distinguirlas de un vistazo.

**Por qué NO va en `mi-wallet-labels.ts`:** ese módulo lo **reexporta entero** a `/wallet/tiendas`
(`desglose-tienda-labels.ts:20-27`). Meter ahí las opciones del selector se las regalaría a una
pantalla que no las usa, y `CATEGORIA_TIENDA_OPTIONS` ya está en esa lista de reexports — un
precedente que no conviene ampliar.

### 4.4 El control

`components/ui/select.tsx` (`Select`, sobre Base UI): `value=""` significa «sin selección», y ya hay
precedente de una opción con `value: ""` como «todos» (`CATEGORIA_TIENDA_OPTIONS`,
`mi-wallet-labels.ts:102-108`). El selector de cierre lo imita: primera opción «Todos los cierres»,
`placeholder` con el mismo texto, `aria-label="Filtrar por cierre"`, rótulo `sr-only` con `htmlFor`
que **sí** apunta a un `id` real del trigger (el defecto que `WalletFiltros.tsx:70-75` documenta
haber arreglado en `/wallet`).

`disabled` del selector = `disabled || opciones.length === 0`. Debajo, un texto corto:

- sin cierres y `disponible` → «Todavía no hay cierres en tu wallet.» (R28)
- `disponible === false` → «No pudimos cargar tus cierres. Probá recargando la página.» (R29)
- `hayMas` → «Mostramos los cierres más recientes.» (R30)

Voseo, sin siglas, sin nombres internos (R20).

---

## 5. La puerta — ítem de menú y gate, leyendo LA MISMA constante

`lib/auth/menu-visibility.ts` gana:

```ts
/**
 * Ficha 335 (R33) — unico punto de verdad de quien ACCEDE a `/mi-wallet`. Lo leen el `roles`
 * del item de menu (abajo) y el gate `notFound()` de `app/(app)/mi-wallet/page.tsx`.
 * Precedente: R10 de la 129 (analitica) y R1 de la 321 (historico).
 */
export const ROLES_MI_WALLET = ["adminTienda"] as const satisfies readonly RolValue[];
```

Ítem, **después** del ítem «Wallet» de maestro/admin:

```ts
{ label: "Mi wallet", href: "/mi-wallet", iconKey: "wallet", roles: ROLES_MI_WALLET }
```

`page.tsx` sustituye su literal por la constante, con el mismo ensanchado de tipo puntual que hace
`historico/conversaciones/page.tsx:60-66`:

```ts
const rolesConAcceso: readonly RolValue[] = ROLES_MI_WALLET;
if (!actor || !rolesConAcceso.includes(actor.rol)) notFound();
```

### 5.1 La posición del ítem NO es decorativa

`primerDestino(itemsVisibles(...))` (`menu-visibility.ts:497-501`) devuelve el `href` del primer ítem
visible no marcado `destinoInicial: false`, y `/dashboard` redirige ahí. Para `adminTienda` los
ítems visibles hoy son, en orden: «Analítica» (marcado `destinoInicial: false`), «Órdenes»,
«Novedades» → aterriza en `/ordenes`.

**Si «Mi wallet» se pusiera antes de «Órdenes», el aterrizaje del `adminTienda` cambiaría en
silencio.** Es el incidente que ya documentan «Analítica» (133) y «Monitoreo» (192). Poniéndolo
después, R35 se cumple por posición y **no hace falta** `destinoInicial: false` — y no se pone,
porque `tests/unit/auth/destino-post-login.test.ts:113-118` afirma con un `toEqual` que los ítems
marcados son EXACTAMENTE `["/analitica", "/monitoreo"]`.

### 5.2 `middleware.ts` no se toca (R36)

`/mi-wallet` vive bajo `app/(app)/` y ya es privada por defecto. Añadirla a `PUBLIC_ROUTES` la
abriría a cualquiera; añadirla a cualquiera de las tres listas pondría **roja**
`tests/unit/guards/rastreo-sin-ruta-nueva.guardia.test.ts:76-82`, que las compara posicionalmente
contra literales firmados. Ese test queda como la **evidencia ejecutable de R36** y debe seguir verde
**sin editarlo**.

---

## 6. Contratos literales que hay que tocar A MANO (y los que NO)

### 6.1 Se actualizan a mano, con criterio humano

| Archivo | Qué cambia | Por qué |
| --- | --- | --- |
| `tests/unit/auth/menu-visibility.test.ts:186` | `toEqual(["Analítica","Órdenes","Novedades"])` → `+ "Mi wallet"` | la lista se compara por igualdad a propósito |
| `tests/unit/guards/pwa-manifiesto-atajos.guardia.test.ts:182-188` | `adminTienda: 3` → `4` | cuenta destinos navegables por rol; el ítem nuevo suma uno |
| `tests/integration/mi-wallet-page.test.tsx:32-37` | añadir `listarMisCierresAction: vi.fn()` al `vi.mock` y sembrarla en `beforeEach` | el `vi.mock` es una fábrica cerrada; sin la clave, el import de `page.tsx` revienta (ya pasó con `listarMisMovimientosCompletoAction`, `:29-31`) |
| los **7 dobles** anotados `: IWalletTiendaMovimientoRepository` | añadir `listarCierresDeTienda` | el typecheck los caza; son ruidosos, no silenciosos |

Los 7: `tests/unit/services/{caja-cadena-pago-anulacion,liquidacion-anulacion,liquidacion-service,wallet-tienda-service,wallet-tienda-descarga,wallet-tienda-desglose,saldos-tiendas-*}.test.ts` y
`tests/unit/repositories/{cierres-admin-repository,cierres-admin-confirmacion-fisica,cierres-admin-anclaje-devolucion,CierresAdminRepository.resolverCierre.devolucion}.test.ts`
— la lista exacta la da `pnpm typecheck` tras el cambio de interfaz; `tasks.md` lo pone como criterio
de hecho.

### 6.2 NO se tocan — son la evidencia

Si alguno de estos se pone rojo, **la implementación está mal, no el test**. Editarlos es motivo de
parada y consulta:

- `tests/unit/descarga/wallet-tienda-descarga-columnas.test.ts` — el `toEqual` literal de las cinco
  columnas y sus encabezados **es** el contrato de la descarga (R18). No se sustituye por una
  derivación de `COLUMNAS_DESCARGA_MI_WALLET`: eso lo dejaría siempre verde.
- `tests/unit/components/desglose-tienda-labels.test.ts` — identidad (`toBe`) de los seis símbolos
  que `/wallet/tiendas` reexporta de `/mi-wallet` (R21).
- `tests/unit/guards/caja-173-alcance.guardia.test.ts:619-643` — **ningún** archivo de
  `app/(app)/mi-wallet/_components` puede nombrar `CajaResumenCard`, `verResumenCajaAction`,
  `CajaResumenDTO`, `derivarCaja`, `ingreso_cod_recaudado`, `ingreso_reverso_pago_tienda` ni
  «Ganancia de Ordenex».
- `tests/unit/services/mi-wallet-desglose.test.ts:165-194` — `page.tsx`, `MiWalletModule.tsx` y
  `SaldoTiendaCard.tsx` no pueden contener el literal de ninguna categoría del ledger ni
  `CUBETA_POR_CATEGORIA`.
- `tests/unit/guards/liquidacion-money-safe.test.ts` — barre `Number(`/`parseFloat(`/`parseInt(` en
  `WalletTiendaService.ts`, `WalletTiendaMovimientoRepository.ts`,
  `IWalletTiendaMovimientoRepository.ts`, `IWalletTiendaService.ts`, `MiWalletModule.tsx`,
  `SaldoTiendaCard.tsx`, `mi-wallet-labels.ts` y `page.tsx` — todos ellos tocados por esta ficha.
- `tests/unit/auth/destino-post-login.test.ts` y `tests/unit/auth/menu-historico.test.ts:97-104` —
  el aterrizaje de los cinco roles (R35).
- `tests/unit/guards/rastreo-sin-ruta-nueva.guardia.test.ts` — las tres listas del middleware (R36).
- `tests/unit/guards/superficie-de-uso.guardia.test.ts` — la action nueva y el módulo nuevo tienen
  que quedar **alcanzables** desde `page.tsx`; un componente montado pero con su handler sin llamar
  también cae aquí (capa R-C).

### 6.3 Consumidores externos de `/mi-wallet/_components` (censo)

Enumerados porque la ficha toca esa carpeta:

1. `app/(app)/wallet/tiendas/_components/SaldosTiendasTable.tsx:17` → `money`.
2. `app/(app)/wallet/tiendas/_components/desglose-tienda-labels.ts:20-27` → reexporta
   `CATEGORIA_TIENDA_LABEL`, `CATEGORIA_TIENDA_OPTIONS`, `ORIGEN_TIENDA_LABEL`,
   `TIPO_TIENDA_LABEL`, `money`, `origenLabel`.
3. `tests/unit/descarga/censo-tablas.ts:189` → declara `DesgloseTiendaLedger.tsx` como tabla «con
   descarga»; el componente conserva nombre, ruta y `descarga`.
4. `tests/unit/guards/{liquidacion-money-safe,caja-173-alcance}.test.ts` → censan la carpeta.

Regla derivada: **`mi-wallet-labels.ts` no pierde ni renombra ninguno de sus seis exports**, y lo
nuevo del selector vive en un módulo aparte (§4.3).

### 6.4 Coordinación con la ficha 336

`caja-173-alcance.guardia.test.ts:547-551` lista `app/(app)/mis-pagos/_components` entre las
«pantallas congeladas» y exige `componentes.length > 12`. La 336 borra `/mis-pagos`. Las dos fichas
tocan ese archivo de guardia: **no deben ir en paralelo sin avisar** (`AGENTS.md` §Paralelismo).

---

## 7. Alternativas descartadas

**A1 — Listar `cierre_dia` filtrando por `cierre_detail.tienda_id`.** Es «la lista de cierres de la
tienda» leída del dominio de cierres. **Descartada por tres razones concretas:** (a) `cierre_dia` no
tiene `tienda_id` (`db/schema.prisma:1226`), así que haría falta un join contra `cierre_detail`, que
es una fila **por orden** y no por tienda — mucho más grande que el libro; (b) ofrecería cierres que
**no produjeron ningún movimiento** para esa tienda (todos los conceptos en 0.00, o el interruptor
`TIENDA_DEBITA_FLETE_DEVOLUCION` en `false`), es decir opciones que al aplicarse devuelven una tabla
vacía; (c) abre al `adminTienda` una lectura del dominio de cierres, cuyos guards hoy son de
admin/bodega — justo lo que la ficha dice no tocar. **La elegida (§2.2) sale del propio libro**, así
que el alcance ya está acotado por construcción y toda opción rinde al menos una fila.

**A2 — Derivar las opciones en el cliente, de los movimientos ya pintados.** Coste cero de backend.
**Descartada porque es circular:** el cliente tiene UNA página (20 filas, `pageSize` por defecto), y
el filtro existe precisamente para alcanzar lo que **no** está en pantalla. Ofrecería como opciones
justo los cierres que ya se están viendo.

**A3 — Un repositorio/servicio nuevo solo para esta lectura.** Evitaría tocar
`IWalletTiendaMovimientoRepository` y con ello los 7 dobles anotados (§6.1). **Descartada:** habría
**dos** sitios donde escribir `tienda_id` en el `WHERE` del mismo libro, que es exactamente la
duplicación contra la que argumentan los comentarios de este módulo (`WalletTiendaService.ts:130-147`).
El coste que evita —romper 7 dobles— lo detecta el **typecheck**: es ruido, no un fallo mudo, y este
repo prefiere lo ruidoso.

**A4 — Reutilizar los componentes de `/wallet` (`CajaResumenCard`, su tarjeta, sus rótulos).** Sería
la lectura literal de «adopta la presentación de `/wallet`». **Descartada por dos motivos, uno
mecánico y uno de producto:** (a) `tests/unit/guards/caja-173-alcance.guardia.test.ts:619-643`
prohíbe que un archivo de `app/(app)/mi-wallet/_components` nombre `CajaResumenCard` o
`verResumenCajaAction` — es una guardia **viva**, no una recomendación; (b) las dos tarjetas cuentan
cosas distintas: una es la caja de Ordenex partida en dos bolsillos, la otra el saldo a favor de
**una** tienda. Lo que se adopta es la **gramática** (Card / header con título / banda de filtros /
footer con paginación), no las piezas.

**A5 — Poner «Mi wallet» arriba, o colgarlo del ítem «Wallet» como subítem.** **Descartada:** el
ítem «Wallet» es de `maestro`/`admin` y los subítems heredan los roles del padre — el `adminTienda`
no lo vería, o habría que ensanchar «Wallet» a la tienda y regalarle la caja de Ordenex. Y ponerlo
antes de «Órdenes» le cambia el aterrizaje post-login **en silencio** (§5.1).

**A6 — Buscador de texto por fecha en vez de selector.** «Escribí una fecha» en lugar de «elegí un
cierre». **Descartada:** necesita exactamente la misma lectura nueva del backend para poder resolver
la fecha a un `cierre_dia.id`, y reintroduce la ambigüedad que R24 tiene que resolver igualmente
(varios cierres el mismo día, uno por mensajero).

**A7 — Mostrar el importe del cierre en cada opción** («Cierre del 2026-07-12 · ₡48.800»). Sería
informativo. **Descartada:** obliga a un `_sum` por grupo, mete **dinero** en un control que hoy no
tiene ninguna prueba money-safe, y el importe del cierre ya se ve al aplicarlo (la cabecera refleja
el conjunto filtrado, R22 de la 43). El cardinal de movimientos da la señal de «cuánto hay aquí» sin
tocar un céntimo.

---

## 8. Riesgos

| Riesgo | Mitigación |
| --- | --- |
| El `groupBy` con `orderBy` sobre `_max` no lo admite el ORM en esta versión | §2.2 fija la desviación permitida y dónde declararla; el gate lo detecta en el test de repositorio |
| El rediseño rompe las 6 aserciones de la 172 sobre la cabecera | §3.2: `SaldoTiendaCard` no se toca por dentro |
| Un `role="note"` nuevo rompe `getByRole("note")` en singular | §3.3: el aviso del tope no lleva ese rol |
| Añadir el ítem mueve el aterrizaje del `adminTienda` | §5.1: posición después de «Órdenes» + el test literal existente como red |
| El barrido money-safe de la 172 cae por un `parseInt` en el código nuevo | §2.6: la config no está censada; el DTO nuevo no lleva importes (R9) |
| Colisión de archivos con la ficha 336 | §6.4 |
