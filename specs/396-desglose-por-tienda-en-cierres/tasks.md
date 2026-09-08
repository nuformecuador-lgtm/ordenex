# Ficha 396 — Tareas

> Checklist ejecutable. Cada task tiene **criterio de hecho** verificable. `[P]` = paralelizable
> con las de su misma tanda. Las tandas van **en orden**: A antes que B antes que C.
>
> **Regla del gate (AGENTS.md):** `backend_dev` / `frontend_dev` corren `pnpm typecheck`, `pnpm lint`
> y **sólo sus archivos** (`pnpm exec vitest related --run <archivos>`). `./init.sh --rapido` y el
> completo los corre **el leader**, nunca un subagente.

---

## T0 — Puerta. NO se escribe una línea de producción antes de esto

### T0.1 — La ficha 395 tiene que estar `done` y mergeada en `dev`

**BLOQUEANTE. Esta ficha CHOCA EN ARCHIVO con la 395**, que está `in_progress` ahora mismo sobre
los tres archivos que esta ficha también toca:

| Archivo | Qué hace la 395 ahí | Qué hace la 396 ahí |
|---|---|---|
| `lib/services/CierresAdminService.ts` | Añade `cobradoSobreRecaudado`, `netoOrdenex` y lo que el mensajero entrega al detalle | Añade `partesPorTienda` al mismo `verCierreDetalle` |
| `app/(app)/cierres-admin/_components/cierre-factura.tsx` | Monta `CascadaDinero` en el detalle del mensajero | Añade la marca de agregación y (según Q1) el desglose |
| `app/(app)/cierres-admin/_components/CierresAdminModule.tsx` | Pasa las líneas nuevas al detalle | Pasa el desglose al detalle |

**Van en secuencia, nunca a la vez.** Y el diseño **se apoya en lo que la 395 deje montado**
(`CascadaDinero` en el detalle del mensajero, §7.2 del `design.md`): **no se reinventa** ni se copia.

- [ ] **Hecho cuando:** la 395 está `done` en `feature_list.json`, su PR mergeado en `dev`, y la
      rama de esta ficha nace de un `origin/dev` que ya la contiene
      (`git log origin/dev --oneline | grep 395` devuelve el merge).
- [ ] **Hecho cuando:** se ha leído lo que la 395 dejó en `cierre-factura.tsx` y en
      `CierresAdminService.ts`, y se ha anotado en `progress/impl_396.md` **qué se reusa de ella**
      (líneas de cascada, rótulos, props) en vez de duplicarlo.

### T0.2 — Q1, Q2, Q5 y Q6 firmadas por el humano

`requirements.md § Preguntas abiertas`. **Q1 bloquea la tanda B, no la A** (`design.md §5`: el
contrato de servidor está cerrado sin esa respuesta).

- [ ] **Hecho cuando:** la respuesta a cada una está escrita en `progress/impl_396.md` con la fecha
      y las palabras del humano, no parafraseada.

### T0.3 — Confirmar en el archivo real los 11 puntos de `requirements.md § Lo confirmado`

El índice del MCP miente en las dos direcciones (devuelve símbolos borrados y no conoce símbolos
vivos), y **la 395 acaba de mover dos de esos archivos**.

- [ ] **Hecho cuando:** los 11 puntos están verificados a mano en disco. **Si alguno es falso,
      PARAR** y decírselo al humano antes de escribir nada.

---

## Tanda A — Servidor: el dato sube y se parte (`backend_dev`)

### A1 — `DETALLE_ADMIN_SELECT` lee `tienda_id`

`lib/repositories/CierresAdminRepository.ts:164-194`. Añadir `tiendaId: true` junto a
`tiendaNombre: true`.

- [ ] **Hecho cuando:** `pnpm typecheck` verde y el `select` proyecta la columna.
- [ ] **Hecho cuando:** no se ha tocado ninguna otra clave del `select` (el diff son 1 línea).

### A2 — `CierreGestionPendienteRow` gana `tiendaId: string` — depende de A1

`lib/interfaces/repositories/ICierreDiaRepository.ts:48-…`, campo **requerido** (no opcional:
`design.md §3`). Rellenarlo en los **tres** mappers:

| Mapper | Valor |
|---|---|
| `CierresAdminRepository.toPendienteRowDesdeSnapshot` (:373) | `d.tiendaId` (**congelado**, R6) |
| `CierresBodegaAdminRepository` (:323, reusa el mismo mapper) | idem |
| `CierreDiaRepository.toPendienteRow` (:247) | `row.orden.tiendaId` — vista EN VIVO, el cierre aún no existe |

- [ ] **Hecho cuando:** `pnpm typecheck` verde **sin un solo `as`, `any` ni `@ts-expect-error`**
      nuevo en los dobles de test.
- [ ] **Hecho cuando:** el docstring del campo dice **de dónde sale en cada caso y por qué**
      (congelado vs vivo), no sólo qué es.
- [ ] **Medir antes de empezar:** `pnpm typecheck` tras el cambio de tipo, para saber cuántos
      archivos hay que tocar (estimado: 20 tipan el DTO; hay fixture central en
      `tests/fixtures/cierre-pagos.ts`). Anotar el número real en `progress/impl_396.md`.

### A3 — `partesPorTienda` en `lib/utils/ingreso-ordenex.ts` — depende de A2

Firma y comportamiento en `design.md §4`. **Ni una fórmula de dinero nueva**: particiona por
`tiendaId` y llama a `computeTotales`, `totalesIngresoOrdenex` y `pagoTiendaOrdenex` sobre cada
subconjunto.

- [ ] **Hecho cuando:** la función es **pura** (sin Prisma Client, sin repos, sin reloj, sin
      efectos al importarse) y toda salida es STRING escala 2.
- [ ] **Hecho cuando:** no aparece `Number(`, `parseFloat(`, `parseInt(` ni `.toFixed(` sobre nada
      que no sea un `Prisma.Decimal`.
- [ ] **Hecho cuando:** el docstring explica **por qué vive ahí y no duplicada en cada servicio**,
      cita el precedente `dinero-por-producto.ts:200-273` y **escribe las dos invariantes**
      (R10, R11) con el argumento de por qué son ciertas por construcción.
- [ ] **Hecho cuando:** se ha comprobado que el import de `cierre-totales.ts` **no crea ciclo**
      (`cierre-totales.ts` no importa `ingreso-ordenex.ts`). Si lo creara: caer a
      `design.md §8.5` y anotarlo.
- [ ] **Hecho cuando:** el orden del array es el que decida Q6, declarado en **un solo sitio**.

### A4 — `verCierreDetalle` emite `partesPorTienda` — depende de A3

`lib/services/CierresAdminService.ts` (hoy :661-707, **verificar tras la 395**) y
`lib/interfaces/services/ICierresAdminService.ts:331-368`.

- [ ] **Hecho cuando:** el campo se emite **SIEMPRE**, también con una sola tienda
      (`design.md §5`).
- [ ] **Hecho cuando:** `pagoTienda`, `ganancia`, `totalesIngreso` y
      `desgloseIngresoBodegaRechazos` **no cambian ni una línea** (R17).
- [ ] **Hecho cuando:** el comentario del campo dice la invariante R10 en una frase.

### A5 `[P]` — Tests unitarios del derivador — depende de A3

`tests/unit/utils/` (archivo nuevo). **Afirmando contra literales escritos a mano**, nunca contra la
función que los genera.

- [ ] Un cierre de **dos tiendas** con importes distintos → dos partes, cada una con **sus** cuatro
      cifras, escritas a mano en el test (R5).
- [ ] Un cierre de **una tienda** → una parte, `pagoTienda` igual al agregado (R9).
- [ ] **R10**: la suma de las partes es **exactamente** el agregado. Literal, al céntimo.
- [ ] **R11**: la suma de `recaudado` es **exactamente** `computeTotales(todas).general`.
- [ ] **R12**: una gestión **no `entregada`** con líneas de pago **no aporta** al `recaudado` de su
      tienda (mismo criterio que el total general).
- [ ] Una tienda cuyo `pagoTienda` sale **negativo** se emite con su signo, sin recortar a `0.00`.
- [ ] Una gestión **sin tarifa congelada** (gap R9 de la 69) no rompe: su tienda aparece con los
      conceptos en cero, no ausente.
- [ ] **Hecho cuando:** las **mutaciones** de abajo (§ Mutaciones) ponen estos tests en rojo.

### A6 — Test de integración contra Postgres real — depende de A2

`tests/integration/db/` (archivo nuevo; precedente y vecinos: `cierre-detail-congelado.test.ts`,
`cierre-sin-gestion-sql-real.test.ts`).

**Los tests de servicio usan dobles y no ven el SQL.** El requisito de **qué filas se agrupan** (R6)
sólo se puede probar aquí.

- [ ] **Siembra** un cierre con órdenes de **dos tiendas distintas** y sus filas `cierre_detail`.
      No se apoya en datos que estén en la base local.
- [ ] **Control positivo obligatorio:** afirma primero el **cardinal** (2 tiendas, N gestiones) y
      **falla si es cero**. Prohibido `if (!filas) return;` — reporta `passed` sin comprobar nada.
- [ ] Afirma que la agrupación usa **`cierre_detail.tienda_id`** (el congelado) y **no**
      `orden.tienda_id`: re-apuntar la orden a otra tienda después de crear el cierre **no** cambia
      el desglose (R6).
- [ ] **Hecho cuando:** el test **no se salta** por falta de `.env`. Si la corrida lo reporta
      `skipped`, no está hecho — mirar los `skipped`, no sólo el `INIT_EXIT`.

---

## Tanda B — Pantalla (`frontend_dev`) — depende de la tanda A y de Q1

### B1 `[P]` — Constantes de texto nuevas

`app/(app)/cierres-admin/_components/cierre-detalle-shared.tsx`, junto a `PAGO_TIENDA_LABEL` (:324)
y `PAGO_TIENDA_NOTA` (:334). **Esas dos NO se tocan** (R17).

- [ ] **Hecho cuando:** ni un literal de texto queda escrito dentro del componente (R4).
- [ ] **Hecho cuando:** el texto no usa siglas ni jerga; lenguaje claro, en español.
- [ ] **Hecho cuando:** el texto de R16 dice explícitamente que **el pago al mensajero y el ingreso
      de bodega por rechazos son del cierre entero y no están repartidos**.

### B2 — La marca de agregación (R1-R4) — depende de B1

`cierre-factura.tsx:1810-1818`, **dentro** del corte `esMensajero` que ya existe (R21).

- [ ] **Hecho cuando:** con **una** tienda se ve **su nombre** (R2).
- [ ] **Hecho cuando:** con **dos o más** se ve que es un total agregado y **de cuántas** (R1, R3).
- [ ] **Hecho cuando:** el importe de la tarjeta **no cambia** (R17).

### B3 — El desglose por tienda (R5-R9) — depende de B2 y de Q1

Alcance **según la respuesta a Q1** (A / B / C / D de `requirements.md`). Si Q1 = **B** o **C**: una
`CascadaDinero` por tienda, con `ariaLabel` **propio y distinto** por tienda.

- [ ] **Hecho cuando:** se reusa `CascadaDinero` tal cual — **ni una copia, ni un componente
      gemelo**.
- [ ] **Hecho cuando:** el componente **no hace ni una operación aritmética**: no aparece `Number(`,
      `parseFloat(`, `parseInt(` ni `.toFixed(` sobre un importe (R13).
- [ ] **Hecho cuando:** las tiendas se pintan en el orden que emite el servidor, sin reordenar en el
      cliente (R8).

### B4 `[P]` — Tests de componente — depende de B2/B3

`tests/components/` (archivo nuevo).

- [ ] Un cierre de **dos** tiendas: los dos nombres y los dos importes están en el DOM, **afirmados
      contra literales escritos a mano** (R5).
- [ ] Un cierre de **una** tienda: el nombre está y la lectura **no es más larga** que hoy (R2, R9).
- [ ] La marca de «total de varias tiendas» aparece con 2 y **no** aparece con 1 (R1, R3).
- [ ] La nota de R16 está presente siempre que se pinte el desglose.
- [ ] **Vista del mensajero** (`audiencia="mensajero"`): **ni el agregado ni el desglose** aparecen
      (R21).

---

## Tanda C — Cierre (`backend_dev` + `frontend_dev`, luego leader)

### C1 `[P]` — No regresión de las descargas (R22)

- [ ] **Hecho cuando:** `tests/unit/descarga/cierres-gestiones-fundida-descarga-columnas.test.ts`,
      `cierres-admin-descarga-columnas` y `cierres-gestiones-paridad` pasan **sin tocarlos**.
- [ ] **Hecho cuando:** el diff no contiene ninguno de los archivos de `*descarga-columnas*`.

### C2 `[P]` — No regresión de las identidades ya pintadas

- [ ] **Hecho cuando:** `tests/components/DineroIdentidadesEnPantalla.test.tsx` pasa sin
      modificarse (bloques 393·B4 y 393·B5, y el censo D).

### C3 — Mutaciones (§ Mutaciones) — depende de A5, A6, B4

- [ ] **Hecho cuando:** cada mutación de la lista ha puesto **al menos un test en rojo**, con el
      nombre del test anotado en `progress/impl_396.md`.
- [ ] **Hecho cuando:** la salida de cada corrida está pegada en `progress/impl_396.md`. Un arnés de
      mutaciones que dice «9/9 supervivientes» sin haber ejecutado un test ya mintió dos veces en
      este repo: **la evidencia es la salida, no el resumen**.

### C4 — `progress/impl_396.md` — depende de todas

- [ ] Archivos tocados, mapa `R<n> → test`, salida de los tests, las respuestas de Q1/Q2/Q5/Q6, el
      número real de archivos de test tocados por A2, y **cualquier cosa que al mirar el código
      resultara distinta de lo escrito aquí**.
- [ ] **COMMITEADO.** El informe describe el disco, no un commit; en este repo se ha perdido tres
      veces por un `git checkout`.

### C5 — Gate (lo corre **el leader**, no un subagente)

- [ ] `./init.sh --rapido` verde al cerrar cada tanda.
- [ ] `./init.sh` **completo** antes del PR. Escribir `INIT_EXIT=$?` **dentro** del log: un `echo`
      posterior ya tapó un gate rojo como «exit code 0».
- [ ] Mirar los **`skipped`**, no sólo el `INIT_EXIT`: sin `.env` se saltan los 78 archivos de
      `integration/db` y aun así dice «init OK» — y A6 vive justo ahí.

---

## Mutaciones (C3) — cada una tiene que poner algo en rojo

| # | Mutación | Debe romper |
|---|---|---|
| M1 | Agrupar por `tiendaNombre` en vez de por `tiendaId` | A6 (dos tiendas con el mismo nombre / re-apuntada) |
| M2 | Leer la tienda **viva** de la orden en vez de la congelada | A6 (R6) |
| M3 | Quitar el filtro `resultado === "entregada"` del recaudo por tienda | A5 (R11, R12) |
| M4 | Sumar el flete por rechazo (`fleteDevolucionConIva`) al cobrado de cada tienda | A5 (R10) |
| M5 | Devolver el array vacío cuando el cierre tiene una sola tienda | A5 (R9) + B4 |
| M6 | Recortar a `"0.00"` un `pagoTienda` negativo | A5 |
| M7 | Cambiar el orden del array (invertirlo) | A5 (R8) |
| M8 | Cambiar un céntimo en una parte sin tocar el agregado | A5 (R10) |
| M9 | Pintar la marca de «varias tiendas» también con una sola | B4 (R2, R3) |
| M10 | Pintar el desglose en la vista del mensajero | B4 (R21) |

---

## Trazabilidad `R<n>` → test

| R | Qué exige | Test |
|---|---|---|
| R1 | Dice de cuántas tiendas se compone | B4 |
| R2 | Una tienda → su nombre | B4 |
| R3 | Dos o más → marca de agregado | B4 |
| R4 | Rótulos desde constante exportada | B4 (importa la constante; no teclea el texto) |
| R5 | Importe por cada tienda | A5 + B4 |
| R6 | Agrupa por la tienda **congelada** | **A6** (SQL real) |
| R7 | Identifica por id, muestra el nombre | A5 + A6 |
| R8 | Orden determinista | A5 (M7) |
| R9 | Una sola tienda: coherente y no peor | A5 + B4 |
| R10 | Σ partes = agregado | A5 (M4, M8) |
| R11 | Σ recaudado = total general | A5 (M3) |
| R12 | Mismo criterio que el total general | A5 (M3) |
| R13 | Aritmética en el servidor, STRING escala 2 | A3 (criterio de hecho) + B3 (sin `Number(`) |
| R14 | Misma función que el agregado, por subconjunto | A5 (M4) |
| R15 | No reparte pago al mensajero ni bodega | A5 (esas cifras no están en `ParteDeTienda`) |
| R16 | Lo dice en pantalla | B4 |
| R17 | Nada de lo visible cambia de valor | C2 + A5 (agregado intacto) |
| R18 | Sin exposición nueva | A4 (mismo alcance, sin ruta nueva) |
| R19 | Puerta de alcance intacta | tests de alcance existentes de `cierres-admin-service` |
| R20 | Sin migración | C5 (el diff no toca `db/`; el gate rápido **se niega solo** si tocara) |
| R21 | Vista del mensajero sin cambios | B4 (M10) |
| R22 | Descargas sin cambios | C1 |

---

## Archivos previstos (para la validación de conflicto del leader)

**Producción:**
- `lib/repositories/CierresAdminRepository.ts`
- `lib/repositories/CierreDiaRepository.ts`
- `lib/interfaces/repositories/ICierreDiaRepository.ts`
- `lib/interfaces/services/ICierresAdminService.ts`
- `lib/services/CierresAdminService.ts`
- `lib/utils/ingreso-ordenex.ts`
- `app/(app)/cierres-admin/_components/cierre-detalle-shared.tsx`
- `app/(app)/cierres-admin/_components/cierre-factura.tsx`
- `app/(app)/cierres-admin/_components/CierresAdminModule.tsx`

**Tests:** `tests/unit/utils/` (nuevo), `tests/integration/db/` (nuevo), `tests/components/`
(nuevo), + los ~20 archivos que tipan `CierreGestionPendienteRow` (ajuste mecánico de A2).

**NO se tocan:** `db/`, `*descarga-columnas*`, `CierresBodegaAdminService.ts`,
`WalletTiendaFeedService.ts`, `WalletFeedService.ts`.
