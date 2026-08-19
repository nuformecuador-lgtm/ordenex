# Feature 231 — Wallet · la caja partida en dos bolsillos · design.md

> El CÓMO técnico. Decisiones tomadas antes de escribir código, con **las alternativas descartadas y
> su porqué**. El QUÉ está en `requirements.md`; el encargo de diseño aprobado, en
> `progress/design_231.md`.
>
> Resumen de una línea: **no se toca ni un dato ni un permiso; se añaden cuatro derivaciones al
> servidor y se reordena la pantalla alrededor de ellas.**

---

## 0. Lo que NO cambia (y por eso no aparece más abajo)

- **Sin migración**: ni tabla, ni columna, ni valor de enum, ni RLS nueva. El libro
  (`wallet_movimiento`) se lee, no se escribe (R37).
- **Sin ruta nueva**: `/wallet` sigue siendo la única pantalla, Server Component con pre-fetch y
  props (`app/(app)/wallet/page.tsx`).
- **Sin cambio de permisos**: `esAccesoTotal` en el mismo sitio y en el mismo orden (antes de tocar
  la base). Fuera de alcance por encargo.
- **Sin fórmulas nuevas de dinero**: flete, comisión, IVA y pago al mensajero no se rozan. Las
  derivaciones nuevas son **sumas por cubeta y una división**, sobre importes ya calculados.

---

## 1. Modelo de datos

**Ninguno.** No hay migración. Todo lo que esta feature necesita ya está en `wallet_movimiento` y se
obtiene del `groupBy(categoria, tipo) + SUM(monto)` que la 173 dejó montado
(`WalletMovimientoRepository.agregarPorCategoriaYTipo`). El índice que ese `groupBy` usa ya existe.

**Por qué no se almacena la proporción:** sería un saldo derivado guardado, exactamente lo que la 173
rechazó por escrito para las dos cifras. Se deriva por consulta, con los filtros vigentes.

---

## 2. Contratos I/O

### 2.1 `CajaResumenDTO` — dos campos nuevos, los dos STRING

```ts
export type CajaResumenDTO = {
  // …los diez campos actuales, intactos…
  /** Porción de las TIENDAS sobre el total de la caja, "0.00"–"100.00" (R9/R10). */
  porcentajeTiendas: string;
  /** Qué forma admite la barra (R14). Nunca lo decide la pantalla. */
  modoComposicion: "dos_bolsillos" | "solo_tiendas" | "solo_ordenex" | "sin_reparto";
};
```

Los dos son **STRING planos** a propósito (D3): `tests/integration/wallet-page.test.tsx:266-272`
barre `Object.entries(props.resumen)` exigiendo STRING en todo salvo `periodoFiltrado`. Un booleano o
un objeto anidado obligarían a ampliar la lista de excepciones de esa aserción, que es de la 173.

### 2.2 `ComposicionGananciaDTO` — nuevo, hermano de `CajaResumenDTO`

```ts
/** Las categorías de ingreso PROPIO del catálogo (las 6 del feed + el ajuste). */
export const WALLET_INGRESO_PROPIO_SEED = [...] as const;   // 7 valores
export type WalletIngresoPropio = (typeof WALLET_INGRESO_PROPIO_SEED)[number];

export type ComposicionGananciaDTO = {
  /** Un importe por categoría de ingreso propio. Record TOTAL: no admite huecos (R23). */
  ingresos: Record<WalletIngresoPropio, string>;
  /** Σ ingresos: idéntico, importe a importe, a `CajaResumenDTO.ingresosPropios` (R23). */
  totalIngresos: string;
  /** Egresos propios que `DesgloseEgresosDTO` no cubre: pago a mensajero, gasto, ajuste (R26). */
  otrosEgresos: string;
  /** Σ egresos propios: idéntico a `CajaResumenDTO.egresosPropios` (R26). */
  totalEgresos: string;
};
```

**Va FUERA de `CajaResumenDTO`** (no anidado dentro) por lo dicho en §2.1, y **viaja junto a él** en
el mismo resultado de servicio, no en una acción aparte (§3.2).

### 2.3 `WalletMovimientoDTO` — un campo nuevo

```ts
export type WalletMovimientoDTO = {
  // …los nueve campos actuales, intactos…
  /** De quién es este dinero, derivado en el SERVIDOR de la categoría (R31/R32). */
  dueno: NaturalezaMovimiento; // "propio" | "terceros"
};
```

### 2.4 Borde (Server Action) — la forma del resultado

```ts
export type VerResumenCajaServiceResult =
  | { status: "ok"; resumen: CajaResumenDTO; composicion: ComposicionGananciaDTO }
  | { status: "forbidden" };                     // sigue viajando SIN cifras (R30)
```

`verResumenCajaAction` no cambia de firma, de schema de entrada ni de traducción de errores: sigue
validando con `listarMovimientosSchema` (los mismos filtros que el listado) y delegando en el
servicio. **Ninguna acción nueva.**

---

## 3. Dónde vive cada derivación (y las guardias que lo obligan)

### 3.1 `lib/utils/caja-tesoreria.ts` — función pura, se amplía con cuidado quirúrgico

Este módulo está vigilado por dos guardias de la 173 que hay que respetar al pie de la letra:

| Guardia | Qué exige | Consecuencia para esta feature |
| --- | --- | --- |
| `caja-derivaciones.guardia.test.ts:127-128` | **exactamente 3** llamadas a `derivarBalance(` | las derivaciones nuevas **no** pueden llamarla: son sumas y una división, no restas con signo |
| `caja-derivaciones.guardia.test.ts:131-141` | ni `"positivo"`/`"negativo"`/`"cero"` literales, ni `.sub(`, ni `.minus(` | el modo se decide comparando **Decimales** (`.lt(0)`, `.gt(0)`, `.isZero()`), **nunca** leyendo `signo` |
| `caja-173-alcance.guardia.test.ts:157-163` | el módulo no nombra `PrismaClient`, `Repository`, `findMany`, `groupBy`, `await` | las funciones nuevas siguen siendo **puras** |
| `caja-173-alcance.guardia.test.ts:490-497` | ningún módulo de la 173 nombra `comisionCod`, `ivaFlete`, `valorFlete`… | el desglose se teclea **por categoría** (`ingreso_comision_cod`), no con claves camelCase de fórmula |

Se añaden:

- `derivarCaja(filas, opciones)` → gana `porcentajeTiendas` y `modoComposicion` **sin cambiar su
  firma ni el resto de su salida** (para no romper `caja-derivaciones.guardia.test.ts:143-165`, que
  compara `caja.enCaja`/`caja.ganancia` contra `derivarBalance`).
- `derivarComposicionGanancia(filas)` → nueva función pura, misma entrada `AgregadoCajaRow[]`.

**El algoritmo del modo, en el orden en que se evalúa** (T = `deTerceros`, G = `ganancia`, como
Decimales; recuérdese la identidad `enCaja = G + T`):

| # | Condición | `modoComposicion` | `porcentajeTiendas` |
| --- | --- | --- | --- |
| 1 | `G < 0` y `T > 0` | `solo_tiendas` | `"100.00"` |
| 2 | `T < 0` y `G > 0` | `solo_ordenex` | `"0.00"` |
| 3 | `T <= 0` y `G <= 0` | `sin_reparto` | `"0.00"` |
| 4 | resto (`T >= 0`, `G >= 0`, `enCaja > 0`) | `dos_bolsillos` | `T / enCaja × 100`, 2 dec. |

La tabla es **total** (los nueve pares de signos posibles caen en exactamente una fila) y la división
**solo** ocurre en la fila 4, donde `enCaja > 0` está garantizado: no hay división por cero que
atrapar. Redondeo `ROUND_HALF_UP` a 2 decimales, el mismo criterio que el resto del dinero del repo.

### 3.2 `WalletService.verResumenCaja` — una lectura, dos derivaciones

```
verResumenCaja(input, actor)
  ├─ esAccesoTotal(actor.rol)          ← igual que hoy, ANTES de tocar la base
  ├─ construirFiltros(input)           ← el MISMO método que el listado y la descarga
  ├─ repo.agregarPorCategoriaYTipo()   ← UNA sola lectura (sin cambios en el repo)
  └─ { resumen: derivarCaja(filas, …), composicion: derivarComposicionGanancia(filas) }
```

**El mismo array de filas alimenta las dos derivaciones.** Eso es lo que garantiza R24: la tarjeta de
la ganancia y la cifra de la caja hablan del **mismo instante y del mismo conjunto**, y no pueden
discrepar aunque alguien registre un movimiento entre dos peticiones.

### 3.3 `WalletMovimientoRepository.toDTO` — el dueño, en el único punto de proyección

`dueno` se asigna en `toDTO` (la función por la que pasan `listar`, `listarCompleto` y
`obtenerPorId`), leyendo `NATURALEZA_POR_CATEGORIA`. Es **una** línea en **un** sitio: la tabla, la
descarga y cualquier consumidor futuro dicen lo mismo por construcción (R31/R34).

> **Desviación consciente de `docs/architecture.md`** («el repositorio no lleva lógica de negocio»):
> lo que se añade no es una regla, es una **búsqueda total en un `Record` ya existente** durante la
> proyección a DTO, que es justo lo que `toDTO` hace con los demás campos. La alternativa —mapear en
> el servicio— se descarta en §6.2.

---

## 4. Pantalla: componentes y estructura del DOM

```
app/(app)/wallet/_components/
  CajaResumenCard.tsx          ← REDISEÑADO (mismo nombre y misma ruta: la suite de la 173 la barre)
  BarraComposicionCaja.tsx     ← NUEVO (la barra + sus cuatro modos)
  ComposicionGananciaCard.tsx  ← NUEVO (la tarjeta de la ganancia)
  DesgloseEgresosLista.tsx     ← NUEVO por EXTRACCIÓN del `<dl>` de DesgloseEgresosCard (D2)
  wallet-labels.ts             ← + rótulos de la barra, del caso límite y del dueño
  WalletLedger.tsx             ← + columna «Dueño»
  wallet-ledger-descarga-columnas.ts ← + columna «Dueño» en el archivo
  WalletModule.tsx             ← cablea la composición y recoloca las tarjetas
```

### 4.1 El DOM de `CajaResumenCard`, y por qué exactamente así

Las cuatro aserciones vivas de la 173 (`tests/components/CajaResumenCard.test.tsx`) no se debilitan;
el árbol se diseña para satisfacerlas **sin editarlas**:

```
<Card>
  <CardContent>
    <div>                               ← «columna» de la caja: padre de la región (líneas 99-113)
      <section aria-label="Dinero en caja">   cifra grande + signo
      <div>  Entró · Salió · Movimientos </div>          (R6, datos secundarios)
    </div>

    <BarraComposicionCaja … />          ← R2, sin controles

    <div>                               ← los dos bolsillos, hermanos
      <section aria-label="Contra-entrega cobrado y aún no entregado a las tiendas">
          importe · aviso · enlace a /wallet/tiendas        (R3/R4, banda de aviso)
      <div>                             ← «columna» de Ordenex: padre de la región (líneas 114-125)
        <section aria-label="Ganancia de Ordenex">  importe + signo
        <div> Ingresos de Ordenex · Gastos de Ordenex </div>
      </div>
    </div>

    <p role="note"> nota de la diferencia </p>
    { periodoFiltrado ? <p role="note"> aviso del periodo </p> : null }
  </CardContent>
</Card>
```

Tres detalles que **no** son estéticos:

1. Las dos regiones son **disjuntas**: la de «Dinero en caja» no envuelve a la de «Ganancia de
   Ordenex» (si la envolviera, `within(enCaja).queryByText("₡2.000,00")` dejaría de ser `null`).
2. Cada región tiene un **padre acotado** que contiene su propio desglose y no el del vecino: el
   caso de las líneas 99-126 busca por `parentElement` y usa `getByText`, que **revienta con dos
   coincidencias** —y en el fixture de la 173 `salidas` y `egresosPropios` valen los dos `3000.00`—.
3. `ingresosPropios` y `egresosPropios` **siguen en la tarjeta**, como explicación del bolsillo de
   Ordenex. La tarjeta nueva los abre concepto por concepto; no se los lleva.
4. Cero elementos interactivos (R8): la barra no es un `Progress` de Radix ni lleva tooltip.

### 4.2 La barra

- Contenedor con `overflow-hidden rounded-full` y dos hijos: el de tiendas con
  `style={{ width: \`${porcentajeTiendas}%\` }}` y el de Ordenex con `flex-1` (R11). **El segundo no
  lleva porcentaje**: ocupa el resto, así que un redondeo de céntimo no puede abrir un hueco ni
  desbordar la barra.
- Colores por token (R39): tiendas = `warning`, Ordenex = `muted`/superficie neutra en
  `dos_bolsillos`, `danger` en el bloque de Ordenex cuando el modo es `solo_tiendas`. Nada de hex.
- Accesibilidad (R13): `role="img"` + `aria-label` compuesto en `wallet-labels.ts` a partir de los
  rótulos y los importes STRING. Sin `Progress` de Radix (§6.1).
- Los cuatro modos se resuelven con un `Record<ModoComposicion, …>` TOTAL: un modo nuevo rompe el
  build de la pantalla.

### 4.3 La tarjeta de la ganancia

Dos columnas (`grid md:grid-cols-2`, apiladas en móvil) + pie:

| Izquierda (ingresos) | Derecha (egresos) | Pie |
| --- | --- | --- |
| 7 filas, orden declarado, `CATEGORIA_LABEL` (R25/R28) | 4 conceptos de `DesgloseEgresosDTO` + «Otros gastos de Ordenex» (D2) | `ganancia` + su signo (R27) |
| total = `totalIngresos` (= `ingresosPropios`) | total = `totalEgresos` (= `egresosPropios`) | |

Es una `Card` **hermana** de la de la caja, nunca anidada (`DESIGN.md`). Por eso la lista de egresos
se extrae a `DesgloseEgresosLista` (un `<dl>` sin `Card`) en vez de meter la tarjeta actual dentro.

### 4.4 El libro

Columna nueva, **la última de los datos** (antes de «Acciones») para no mover ninguna existente
(R35): `{ id: "dueno", value: "Dueño", minWidth: "8rem", render: … }`, punto de color (`size-2
rounded-full`, `bg-warning` / `bg-muted-foreground`) + texto (R33). En la descarga, misma clave y
mismo texto, añadida a `COLUMNAS_DESCARGA_WALLET_CAJA` **y** a `filaDescargaMovimientoCaja` en el
mismo commit — los dos tests que comparan `Object.keys(fila)` contra esa lista
(`WalletDescarga.test.tsx:572-574` y `:621-623`) siguen verdes solos.

---

## 5. Impacto en la suite existente (clasificado)

| Archivo | Qué le pasa | Clase |
| --- | --- | --- |
| `tests/unit/utils/caja-tesoreria.test.ts:194` | `toEqual` del caso vacío gana las dos claves nuevas | **actualización de forma** del test de la función que se amplía |
| `tests/integration/wallet-page.test.tsx` (fixtures `RESUMEN_OK`, `MOVIMIENTOS_OK`) | literales incompletos ⇒ error de tipo | **fixture mecánico** (ninguna aserción cambia; el barrido de STRING sigue intacto) |
| `tests/components/CajaResumenCard.test.tsx` (fixture `RESUMEN`) | ídem | **fixture mecánico**: sus 19 casos siguen palabra por palabra |
| `tests/components/descarga/WalletDescarga.test.tsx:590-597` | rojo al añadir «Dueño» | **cambio de aserción → D1, firma humana** |
| `tests/unit/components/wallet-desglose-egresos-card.test.tsx` | apunta al componente absorbido | **re-hospedaje declarado → D2** (las aserciones de la 45 y la 158 se conservan, no se borran) |
| `tests/unit/guards/caja-derivaciones.guardia.test.ts` · `caja-173-alcance.guardia.test.ts` | deben seguir **verdes sin editarse** | criterio de aceptación (§3.1) |
| `tests/unit/descarga/censo-tablas.ts` | sin cambios: esta feature **no monta ningún `DataTable` nuevo** | — |

---

## 6. Alternativas descartadas

### 6.1 Usar el `Progress` de shadcn/Radix para la barra — **descartada**

`components/ui/` no lo tiene y `npx shadcn add progress` lo traería, que es lo que manda
`docs/architecture.md` («nunca crees un componente si ya existe en shadcn/ui»). Se descarta por dos
razones concretas: (a) el `Progress` de Radix recibe `value: number`, así que alimentarlo exigiría
`Number(porcentajeTiendas)` **en el navegador** — la llamada que R12 y el barrido money-safe
prohíben, y que además pondría roja la propia guardia del componente; y (b) representa **una**
magnitud sobre un total, no una **composición de dos porciones** con cuatro modos degenerados. La
barra propia son doce líneas de JSX sin estado.

### 6.2 Derivar el dueño en el servicio, no en el repositorio — **descartada**

Respetaría al pie de la letra «el repositorio no lleva lógica». Pero el DTO se construye en `toDTO` y
lo consumen **cuatro** caminos (listado paginado, descarga completa, `obtenerPorId` y el egreso recién
creado de `WalletEgresoService`): mapear en el servicio significa repetir el `map` en cada uno y abrir
la puerta a que la tabla y el archivo digan cosas distintas — que es exactamente lo que el punto (c)
del encargo quiere impedir. Se elige el punto único de proyección y se documenta la desviación.

### 6.3 Una Server Action nueva `verComposicionGananciaAction` — **descartada**

Sería simétrica a `verDesgloseEgresosAction` y aislaría el cambio del borde existente. Se descarta
porque implicaría un **cuarto viaje** al servidor por cada cambio de filtro y, sobre todo, un
**segundo `groupBy` en otro instante**: la tarjeta podría enseñar unos ingresos que no suman la
ganancia que la tarjeta de al lado está mostrando. Las filas ya están en memoria; derivar dos veces
sobre el mismo array cuesta cero.

### 6.4 Calcular la proporción en el cliente — **descartada de raíz**

Es el motivo por el que existe la mitad de esta feature: dividir `deTerceros` entre `enCaja` en la UI
es convertir dos montos a número en el navegador (R64 de la 173). No es una preferencia de estilo.

### 6.5 Emitir los dos porcentajes (tiendas y Ordenex) — **descartada**

Redondeados por separado pueden sumar `99.99` o `100.01` y abrir un hilo blanco al final de la barra.
Con un solo porcentaje y el segundo segmento en `flex-1` el problema no existe.

### 6.6 Ampliar `DesgloseEgresosDTO` con los tres conceptos que le faltan — **descartada**

Cuadraría la columna sin campo nuevo, pero cambiaría el significado de un DTO que la 45 y la 158
definieron con un alcance escrito («no incluye los pagos a tiendas ni a mensajeros») y que su tarjeta
sigue mostrando. Se prefiere `otrosEgresos` en el DTO nuevo, que deja intacto lo que ya funciona.

---

## 7. Verificación

- Cada tanda cierra con `./init.sh --rapido`; **antes del PR, `./init.sh` completo, sin excepción**
  (`docs/verification.md`). Los subagentes corren solo `pnpm exec vitest related --run <sus archivos>`.
- Dos guardias tienen que quedar verdes **sin haber sido editadas**: `caja-derivaciones.guardia` y
  `caja-173-alcance.guardia`. Son la prueba de que la ampliación no abrió una segunda definición de
  ninguna cifra de dinero.
- La derivación nueva se prueba **por medición**, no por ausencia: para cada modo, un conjunto de
  filas con los signos que lo provocan y el porcentaje exacto esperado. Los conjuntos llevan importes
  **distintos entre sí** para que ninguna aserción pase por confundir dos cifras.

## 8. Coordinación con la feature 230 (no es una decisión, es un aviso)

La 230 («el dinero se pinta sin céntimos») toca `lib/config/moneda.ts` y `money()`, que es la función
con la que esta pantalla pinta **todos** sus importes. Las dos features chocan en los componentes de
wallet si corren a la vez (`feature_list.json`, ficha 231, §PARALELISMO). Esta feature **no toca
`money()` ni el formato**: se limita a pasarle STRINGs. Si la 230 entra antes, los importes de las
tarjetas nuevas cambian de aspecto solos y ninguna aserción de esta feature debería fijarse en los
céntimos de un importe formateado salvo donde ya lo hace la suite de la 173.
