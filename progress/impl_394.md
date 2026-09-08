# impl 394 — el Excel de cierres cuenta los intentos que no son (mitad BACKEND)

**Ficha:** 394 · `fix/394-intentos-entrega-en-detalle-cierres` · sin spec (`sdd: false`) · **sin migración**
**Rol:** `backend_dev`. La columna del Excel la cambia `frontend_dev` después; aquí el dato llega
**hasta el borde** (`CierreGestionDescargaDTO`) y ni un archivo de `app/**` se toca.

---

## El campo nuevo, para quien haga la columna

```ts
// lib/interfaces/services/ICierresAdminService.ts → CierreGestionDescargaDTO
intentosEntrega: number;   // NUNCA null; el 0 es un valor CONOCIDO, no un hueco
```

- **Nombre exacto:** `intentosEntrega`. Es el mismo que ya usan la pantalla de liberación de
  reprogramadas (`ILiberacionReprogramadaRepository`), `IMisAsignacionesService`, `lib/types/orden.ts`
  y `lib/types/rechazo-sla-tienda.ts`: se sigue el precedente, no se inventa un nombre nuevo.
- **Encabezado propuesto para la hoja:** **«Intentos de entrega»** — el literal exacto que ya
  llevan `novedades-descarga-columnas.ts`, `ayuda-descarga-columnas.ts` y
  `lib/manifiesto/etiquetas-columnas.ts`. Sin siglas y sin inventar sinónimo: que la misma cosa se
  llame igual en las tres hojas es lo que impide que alguien las compare y crea que son dos datos.
  (Si se quisiera desambiguar más en esta hoja concreta: «Intentos de entrega de la orden», porque
  el número es de la ORDEN y no de la fila. Decisión de `frontend_dev`.)
- Viaja por el **DTO común**, así que sale igual por los DOS caminos: «Cierres del día»
  (`ICierresAdminService.listarGestionesCierresAdminCompleto`) y «Cierres de bodega»
  (`ICierresBodegaAdminService`). R26 conservado.

**Semántica, en una línea:** cuántos **cierres APROBADOS distintos** registran una gestión
contable y **vigente** sobre esa orden. Es el número con el que el sistema decide el tope (276) y
con el que cobra, y el mismo que consumen `AnaliticaOperativaService` y `AnaliticaRollupService`.
Es un dato **de la orden**, no de la fila: dos gestiones de la misma orden en dos cierres llevan
el mismo número, e incluye intentos de otros mensajeros y de días fuera del rango descargado.

---

## Qué se hizo, y por qué así

### El derivador se REUSA, no se copia

`contarIntentosVigentesEnLote` vive en `OrdenHistorialRepository`, cuyo cliente Prisma
(`Pick<..., "ordenHistorialEstado" | "gestionOrden" | "$queryRaw">`) **no es** el de los dos
repositorios de la descarga, así que estos no pueden construirlo; y darles una dependencia de
constructor obligaba a tocar los ~30 sitios que los instancian.

La salida: **el cuerpo del derivador se extrae a una función exportada** y el método delega en
ella. No es una segunda versión — es la misma:

```ts
// lib/repositories/OrdenHistorialRepository.ts
export async function contarIntentosVigentesEnLoteCon(
  gestionOrden: Pick<PrismaClient["gestionOrden"], "groupBy">,
  ordenIds: string[],
): Promise<Map<string, number>>
```

Mismo patrón y mismo motivo que `appendCambioEstado` (`registrar-cambio-estado.ts`): un choke
point que varios repos usan **sin instanciar la clase**. `OrdenHistorialRepository.contarIntentosVigentesEnLote`
ahora es `return contarIntentosVigentesEnLoteCon(this.prisma.gestionOrden, ordenIds)` — mismo
contrato, mismo comportamiento, cero llamadores tocados.

**Lo que NO se hizo, a propósito:** escribir el `groupBy` otra vez dentro de la descarga. Dos
agregaciones «iguales» divergen a la primera corrección, y ésta es la que gobierna el cobro.

### En LOTE, no por fila

Cada camino añade **UNA** consulta por descarga, en el **mismo `Promise.all`** que el snapshot:

```
findMany(gestion_orden) → [ findMany(cierre_detail) , groupBy(gestion_orden) ] → componer
```

Los `ordenId` van **deduplicados** (una orden puede traer N gestiones y su conteo es uno).
Conjunto vacío → ni una consulta (la guarda temprana del propio derivador). Una llamada por fila
sería un N+1 sobre una descarga que puede traer miles de gestiones.

### El `?? 0` vive en el compositor

`componerGestionesDescarga` y `toGestionDescargaDTO` reciben el conteo como parámetro
**obligatorio y sin default**: un default sería un cero silencioso el día que aparezca un tercer
llamador. Las órdenes sin intentos contables no vienen en el Map (Postgres no emite grupos
vacíos) y el `0` se resuelve ahí, que es el borde donde el DTO promete un número.

---

## `intentosContactoTienda`: se queda, y se dice por qué

Hoy tiene **un** consumidor de producción, y es justo la celda que `frontend_dev` va a sustituir:

- `app/(app)/cierres-admin/_components/cierres-gestiones-fundida-descarga-columnas.ts:239` (columna)
- `…:377` (celda)

⚠️ **Cuando `frontend_dev` haga el cambio, el campo `intentosContactoTienda` del DTO —y con él la
lectura `orden.intentosContacto` de `GESTION_DESCARGA_SELECT`— se quedan SIN consumidor de
producción.** No se borran aquí, y no por inercia:

1. El encargo lo pide explícitamente («no lo borres: dilo»).
2. Borrarlo se lleva por delante cobertura ajena: 5 archivos de test lo afirman
   (`cierres-gestiones-descarga-dto.test.ts`, `cierres-admin-gestiones-where.test.ts`,
   `cierres-gestiones-fundida-descarga-columnas.test.ts`, `cierres-gestiones-paridad.test.ts`,
   `CierresBodegaDescargaDetallada.test.tsx`), y en este repo eso ya costó una regresión en producción.
3. No cuesta nada: sale de la **misma** consulta que `fechaCreacionOrden` (tres campos en un solo
   `select`), no de un round-trip propio.

**Ojo, distinción importante:** lo que se queda sin consumidor es **el campo del DTO de la
descarga de cierres**, NO la columna `orden.intentos_contacto`, que sigue muy viva en /novedades
(`NovedadesService`, `ayuda-descarga-columnas.ts`, `OrdenEnvioReader`, plantillas de WhatsApp).

Si algún día se retira, se retira **con** su columna del `select`, sus tests y una medida de quién
lo consume — no de paso.

---

## Archivos

### Producción (6)
| Archivo | Qué |
| --- | --- |
| `lib/repositories/OrdenHistorialRepository.ts` | + `contarIntentosVigentesEnLoteCon` (el cuerpo del derivador, exportado); el método delega |
| `lib/interfaces/services/ICierresAdminService.ts` | + `intentosEntrega: number` en `CierreGestionDescargaDTO`; TSDoc de `intentosContactoTienda` actualizado (ya no es el de la columna, y por qué se conserva) |
| `lib/repositories/CierresAdminRepository.ts` | `toGestionDescargaDTO` y `componerGestionesDescarga` reciben el conteo; `findGestionesPorAlcanceCompleto` lo pide en lote |
| `lib/repositories/CierresBodegaAdminRepository.ts` | lo mismo en `findGestionesDeCierresBodegaCompleto` (R26) |
| `lib/interfaces/repositories/ICierresAdminRepository.ts` | TSDoc del contrato |
| `lib/interfaces/repositories/ICierresBodegaAdminRepository.ts` | TSDoc del contrato |

**Sin migración, sin tocar la base, sin tocar `app/**`, `components/**`, `feature_list.json` ni
`progress/current.md`.** El dinero de la fila no se toca: sigue viajando como STRING del snapshot.

### Tests (11, uno nuevo)
| Archivo | Qué |
| --- | --- |
| `tests/integration/db/cierre-descarga-intentos-entrega-sql-real.test.ts` | **NUEVO** — 7 semillas contra Postgres real |
| `tests/unit/repositories/cierres-gestiones-descarga-dto.test.ts` | + 7 casos de la 394; doble de `groupBy`; **una aserción de la 385 ACTUALIZADA** (ver abajo) |
| `tests/unit/repositories/cierres-admin-gestiones-where.test.ts` | + `groupBy` en el doble |
| `tests/unit/repositories/cierres-bodega-gestiones-where.test.ts` | + `groupBy` en el doble |
| 4 fixtures de `tests/components/descarga/*` | + `intentosEntrega: 5` (distinto de `intentosContactoTienda: 2`) |
| `tests/unit/descarga/cierres-gestiones-{paridad,fundida-descarga-columnas}.test.ts` | + `intentosEntrega` en el fixture |
| `tests/unit/services/Cierres{Admin,BodegaAdmin}Service.gestiones-completo.test.ts` | + `intentosEntrega` en el fixture |

**Ninguna aserción se debilitó.** Una se **actualizó**, y era el contrato:

```
- expect(conIntentos).not.toHaveProperty("intentosEntrega");   // ficha 385
+ expect(conIntentos).toHaveProperty("intentosEntrega");       // ficha 394
  expect(conIntentos).not.toHaveProperty("intentos");          // INTACTA
```

La 385 escribió «si mañana alguien lo añade, tiene que ser una columna con su propio nombre». El
humano firmó el 2026-09-08 sustituir la columna, así que esa mitad cambia; la otra mitad del
razonamiento —que un «intentos» a secas es el nombre ambiguo que causó la confusión— sigue viva y
su aserción no se toca. En todos los fixtures los dos contadores llevan **valores distintos**: con
los dos iguales, una celda que cogiera el equivocado pasaría en verde, que es exactamente lo que
pasó.

---

## Trazabilidad (el encargo no tiene `R<n>`; se numeran sus exigencias)

| Exigencia del encargo | Test |
| --- | --- |
| **E1** La columna sale de los intentos de ENTREGA, no de `orden.intentos_contacto` | `cierre-descarga-intentos-entrega-sql-real.test.ts` › «cada fila trae el conteo VIGENTE de su orden, y ninguna trae el de la tienda» · `cierres-gestiones-descarga-dto.test.ts` › «los DOS contadores viajan a la vez y no se contaminan» |
| **E2** Se cuentan los **VIGENTES**, no todos los que hubo | `…sql-real` › «una gestion ANULADA no cuenta…» y «un cierre sin aprobar no suma, y una `entregada` tampoco» · `…dto.test.ts` › «el conteo pide los VIGENTES, no todos los que hubo» |
| **E3** Se usa el derivador existente, no un `COUNT` propio | `…dto.test.ts` › «el conteo pide los VIGENTES…» (mide el `where` y el `by` que llegan a Prisma) · `orden-historial-repository.test.ts` (215) sigue verde sin tocarse |
| **E4** En LOTE, no por fila (anti N+1) | `…dto.test.ts` › «pide el conteo UNA sola vez, con los ids de orden sin repetir» y «sin gestiones tampoco se pide el conteo» |
| **E5** El grano es la ORDEN dentro del CIERRE (dos gestiones en un cierre = 1) | `…sql-real` › «dos gestiones contables en el MISMO cierre aprobado suman UNA» · `…dto.test.ts` › «los intentos de ENTREGA cuentan CIERRES aprobados, no gestiones» |
| **E6** El `0` se emite, no es un hueco | `…sql-real` › «un cierre sin aprobar no suma…» (tipo, no-null, no-undefined) · `…dto.test.ts` › «una orden sin ningún intento contable sale con CERO» |
| **E7** Los DOS caminos (día y bodega) emiten lo mismo (R26) | `…dto.test.ts` › «los DOS caminos producen la MISMA fila…» y «los DOS caminos piden el conteo con el MISMO criterio» |

### Por qué el test que muerde vive en `tests/integration/db`

El conteo es **derivado**: un `groupBy` con un `where` de seis condiciones, una de ellas un
`EXISTS` sobre `orden_historial_estado`. Con dobles ese SQL no se ejecuta (este repo ya midió
cuatro veces que una mutación de un `WHERE` sobrevive en verde a los tests de servicio) y un doble
del repositorio devolvería el Map que el propio test le ponga. El corpus se siembra en Postgres
dentro de una transacción que **siempre** se revierte, y **los intentos previos son de OTRO
mensajero**: la descarga se acota con `mensajeroIds`, así que un conteo que mirara solo las
gestiones de la hoja daría cero en todas las filas.

**Control positivo:** el primer caso afirma `expect(filas).toHaveLength(SEMILLAS.length)` y compara
el conjunto de remisiones **antes** de mirar ningún número — sin base alcanzable el archivo se
SALTA (`describe.skip`), nunca pasa en verde por vacío.

---

## Verificación

### Mutaciones — 6/6 muertas, con autocomprobación

Arnés propio (`scratchpad`, borrado tras usarse) que **aborta** si el texto a mutar no aparece
exactamente una vez, **aborta** si la salida de vitest no trae su línea de resultados (sin corrida
no hay veredicto) y **restaura releyendo y comparando byte a byte**:

```
M1 vigentes -> TODOS (se ignora el predicado unico)            MUERTA  Tests  4 failed          (exit 1)
M2 grano cierre -> orden (todo conteo pasa a valer 1)          MUERTA  Tests  2 failed | 24 passed (exit 1)
M3 la celda coge el contador de LA TIENDA (el fallo de la 385) MUERTA  Tests  9 failed | 17 passed (exit 1)
M4 los ids de orden dejan de deduplicarse (N+1 latente)        MUERTA  Tests  1 failed | 21 passed (exit 1)
M5 el default de la orden sin intentos deja de ser CERO        MUERTA  Tests  3 failed | 23 passed (exit 1)
M6 el camino de BODEGA deja de contar (siempre 0)              MUERTA  Tests  2 failed | 20 passed (exit 1)
muertas 6/6
```

**M1 es la mitad firmada del encargo**: cambiar el conteo de «vigentes» a «todos los que hubo»
pone rojos los **4** casos del test contra Postgres. **M3 reproduce literalmente el defecto de la
385** (la celda cogiendo el contador de la tienda) y mata 9 casos.

### Gate

`./init.sh --rapido` **se negó solo** (`INIT_EXIT=1`): el diff toca `lib/repositories/Cierres*`
—nombre de dinero— y `lib/interfaces/`. Se corrió el **completo**, como manda la regla.

```
== Arnes SDD :: init (modo: completo) ==
✓ typecheck paso
✓ lint paso
 Test Files  1788 passed (1788)
      Tests  25592 passed | 26 skipped (25618)
✓ tests: sin rojos nuevos (0 archivo(s) rojo(s) sobre 1788 ejecutado(s), todos en el baseline conocido)
✓ .env presente
INIT_EXIT=0
```

- `INIT_EXIT` leído **de dentro del log**, no del chat, y sin `tail`.
- **26 `skipped`** = exactamente los conocidos. El `.env` se copió al worktree antes de correr
  (si no, ~134 archivos de `tests/integration/db` se saltan y el gate dice «OK» sin haber probado
  la capa de datos) y **se borró antes de commitear**.
- El test nuevo corrió DENTRO del gate, no saltado:
  `✓ tests/integration/db/cierre-descarga-intentos-entrega-sql-real.test.ts (4 tests) 864ms`.
- `pnpm run db:generate` antes del gate (cliente Prisma fresco).
- **Ningún rojo raro que investigar**: 0 archivos rojos. No se tocó `tests/baseline-rojos.json`.

---

## Para `frontend_dev`

1. En `cierres-gestiones-fundida-descarga-columnas.ts`, **sustituir** la columna
   `{ clave: "intentosContactoTienda", encabezado: INTENTOS_CONTACTO_TIENDA_COL }` por una que lea
   `gestion.intentosEntrega` con el encabezado **«Intentos de entrega»**. La posición (13ª, entre
   «Tienda» y «Resultado») sigue siendo la correcta: es un dato de la orden y va antes de
   «Resultado», que cierra el bloque de lo que siempre se puebla.
2. El `0` se **emite**: nada de `|| null` ni `?? ""`. Que la celda diga `0` es lo que distingue
   «nadie la ha intentado» de «no se sabe».
3. Hay que actualizar la lista literal de 31 claves de
   `cierres-gestiones-fundida-descarga-columnas.test.ts` y el par de aserciones de encabezado de
   `CierresBodegaDescargaDetallada.test.tsx` — **son el contrato de la hoja, se actualizan, no se
   relajan**. Los fixtures ya traen `intentosEntrega: 5` frente a `intentosContactoTienda: 2`, así
   que si la celda cogiera el contador equivocado, se vería.
4. La prosa de la cabecera del módulo (bloque «LOS INTENTOS SON DE LA TIENDA…») queda desfasada y
   hay que reescribirla: hoy dice lo contrario de lo que el humano firmó.

---

## Veredicto

Los intentos de entrega vigentes de la orden llegan al borde de la descarga de cierres como
`intentosEntrega`, desde el derivador único de la 160/215 y en una sola consulta por descarga;
gate completo verde (`INIT_EXIT=0`, 26 skipped conocidos) y 6/6 mutaciones muertas, incluida la
que demuestra que contar «todos» en vez de «vigentes» pone rojo el test contra Postgres.
