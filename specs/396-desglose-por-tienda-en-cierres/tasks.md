# Ficha 396 — Tareas

> Checklist ejecutable. Cada task tiene **criterio de hecho** verificable. `[P]` = paralelizable
> con las de su misma tanda. Las tandas van **en orden**.
>
> **Revisión 3 (2026-09-08):** ocho firmas cerradas, **las dos mediciones bloqueantes HECHAS**.
> 5 tandas, complejidad **alta** (`design.md §11`).
>
> **Regla del gate (AGENTS.md):** `backend_dev` / `frontend_dev` corren `pnpm typecheck`,
> `pnpm lint` y **sólo sus archivos** (`pnpm exec vitest related --run <archivos>`).
> `./init.sh --rapido` y el completo los corre **el leader**, nunca un subagente.

---

## T0 — Puerta

### T0.1 — La ficha 395 tiene que estar cerrada

**Situación medida el 2026-09-08:** la **mitad de servidor de la 395 YA ESTÁ MERGEADA** (PR #753) —
sus cuatro campos viven en `CierresAdminService.ts:681-751` y en `ICierresAdminService.ts:350-403`,
y `ganaLaTienda` en `ingreso-ordenex.ts:390`—. **Su pantalla está en curso.** El choque de archivos
**se resuelve solo**: cuando esta ficha arranque, la 395 estará `done`.

- [ ] **Hecho cuando:** la 395 está `done` y su PR de pantalla mergeado; la rama de esta ficha nace
      de un `origin/dev` que lo contiene.
- [ ] **Hecho cuando:** se han **leído** los cuatro campos de la 395 y `ganaLaTienda`, y se ha
      anotado en `progress/impl_396.md` qué se **reusa** (`design.md §1`) en vez de duplicarlo.
      **Toda la aritmética que esta ficha necesita ya existe**; lo único nuevo es la partición.
- [ ] **Hecho cuando:** se ha anotado **qué rótulos dejó la 395 para `ganaLaTienda` agregado**. Si
      no dejó ninguno, se crean en C2 (`design.md §8.3`).

### T0.2 — Confirmar en el archivo real los 14 puntos de `requirements.md § Lo confirmado`

El índice del MCP miente en las dos direcciones, y **la 395 acaba de mover dos de esos archivos**.

- [ ] **Hecho cuando:** los 14 puntos están verificados a mano en disco. **Si alguno es falso,
      PARAR** y decírselo al humano antes de escribir nada.

### T0.3 — ✅ RESUELTA · Las ocho preguntas están firmadas (2026-09-08)

Tabla completa en `requirements.md § Decisiones firmadas`. Las dos últimas:

- **Q7 — LAS DOS.** Tres cifras por tienda: recaudado, `pagoTienda`, `ganaLaTienda`. **Deroga la R5
  de la revisión 2**, que prohibía la tercera; R5 se reescribió para prohibir la **cuarta**, con el
  rastro de la firma escrito (`requirements.md § El rastro de Q7`).
- **Q8 — NO hay matriz.** Una fila por tienda en el nivel agregado de bodega.

### T0.4 — ✅ RESUELTA · Cardinales de los cierres de bodega (medido contra producción, 2026-09-08)

**14 cierres de bodega. Máximo 2 tiendas (media 1,29) y máximo 2 mensajeros (media 1,14).**

Por debajo del umbral de 4, así que **la tanda D sigue adelante sin volver a consultar**.

⚠️ **Cardinales JÓVENES.** Producción se vació a propósito el 2026-08-25: ese «máximo 2» es **lo que
ha pasado hasta hoy, no una garantía**. La **corrección** del desglose no depende del cardinal (es
una partición); la **legibilidad** sí — el modal ya monta dos cascadas por nivel y por mensajero.

- [ ] **Aviso permanente, no tarea:** si un día el máximo de tiendas por cierre de bodega llega a
      **4**, se mira la pantalla antes de seguir añadiendo. La consulta queda a mano:

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

### T0.5 — ✅ RESUELTA · El snapshot agregado de bodega ES la suma de sus días (2026-09-08)

**CERO cierres** donde `cierre_bodega.total_general` difiera de la suma de sus `cierre_dia`. Se
sostiene en los 14, igual que midió la 393.

⚠️ **Sigue siendo una MEDICIÓN, no una regla** (`design.md §6`). Si un día dejara de cuadrar, la
suma de las partes no daría el agregado, y **eso es un descuadre real que la pantalla debe enseñar
(R21)**, no un fallo del desglose que haya que corregir forzando el minuendo. La consulta queda a
mano para el día que alguien dude:

```sql
SELECT cb.id,
       cb.total_general                                       AS snapshot_agregado,
       COALESCE(SUM(cd.total_general), 0)                     AS suma_de_dias,
       cb.total_general - COALESCE(SUM(cd.total_general), 0)  AS diferencia
FROM cierre_bodega cb
LEFT JOIN cierre_dia cd ON cd.cierre_bodega_id = cb.id
GROUP BY cb.id, cb.total_general
HAVING cb.total_general <> COALESCE(SUM(cd.total_general), 0);
```

---

## Tanda A — Datos: el `tiendaId` sube (`backend_dev`)

### A1 — `DETALLE_ADMIN_SELECT` lee `tienda_id`

`lib/repositories/CierresAdminRepository.ts:164-194`. Añadir `tiendaId: true`.

- [ ] **Hecho cuando:** `pnpm typecheck` verde y el `select` proyecta la columna.
- [ ] **Hecho cuando:** el diff es **una línea** y no se ha tocado ninguna otra clave.
- [ ] **Hecho cuando:** se ha comprobado que `CierresBodegaAdminRepository.ts:353-356` usa **ese
      mismo `select`** — la bodega queda servida sin tocar nada más.

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
      DTO; fixture central en `tests/fixtures/cierre-pagos.ts`).

---

## Tanda B — El derivador (`backend_dev`) — depende de A

### B1 — `partesPorTienda` en `lib/utils/ingreso-ordenex.ts`

Firma y comportamiento en `design.md §4`. **Ni una fórmula de dinero nueva**: particiona por
`tiendaId` y llama a `computeTotales`, `totalesIngresoOrdenex`, `pagoTiendaOrdenex` y `ganaLaTienda`
sobre cada subconjunto.

- [ ] **Hecho cuando:** emite **TRES** cifras por tienda (`recaudado`, `pagoTienda`, `ganaLaTienda`)
      y **no cuatro** (R5, `design.md §9.5`).
- [ ] **Hecho cuando:** la función es **pura** (sin Prisma Client, sin repos, sin reloj, sin efectos
      al importarse) y toda salida es STRING escala 2.
- [ ] **Hecho cuando:** no aparece `Number(`, `parseFloat(`, `parseInt(` ni `.toFixed(` sobre nada
      que no sea un `Prisma.Decimal`.
- [ ] **Hecho cuando:** el orden es **`pagoTienda` descendente**, con el desempate declarado en un
      solo sitio (R8, Q6).
- [ ] **Hecho cuando:** el docstring explica por qué vive ahí, cita el precedente
      `dinero-por-producto.ts:200-273`, **escribe las cuatro identidades** (R10, R11, R12 y la que
      ata `pagoTienda` con `ganaLaTienda` por tienda, `design.md §4.4`), **dice que la usan las tres
      superficies** (R22), y **deja escrito que la tercera cifra entró por firma del humano del
      2026-09-08 (Q7)**.
- [ ] **Hecho cuando:** se ha comprobado que el import de `cierre-totales.ts` **no crea ciclo**. Si
      lo creara: caer a `design.md §9.7` y anotarlo.

### B2 `[P]` — Tests unitarios del derivador — depende de B1

`tests/unit/utils/` (nuevo). **Afirmando contra literales escritos a mano**: los importes del test
son el CONTRATO, no la salida de la función.

- [ ] Dos tiendas con importes distintos → dos partes con **sus tres** cifras, escritas a mano (R4).
- [ ] Una tienda → una parte, cuyas tres cifras son iguales a las agregadas.
- [ ] **R10**: Σ `pagoTienda` = agregado. Literal, al céntimo.
- [ ] **R11**: Σ `ganaLaTienda` = agregado. Literal, al céntimo.
- [ ] **R12**: Σ `recaudado` = `computeTotales(todas).general`.
- [ ] **La cuarta identidad, POR TIENDA** (`design.md §4.4`):
      `pagoTienda(t) − ganaLaTienda(t) === flete por rechazo + IVA de esa tienda`. Con un cierre
      donde una tienda tenga rechazos y la otra no, para que la resta no sea cero en las dos.
- [ ] **R13**: una gestión **no `entregada`** con líneas de pago **no aporta** al `recaudado` de su
      tienda.
- [ ] **R9 — la tienda que sólo trajo rechazos** (`design.md §4.5`): aparece en el desglose, con
      `recaudado` = `"0.00"`, `pagoTienda` = `"0.00"` y `ganaLaTienda` **negativo con su signo**. Y
      **cuenta** para el cardinal de tiendas.
- [ ] **R8**: tres tiendas con `pagoTienda` 100 / 300 / 200 salen 300, 200, 100; y dos con el
      **mismo** importe salen en el orden de desempate declarado.
- [ ] **R5**: el objeto emitido tiene **exactamente cinco** claves; ni `fleteConIva` ni
      `comisionConIva` se filtran.
- [ ] Una gestión **sin tarifa congelada** (gap R9 de la 69) no rompe: su tienda aparece con los
      conceptos en cero, no ausente.
- [ ] **Hecho cuando:** las mutaciones M1-M9 ponen estos tests en rojo.

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
      y **los cuatro campos de la 395** no cambian ni una línea (R18).

### C2 `[P]` — Rótulos nuevos en `cierre-labels.ts`

El módulo **PURO** (`:128-138`), **no** `cierre-detalle-shared.tsx`: con Q4 dentro los necesitan las
**dos** pantallas.

- [ ] **Hecho cuando:** ni un literal de texto queda dentro de un componente (R3).
- [ ] **Hecho cuando:** los rótulos de **«lo que se le paga»** y **«lo que gana en total»** se
      **distinguen sin ambigüedad**, con una nota que diga la diferencia en una frase (el flete por
      rechazo se cobra aparte, contra la wallet). Confundirlas es el fallo que la 395 arregla.
- [ ] **Hecho cuando:** `PAGO_TIENDA_LABEL`, `PAGO_TIENDA_NOTA` y `PARA_LA_TIENDA_LABEL` **no se
      tocan** (R18).
- [ ] **Hecho cuando:** el texto de R17 dice explícitamente que **el pago al mensajero y el ingreso
      de bodega por rechazos son del cierre entero y no están repartidos**.
- [ ] **Hecho cuando:** lenguaje claro, en español, sin siglas.

### C3 — Marca + desglose en el detalle del mensajero — depende de C1, C2

`cierre-factura.tsx`, **dentro** del corte `esMensajero` de `:1810` (R26).

- [ ] **Hecho cuando:** con **≥2** tiendas se ve la marca de agregado **y de cuántas** (R1) y una
      `CascadaDinero` por tienda con **tres líneas** (R4, `design.md §8.2`).
- [ ] **Hecho cuando:** con **1** tienda **no aparece nada nuevo**: la pantalla queda **exactamente
      como está hoy** (R2, Q5).
- [ ] **Hecho cuando:** se reusa `CascadaDinero` tal cual, con `ariaLabel` **propio y distinto** por
      tienda. **Ni una copia, ni un componente gemelo** (R22).
- [ ] **Hecho cuando:** el componente **no hace ni una operación aritmética** (R14).
- [ ] **Hecho cuando:** las tiendas se pintan en el orden que emite el servidor (R8).

### C4 `[P]` — Tests de componente de la superficie 1 — depende de C3

- [ ] Dos tiendas: los dos nombres y las **seis** cifras en el DOM, **literales a mano** (R4).
- [ ] Una tienda: **ni marca ni desglose** (R2).
- [ ] La tienda de sólo rechazos pinta su `ganaLaTienda` **negativo con su signo** y en tono de
      atención (R9).
- [ ] Los rótulos de las dos cifras de pago **son distintos** y la nota que los separa está presente
      (C2).
- [ ] La nota de R17 está siempre que se pinte el desglose.
- [ ] `audiencia="mensajero"`: **ni el agregado ni el desglose** (R26).

---

## Tanda D — Superficies 2 y 3: el cierre de bodega (`backend_dev` → `frontend_dev`)

**Depende de la tanda C cerrada.** La forma se prueba primero en una superficie y luego se lleva a
las otras dos: es la secuencia que el leader recomendaba entre fichas, aplicada dentro de la ficha.

### D1 — `verCierreBodegaDetalle`: el agregado que falta **y** el desglose — depende de C1

`lib/services/CierresBodegaAdminService.ts` y `ICierresBodegaAdminService.ts`.

⚠️ **PRIMERO la asimetría, que es un hallazgo del diseño (`design.md §5.2`):** el DTO de bodega
(`ICierresBodegaAdminService.ts:77-92`) trae `pagoTienda`, `cobradoSobreRecaudado` y `netoOrdenex`,
pero **NO `ganaLaTienda`** — la 395 lo puso sólo en el detalle del mensajero. Sin él, R11 no es
comprobable en bodega y el desglose sumaría hacia un total que no está en pantalla.

- [ ] **Hecho cuando:** los **dos niveles** de bodega emiten `ganaLaTienda` agregado, con la función
      que ya existe (`ingreso-ordenex.ts:390`), cada uno desde **sus propios** `totales.general` y
      `totalesIngreso.total`.
- [ ] **Hecho cuando:** el nivel por mensajero emite `partesPorTienda(cd.gestiones)`, **al lado** de
      su `totalesIngresoOrdenex(cd.gestiones)` de `:298`.
- [ ] **Hecho cuando:** el agregado emite
      `partesPorTienda(found.cierresDia.flatMap(cd => cd.gestiones))`, **al lado** del de
      `:346-348`, con **una fila por tienda** (Q8 se cumple por construcción al agrupar por
      `tiendaId`).
- [ ] **Hecho cuando:** cada nivel sale de **sus propias gestiones**; ninguno se deriva del otro ni
      se corrige para cuadrar (R21, regla ya escrita en `:358-363`).
- [ ] **Hecho cuando:** `pagoTienda`, `ganancia`, `paraLaCentral`, `efectivoCubreDescuentos`,
      `cobradoSobreRecaudado` y `netoOrdenex` de **los dos niveles** no cambian (R18).

### D2 — Pantalla de bodega, los dos niveles — depende de D1, C2, C3

`CierresBodegaAdminModule.tsx` (agregado: `:666-690`; por mensajero: `:728-751`).

- [ ] **Hecho cuando:** se usa **el mismo componente y los mismos rótulos** que la superficie 1
      (R22).
- [ ] **Hecho cuando:** el umbral del nivel por mensajero se evalúa **sobre las tiendas DE ESE
      MENSAJERO**, no sobre las de la bodega (`design.md §8.1`).
- [ ] **Hecho cuando:** cada `ariaLabel` es único en el modal — que ya monta las mismas cascadas una
      vez por mensajero.

### D3 `[P]` — Tests de componente de las superficies 2 y 3 — depende de D2

- [ ] Bodega con **2 mensajeros × 2 tiendas**: desglose en el agregado y en los dos mensajeros.
- [ ] ⚠️ **El caso que separa los umbrales:** bodega con **2 mensajeros que llevaron UNA tienda cada
      uno** → **ningún** nivel de mensajero enseña desglose y el **agregado sí** (R19 vs R20).
- [ ] **R10/R11 en el agregado**: Σ `pagoTienda` y Σ `ganaLaTienda` = sus agregados, literal al
      céntimo.
- [ ] Una tienda que aparece en **dos mensajeros** sale como **una** fila en el agregado (R20, Q8).

### D4 — Test de los tres puntos de llamada — depende de D1

**El composition root que no inyecta:** en este repo ya hubo 2 de 7 notificadores muertos con la
suite verde.

- [ ] **Hecho cuando:** un test comprueba que **los tres** sitios (detalle del mensajero, nivel
      mensajero de bodega, agregado de bodega) **pasan de verdad** por `partesPorTienda`, no sólo
      que la importan.

---

## Tanda E — Cierre (`backend_dev` + `frontend_dev`, luego leader)

### E1 `[P]` — No regresión de las descargas (R27, Q3)

- [ ] **Hecho cuando:** `cierres-gestiones-fundida-descarga-columnas.test.ts`,
      `cierres-admin-descarga-columnas` y `cierres-gestiones-paridad` pasan **sin tocarlos**.
- [ ] **Hecho cuando:** el diff no contiene ningún archivo `*descarga-columnas*`.

### E2 `[P]` — No regresión de las identidades ya pintadas

- [ ] **Hecho cuando:** `tests/components/DineroIdentidadesEnPantalla.test.tsx` pasa **sin
      modificarse** (bloques 393·B4, 393·B5, el censo D, y lo que la 395 le haya añadido).

### E3 — Mutaciones — depende de B2, B3, C4, D3

- [ ] **Hecho cuando:** cada mutación ha puesto **al menos un test en rojo**, con el nombre del test
      anotado.
- [ ] **Hecho cuando:** la **salida** de cada corrida está pegada en `progress/impl_396.md`. Un
      arnés de mutaciones que dice «9/9 supervivientes» sin ejecutar un test ya mintió dos veces en
      este repo: **la evidencia es la salida, no el resumen**.

### E4 — `progress/impl_396.md` — depende de todas

- [ ] Archivos tocados, mapa `R<n> → test`, salida de los tests, el número real de archivos de test
      tocados por A2, y **cualquier cosa que al mirar el código resultara distinta de lo escrito
      aquí**.
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
| M3 | Quitar el filtro `resultado === "entregada"` del recaudo por tienda | B2 (R12, R13) |
| M4 | Sumar el flete por rechazo al cobrado de cada tienda (`pagoTienda`) | B2 (R10 + la cuarta identidad) |
| M5 | Derivar `ganaLaTienda(t)` con el `total` **agregado** en vez del de su tienda | B2 (R11 + la cuarta identidad) |
| M6 | Recortar a `"0.00"` un `ganaLaTienda` negativo | B2 (R9) · C4 |
| M7 | Invertir el orden del array | B2 (R8) |
| M8 | Cambiar un céntimo en una parte sin tocar el agregado | B2 (R10/R11) |
| M9 | Emitir también `fleteConIva` en `ParteDeTienda` | B2 (R5) |
| M10 | Omitir del desglose la tienda que no recaudó nada | B2 (R9) |
| M11 | Enseñar el desglose también con **una** tienda | C4 (R2) |
| M12 | Pintar el desglose en la vista del mensajero | C4 (R26) |
| M13 | Usar el mismo rótulo para `pagoTienda` y `ganaLaTienda` | C4 (C2) |
| M14 | Evaluar el umbral del nivel-mensajero de bodega sobre las tiendas de **toda la bodega** | D3 |
| M15 | Derivar el desglose agregado de bodega **sumando** el de sus mensajeros | D3 (R21) |
| M16 | Dejar de llamar a `partesPorTienda` en uno de los tres sitios | D4 |

---

## Trazabilidad `R<n>` → test

| R | Qué exige | Test |
|---|---|---|
| R1 | Marca de agregado y de cuántas (≥2) | C4 · D3 |
| R2 | Con 1 tienda, todo como hoy | C4 (M11) |
| R3 | Texto desde constante exportada | C4 (importa la constante; no teclea el texto) |
| R4 | Tres cifras por tienda | B2 · C4 · D3 |
| R5 | Ninguna cifra de más (la cuarta) | B2 (M9) |
| R6 | Agrupa por la tienda **congelada** | **B3** (SQL real, M1/M2) |
| R7 | Identifica por id, muestra el nombre | B2 · B3 |
| R8 | Orden por `pagoTienda` descendente | B2 (M7) |
| R9 | La tienda sin recaudo entra y cuenta | B2 (M10) · C4 (M6) |
| R10 | Σ `pagoTienda` = agregado | B2 (M4, M8) · D3 |
| R11 | Σ `ganaLaTienda` = agregado | B2 (M5, M8) · D3 · **D1** (el agregado que faltaba en bodega) |
| R12 | Σ `recaudado` = total general | B2 (M3) |
| R13 | Mismo criterio que el total general | B2 (M3) |
| R14 | Aritmética en el servidor, escala 2 | B1 (criterio de hecho) · C3 (sin `Number(`) |
| R15 | Misma función que el agregado, por subconjunto | B2 (M4, M5) |
| R16 | No reparte pago al mensajero ni bodega | B2 (`ParteDeTienda` no tiene esas claves, M9) |
| R17 | Lo dice en pantalla | C4 · D3 |
| R18 | Nada visible cambia de valor (incl. los 4 campos de la 395) | E2 · C1 · D1 |
| R19 | Bodega, nivel por mensajero | D3 (M14) |
| R20 | Bodega, nivel agregado, una fila por tienda | D3 |
| R21 | Cada nivel de sus propias gestiones | D3 (M15) · **T0.5** (condición medida) |
| R22 | Mismos rótulos y componente en las 3 superficies | D4 (M16) · C2 (constante única) |
| R23 | Sin exposición nueva | C1 · D1 (mismo alcance, sin ruta nueva) |
| R24 | Las dos puertas de alcance intactas | tests de alcance existentes de `cierres-admin-service` y `cierres-bodega-admin-service` |
| R25 | Sin migración | E5 (el diff no toca `db/`; el gate rápido **se niega solo** si tocara) |
| R26 | Vista del mensajero sin cambios | C4 (M12) |
| R27 | Descargas sin cambios | E1 |

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
