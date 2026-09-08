# Ficha 396 — Tareas

> Checklist ejecutable. Cada task tiene **criterio de hecho** verificable. `[P]` = paralelizable
> con las de su misma tanda. Las tandas van **en orden**.
>
> **Revisión 2 (2026-09-08):** ajustada a las seis firmas. Con Q4 dentro son **5 tandas** y la
> complejidad sube a **alta** (`design.md §11`).
>
> **Regla del gate (AGENTS.md):** `backend_dev` / `frontend_dev` corren `pnpm typecheck`,
> `pnpm lint` y **sólo sus archivos** (`pnpm exec vitest related --run <archivos>`).
> `./init.sh --rapido` y el completo los corre **el leader**, nunca un subagente.

---

## T0 — Puerta. NO se escribe una línea de producción antes de esto

### T0.1 — La ficha 395 tiene que estar cerrada

**Situación medida el 2026-09-08:** la **mitad de servidor de la 395 YA ESTÁ MERGEADA** (PR #753) —
sus cuatro campos viven en `CierresAdminService.ts:681-751` y en `ICierresAdminService.ts:350-403`,
y `ganaLaTienda` en `ingreso-ordenex.ts:390`—. **Su pantalla está en curso ahora mismo.**

El choque de archivos **se resuelve solo**: cuando esta ficha arranque, la 395 estará `done`. Lo que
NO se resuelve solo es apoyarse en lo que dejó.

- [ ] **Hecho cuando:** la 395 está `done` y su PR de pantalla mergeado; la rama de esta ficha nace
      de un `origin/dev` que lo contiene.
- [ ] **Hecho cuando:** se han **leído** los cuatro campos de la 395 y `ganaLaTienda`, y se ha
      anotado en `progress/impl_396.md` qué se **reusa** de ella (`design.md §1`) en vez de
      duplicarlo. **Cuatro de las cinco piezas que esta ficha podría necesitar ya existen.**

### T0.2 — Confirmar en el archivo real los 14 puntos de `requirements.md § Lo confirmado`

El índice del MCP miente en las dos direcciones, y **la 395 acaba de mover dos de esos archivos**.

- [ ] **Hecho cuando:** los 14 puntos están verificados a mano en disco. **Si alguno es falso,
      PARAR** y decírselo al humano antes de escribir nada.

### T0.3 `[P]` — Q7 y Q8, a la mesa del humano

`requirements.md § Preguntas abiertas`. **Q7 no bloquea el servidor** (`design.md §5`); **Q8 sí
bloquea la tanda D** (el nivel agregado de bodega).

- [ ] **Hecho cuando:** las dos respuestas están escritas en `progress/impl_396.md` con su fecha y
      **con las palabras del humano**, no parafraseadas.

### T0.4 — 🔴 BLOQUEANTE: medir contra la base cuántas tiendas y cuántos mensajeros tienen los cierres de bodega

**No se puede deducir del código, así que no se razona: se mide.** Del código sólo se sabe la
FORMA (`cierre_bodega` → N `cierre_dia` → gestiones → `cierre_detail.tienda_id`); los cardinales son
un dato de producción.

De este número depende si el desglose del nivel agregado es legible o es un muro: si un cierre de
bodega típico tuviera 6 tiendas, el modal —que ya monta 2 cascadas por nivel y por mensajero
(`CierresBodegaAdminModule.tsx:666-756`)— se vuelve ilegible, y eso **cambia la decisión**, no la
implementación.

Consulta a correr en **solo lectura** contra producción (MCP de Supabase):

```sql
SELECT cb.id,
       COUNT(DISTINCT cd.id)          AS mensajeros,
       COUNT(DISTINCT det.tienda_id)  AS tiendas
FROM cierre_bodega cb
JOIN cierre_dia     cd  ON cd.cierre_bodega_id = cb.id
JOIN cierre_detail  det ON det.cierre_id       = cd.id
GROUP BY cb.id
ORDER BY tiendas DESC, mensajeros DESC;
```

- [ ] **Hecho cuando:** en `progress/impl_396.md` están escritos: cuántos cierres de bodega hay, el
      **máximo** y la **distribución** de tiendas y de mensajeros por cierre.
- [ ] **Hecho cuando:** si el máximo de tiendas es **≥4**, se le lleva el número al humano **antes**
      de implementar la tanda D. Un desglose de 6 filas por nivel es una decisión suya, no del
      implementer.
- [ ] ⚠️ Recordatorio: producción se vació a propósito el 2026-08-25. **Un cero aquí significa «aún
      no ha pasado», no «está roto»** — y en ese caso el número que vale es el de la distribución de
      `cierre_dia`, no el de bodega.

### T0.5 — 🔴 BLOQUEANTE: medir si el snapshot agregado de bodega es la suma de sus días

**De esto depende que R19 sea cierta** (`design.md §6`). La ficha 393 lo midió el 2026-09-08 (14/14
cuadran) y dejó escrito que es una **medición, no una regla**.

```sql
SELECT cb.id,
       cb.total_general                AS snapshot_agregado,
       COALESCE(SUM(cd.total_general), 0) AS suma_de_dias,
       cb.total_general - COALESCE(SUM(cd.total_general), 0) AS diferencia
FROM cierre_bodega cb
LEFT JOIN cierre_dia cd ON cd.cierre_bodega_id = cb.id
GROUP BY cb.id, cb.total_general
HAVING cb.total_general <> COALESCE(SUM(cd.total_general), 0);
```

- [ ] **Hecho cuando:** el número de filas devueltas está anotado. **Cero filas = R19 es alcanzable
      tal como está escrita.**
- [ ] **Hecho cuando:** si devuelve **alguna** fila, se PARA y se le lleva al humano: el desglose
      agregado no podrá sumar el agregado, y eso es un **descuadre real que la pantalla debe
      enseñar** (R20), no un bug del desglose.

---

## Tanda A — Datos: el `tiendaId` sube (`backend_dev`)

### A1 — `DETALLE_ADMIN_SELECT` lee `tienda_id`

`lib/repositories/CierresAdminRepository.ts:164-194`. Añadir `tiendaId: true`.

- [ ] **Hecho cuando:** `pnpm typecheck` verde y el `select` proyecta la columna.
- [ ] **Hecho cuando:** el diff es **una línea** y no se ha tocado ninguna otra clave.
- [ ] **Hecho cuando:** se ha comprobado que `CierresBodegaAdminRepository.ts:353-356` usa **ese
      mismo `select`** — o sea que la bodega queda servida sin tocar nada más.

### A2 — `CierreGestionPendienteRow` gana `tiendaId: string` — depende de A1

`lib/interfaces/repositories/ICierreDiaRepository.ts:48-…`, **requerido** (`design.md §3`).

| Mapper | Valor |
|---|---|
| `CierresAdminRepository.toPendienteRowDesdeSnapshot` (:373) | `d.tiendaId` (**congelado**, R6) — sirve al detalle del mensajero **y a los dos niveles de bodega** |
| `CierreDiaRepository.toPendienteRow` (:247) | `row.orden.tiendaId` — vista EN VIVO, el cierre aún no existe |

- [ ] **Hecho cuando:** `pnpm typecheck` verde **sin un solo `as`, `any` ni `@ts-expect-error`**
      nuevo en los dobles de test.
- [ ] **Hecho cuando:** el docstring dice **de dónde sale en cada caso y por qué** (congelado vs
      vivo).
- [ ] **Medir y anotar:** cuántos archivos de test hubo que tocar de verdad (estimado: 20 tipan el
      DTO; hay fixture central en `tests/fixtures/cierre-pagos.ts`).

---

## Tanda B — El derivador (`backend_dev`) — depende de A

### B1 — `partesPorTienda` en `lib/utils/ingreso-ordenex.ts`

Firma y comportamiento en `design.md §4`. **Ni una fórmula de dinero nueva.**

- [ ] **Hecho cuando:** emite **DOS** cifras por tienda (`recaudado`, `pagoTienda`) y **no cuatro**
      (R5, `design.md §9.5`).
- [ ] **Hecho cuando:** la función es **pura** (sin Prisma Client, sin repos, sin reloj, sin efectos
      al importarse) y toda salida es STRING escala 2.
- [ ] **Hecho cuando:** no aparece `Number(`, `parseFloat(`, `parseInt(` ni `.toFixed(` sobre nada
      que no sea un `Prisma.Decimal`.
- [ ] **Hecho cuando:** el orden es **`pagoTienda` descendente**, con el desempate declarado en un
      solo sitio (R8, Q6).
- [ ] **Hecho cuando:** el docstring explica por qué vive ahí, cita el precedente
      `dinero-por-producto.ts:200-273`, **escribe las invariantes R9/R10** con su argumento, y dice
      que **la usan las tres superficies** (R21).
- [ ] **Hecho cuando:** se ha comprobado que el import de `cierre-totales.ts` **no crea ciclo**. Si
      lo creara: caer a `design.md §9.6` y anotarlo.

### B2 `[P]` — Tests unitarios del derivador — depende de B1

`tests/unit/utils/` (nuevo). **Afirmando contra literales escritos a mano.**

- [ ] Dos tiendas con importes distintos → dos partes con **sus** dos cifras, escritas a mano (R4).
- [ ] Una tienda → una parte, `pagoTienda` igual al agregado.
- [ ] **R9**: Σ `pagoTienda` = agregado. Literal, al céntimo.
- [ ] **R10**: Σ `recaudado` = `computeTotales(todas).general`.
- [ ] **R11**: una gestión **no `entregada`** con líneas de pago **no aporta** al `recaudado` de su
      tienda.
- [ ] **R8**: tres tiendas con importes 100 / 300 / 200 salen en orden 300, 200, 100; y dos con el
      **mismo** importe salen en el orden de desempate declarado.
- [ ] **R5**: el objeto emitido tiene **exactamente** cuatro claves; ni `fleteConIva` ni
      `comisionConIva` se filtran.
- [ ] Un `pagoTienda` **negativo** se emite con su signo, sin recortar a `0.00`.
- [ ] Una gestión **sin tarifa congelada** (gap R9 de la 69) no rompe: su tienda aparece con los
      conceptos en cero, no ausente.
- [ ] **Hecho cuando:** las mutaciones M1-M8 ponen estos tests en rojo.

### B3 — Test de integración contra Postgres real — depende de A2

`tests/integration/db/` (nuevo; vecinos: `cierre-detail-congelado.test.ts`,
`cierre-sin-gestion-sql-real.test.ts`).

**Los tests de servicio usan dobles y no ven el SQL.** R6 sólo se puede probar aquí.

- [ ] **Siembra** un cierre con órdenes de **dos tiendas distintas** y sus filas `cierre_detail`. No
      se apoya en datos que estén.
- [ ] **Control positivo obligatorio:** afirma primero el **cardinal** (2 tiendas, N gestiones) y
      **falla si es cero**. Prohibido `if (!filas) return;`.
- [ ] Afirma que la agrupación usa **`cierre_detail.tienda_id`** y **no** `orden.tienda_id`:
      re-apuntar la orden a otra tienda después de crear el cierre **no** cambia el desglose (R6).
- [ ] **Hecho cuando:** el test **no se salta** por falta de `.env`. Si sale `skipped`, no está
      hecho.

---

## Tanda C — Superficie 1: el detalle del mensajero (`backend_dev` → `frontend_dev`)

### C1 — `verCierreDetalle` emite `partesPorTienda` — depende de B1

`lib/services/CierresAdminService.ts` (hoy :662-763) y `ICierresAdminService.ts:331-…`.

- [ ] **Hecho cuando:** el campo se emite **SIEMPRE**, también con una sola tienda
      (`design.md §5.1`): el umbral de Q5 es de **presentación**.
- [ ] **Hecho cuando:** `pagoTienda`, `ganancia`, `totalesIngreso`, `desgloseIngresoBodegaRechazos`
      y **los cuatro campos de la 395** no cambian ni una línea (R16).

### C2 `[P]` — Rótulos nuevos en `cierre-labels.ts` — depende de nada

`app/(app)/cierres-admin/_components/cierre-labels.ts` (el módulo **PURO**, `:128-138`), **no** en
`cierre-detalle-shared.tsx`: con Q4 dentro los necesitan las **dos** pantallas.

- [ ] **Hecho cuando:** ni un literal de texto queda dentro de un componente (R3).
- [ ] **Hecho cuando:** `PAGO_TIENDA_LABEL`, `PAGO_TIENDA_NOTA` y `PARA_LA_TIENDA_LABEL` **no se
      tocan** (R16).
- [ ] **Hecho cuando:** el texto de R15 dice explícitamente que **el pago al mensajero y el ingreso
      de bodega por rechazos son del cierre entero y no están repartidos**.
- [ ] **Hecho cuando:** lenguaje claro, en español, sin siglas.

### C3 — Marca + desglose en el detalle del mensajero — depende de C1, C2

`cierre-factura.tsx`, **dentro** del corte `esMensajero` de `:1810` (R25).

- [ ] **Hecho cuando:** con **≥2** tiendas se ve la marca de agregado **y de cuántas** (R1) y una
      `CascadaDinero` por tienda con **dos líneas** (R4).
- [ ] **Hecho cuando:** con **1** tienda **no aparece nada nuevo**: la pantalla queda **exactamente
      como está hoy** (R2, Q5).
- [ ] **Hecho cuando:** se reusa `CascadaDinero` tal cual, con `ariaLabel` **propio y distinto** por
      tienda. **Ni una copia, ni un componente gemelo** (R21).
- [ ] **Hecho cuando:** el componente **no hace ni una operación aritmética** (R12).
- [ ] **Hecho cuando:** las tiendas se pintan en el orden que emite el servidor, sin reordenar en el
      cliente (R8).

### C4 `[P]` — Tests de componente de la superficie 1 — depende de C3

- [ ] Dos tiendas: los dos nombres y las **cuatro** cifras en el DOM, **literales a mano** (R4).
- [ ] Una tienda: **ni marca ni desglose** (R2).
- [ ] La nota de R15 está siempre que se pinte el desglose.
- [ ] `audiencia="mensajero"`: **ni el agregado ni el desglose** (R25).

---

## Tanda D — Superficie 2 y 3: el cierre de bodega (`backend_dev` → `frontend_dev`)

**Depende de la tanda C cerrada y de T0.3 (Q8) y T0.4/T0.5 medidas.** La forma se prueba primero en
una superficie y luego se lleva a las otras dos: es la secuencia que el leader recomendaba entre
fichas, aplicada dentro de la ficha.

### D1 — `verCierreBodegaDetalle` emite `partesPorTienda` en los DOS niveles — depende de C1

`lib/services/CierresBodegaAdminService.ts` y `ICierresBodegaAdminService.ts`.

- [ ] **Hecho cuando:** el nivel por mensajero lo emite con `partesPorTienda(cd.gestiones)`, **al
      lado** de su `totalesIngresoOrdenex(cd.gestiones)` de `:298`.
- [ ] **Hecho cuando:** el agregado lo emite con
      `partesPorTienda(found.cierresDia.flatMap(cd => cd.gestiones))`, **al lado** del
      `totalesIngresoOrdenex(...)` de `:346-348`.
- [ ] **Hecho cuando:** cada nivel sale de **sus propias gestiones**; ninguno se deriva del otro ni
      se corrige para cuadrar (R20, regla ya escrita en `:358-363`).
- [ ] **Hecho cuando:** `pagoTienda`, `ganancia`, `paraLaCentral`, `efectivoCubreDescuentos`,
      `cobradoSobreRecaudado` y `netoOrdenex` de **los dos niveles** no cambian (R16).

### D2 — Pantalla de bodega, los dos niveles — depende de D1, C2, C3

`CierresBodegaAdminModule.tsx` (agregado: `:666-690`; por mensajero: `:728-751`).

- [ ] **Hecho cuando:** se usa **el mismo componente y los mismos rótulos** que la superficie 1
      (R21).
- [ ] **Hecho cuando:** el umbral del nivel por mensajero se evalúa **sobre las tiendas DE ESE
      MENSAJERO**, no sobre las de la bodega (`design.md §8.1`).
- [ ] **Hecho cuando:** cada `ariaLabel` es único en el modal — que ya monta las mismas cascadas una
      vez por mensajero.

### D3 `[P]` — Tests de componente de las superficies 2 y 3 — depende de D2

- [ ] Bodega con **2 mensajeros × 2 tiendas**: desglose en el agregado y en los dos mensajeros.
- [ ] ⚠️ **El caso que separa los umbrales:** bodega con **2 mensajeros que llevaron UNA tienda
      cada uno** → **ningún** nivel de mensajero enseña desglose y el **agregado sí** (R17 vs R18).
- [ ] **R19**: Σ del desglose agregado = «Pago a tienda» agregado, literal al céntimo.
- [ ] Una tienda que aparece en **dos mensajeros** sale como **una** fila en el agregado (R18).

### D4 — Test de los tres puntos de llamada — depende de D1

**El composition root que no inyecta:** en este repo ya hubo 2 de 7 notificadores muertos con la
suite verde.

- [ ] **Hecho cuando:** un test comprueba que **los tres** sitios (detalle del mensajero, nivel
      mensajero de bodega, agregado de bodega) **pasan de verdad** por `partesPorTienda`, no sólo
      que la importan.

---

## Tanda E — Cierre (`backend_dev` + `frontend_dev`, luego leader)

### E1 `[P]` — No regresión de las descargas (R26, Q3)

- [ ] **Hecho cuando:** `cierres-gestiones-fundida-descarga-columnas.test.ts`,
      `cierres-admin-descarga-columnas` y `cierres-gestiones-paridad` pasan **sin tocarlos**.
- [ ] **Hecho cuando:** el diff no contiene ningún archivo `*descarga-columnas*`.

### E2 `[P]` — No regresión de las identidades ya pintadas

- [ ] **Hecho cuando:** `tests/components/DineroIdentidadesEnPantalla.test.tsx` pasa **sin
      modificarse** (bloques 393·B4, 393·B5 y el censo D), y lo que la 395 le haya añadido también.

### E3 — Mutaciones — depende de B2, B3, C4, D3

- [ ] **Hecho cuando:** cada mutación de la tabla ha puesto **al menos un test en rojo**, con el
      nombre del test anotado.
- [ ] **Hecho cuando:** la **salida** de cada corrida está pegada en `progress/impl_396.md`. Un
      arnés de mutaciones que dice «9/9 supervivientes» sin ejecutar un test ya mintió dos veces en
      este repo: **la evidencia es la salida, no el resumen**.

### E4 — `progress/impl_396.md` — depende de todas

- [ ] Archivos tocados, mapa `R<n> → test`, salida de los tests, respuestas de Q7/Q8, los números de
      T0.4 y T0.5, el número real de archivos de test tocados por A2, y **cualquier cosa que al
      mirar el código resultara distinta de lo escrito aquí**.
- [ ] **COMMITEADO.** El informe describe el disco, no un commit; en este repo se ha perdido tres
      veces por un `git checkout`.

### E5 — Gate (lo corre **el leader**, no un subagente)

- [ ] `./init.sh --rapido` verde al cerrar cada tanda.
- [ ] `./init.sh` **completo** antes del PR. Escribir `INIT_EXIT=$?` **dentro** del log.
- [ ] Mirar los **`skipped`**, no sólo el `INIT_EXIT`: sin `.env` se saltan los 78 archivos de
      `integration/db` y aun así dice «init OK» — y B3 vive justo ahí.

---

## Mutaciones (E3) — cada una tiene que poner algo en rojo

| # | Mutación | Debe romper |
|---|---|---|
| M1 | Agrupar por `tiendaNombre` en vez de por `tiendaId` | B3 |
| M2 | Leer la tienda **viva** de la orden en vez de la congelada | B3 (R6) |
| M3 | Quitar el filtro `resultado === "entregada"` del recaudo por tienda | B2 (R10, R11) |
| M4 | Sumar el flete por rechazo al cobrado de cada tienda | B2 (R9) |
| M5 | Recortar a `"0.00"` un `pagoTienda` negativo | B2 |
| M6 | Invertir el orden del array | B2 (R8) |
| M7 | Cambiar un céntimo en una parte sin tocar el agregado | B2 (R9) |
| M8 | Emitir también `fleteConIva` en `ParteDeTienda` | B2 (R5) |
| M9 | Enseñar el desglose también con **una** tienda | C4 (R2) |
| M10 | Pintar el desglose en la vista del mensajero | C4 (R25) |
| M11 | Evaluar el umbral del nivel-mensajero de bodega sobre las tiendas de **toda la bodega** | D3 |
| M12 | Derivar el desglose agregado de bodega **sumando** el de sus mensajeros | D3 (R20) |
| M13 | Dejar de llamar a `partesPorTienda` en uno de los tres sitios | D4 |

---

## Trazabilidad `R<n>` → test

| R | Qué exige | Test |
|---|---|---|
| R1 | Marca de agregado y de cuántas (≥2) | C4 · D3 |
| R2 | Con 1 tienda, todo como hoy | C4 (M9) |
| R3 | Texto desde constante exportada | C4 (importa la constante; no teclea el texto) |
| R4 | Dos cifras por tienda | B2 · C4 · D3 |
| R5 | Ninguna cifra de más | B2 (M8) |
| R6 | Agrupa por la tienda **congelada** | **B3** (SQL real, M1/M2) |
| R7 | Identifica por id, muestra el nombre | B2 · B3 |
| R8 | Orden por importe descendente | B2 (M6) |
| R9 | Σ pagos = agregado | B2 (M4, M7) |
| R10 | Σ recaudado = total general | B2 (M3) |
| R11 | Mismo criterio que el total general | B2 (M3) |
| R12 | Aritmética en el servidor, escala 2 | B1 (criterio de hecho) · C3 (sin `Number(`) |
| R13 | Misma función que el agregado, por subconjunto | B2 (M4) |
| R14 | No reparte pago al mensajero ni bodega | B2 (`ParteDeTienda` no tiene esas claves, M8) |
| R15 | Lo dice en pantalla | C4 · D3 |
| R16 | Nada visible cambia de valor (incl. los 4 campos de la 395) | E2 · C1 · D1 |
| R17 | Bodega, nivel por mensajero | D3 (M11) |
| R18 | Bodega, nivel agregado | D3 |
| R19 | Σ por tienda = agregado de bodega | D3 · **T0.5** (condición medida) |
| R20 | Cada nivel de sus propias gestiones | D3 (M12) |
| R21 | Mismos rótulos y componente en las 3 superficies | D4 (M13) + C2 (constante única) |
| R22 | Sin exposición nueva | C1 · D1 (mismo alcance, sin ruta nueva) |
| R23 | Las dos puertas de alcance intactas | tests de alcance existentes de `cierres-admin-service` y `cierres-bodega-admin-service` |
| R24 | Sin migración | E5 (el diff no toca `db/`; el gate rápido **se niega solo** si tocara) |
| R25 | Vista del mensajero sin cambios | C4 (M10) |
| R26 | Descargas sin cambios | E1 |

---

## Archivos previstos (para la validación de conflicto del leader)

**Producción:**
- `lib/repositories/CierresAdminRepository.ts`
- `lib/repositories/CierreDiaRepository.ts`
- `lib/interfaces/repositories/ICierreDiaRepository.ts`
- `lib/interfaces/services/ICierresAdminService.ts`
- `lib/interfaces/services/ICierresBodegaAdminService.ts`
- `lib/services/CierresAdminService.ts`
- `lib/services/CierresBodegaAdminService.ts`
- `lib/utils/ingreso-ordenex.ts`
- `app/(app)/cierres-admin/_components/cierre-labels.ts`
- `app/(app)/cierres-admin/_components/cierre-factura.tsx`
- `app/(app)/cierres-admin/_components/CierresAdminModule.tsx`
- `app/(app)/cierres-admin/_components/CierresBodegaAdminModule.tsx`

**Tests:** `tests/unit/utils/` (nuevo), `tests/integration/db/` (nuevo), `tests/components/` (dos
nuevos: superficie 1 y superficies 2-3), + los ~20 archivos que tipan `CierreGestionPendienteRow`
(ajuste mecánico de A2).

**NO se tocan:** `db/`, `*descarga-columnas*`, `WalletTiendaFeedService.ts`, `WalletFeedService.ts`,
`CierreDiaModule.tsx`, `ConsolidacionBodegaModule.tsx`.
