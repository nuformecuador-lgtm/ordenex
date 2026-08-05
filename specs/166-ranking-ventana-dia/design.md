# 166 — Design: ventana de día del ranking

Base: `origin/dev` @ `64957dca`. Todo fichero:línea de este documento fue verificado en el
worktree `C:\w166`, no citado de la ficha.

## 1. El defecto, con precisión

`RankingService.obtenerRanking` (`lib/services/RankingService.ts:53-68`):

```ts
const UN_DIA_MS = 24 * 60 * 60 * 1000;          // :17
...
const desde = startOfDayCR(now);                 // :60  -> `YYYY-MM-DDT00:00:00.000Z`
const hasta = new Date(desde.getTime() + UN_DIA_MS); // :61 -> `+1dT00:00:00.000Z`
```

`desde`/`hasta` viajan tal cual al repositorio (`lib/repositories/RankingRepository.ts`):

| Consulta | Columna comparada | Tipo | Línea |
| --- | --- | --- | --- |
| entregadas (numerador) | `gestion_orden.created_at` | `timestamp` | `:21` (`createdAt: { gte: desde, lt: hasta }`) |
| asignadas (denominador) | `orden.asignado_at` | `timestamp` (`DateTime?`, `db/schema.prisma:496`) | `:34` (`asignadoAt: { gte: desde, lt: hasta }`) |

Ninguna de las dos es `@db.Date`. Como Costa Rica es **UTC−6 fijo**, `[00:00Z, 24:00Z)` es
`[18:00 CR del día anterior, 18:00 CR de hoy)`. `startOfDayCR` no está rota: está siendo usada
fuera de su convención (que es la de `@db.Date`, feature 46; documentado en
`lib/utils/fecha-cr.ts:94-105`).

## 2. El arreglo

En `RankingService.obtenerRanking`, sustituir las dos líneas por composición de los helpers de la
feature 144 —los mismos que usa la analítica— sin ninguna constante temporal propia:

```ts
const hoyCR = fechaCalendarioCR(now);
const desde = inicioDelDiaCREnUtc(hoyCR);            // `${hoyCR}T06:00:00.000Z`
const hasta = inicioDelDiaSiguienteCREnUtc(hoyCR);   // `+1dT06:00:00.000Z`
```

Efectos colaterales del cambio:

- `import { startOfDayCR } from "@/lib/utils/fecha-cr"` (`:11`) se sustituye por los tres helpers.
- La constante local `UN_DIA_MS` (`:15-17`) **desaparece**: ya no hace falta (R6 la prohíbe
  explícitamente para que nadie la reintroduzca «por comodidad»).
- El comentario `// R22: rango HOY(CR) por el helper` (`:59`) se reescribe citando la ficha 166
  y la convención (R15).
- Nada más del servicio cambia: ordenación, podio, pct, premios y autorización quedan intactos
  (R8).

## 3. Modelo de datos, endpoints, contratos

- **Modelo de datos:** ninguno. **No hay migración.** La única tabla del módulo,
  `premio_ranking` (`db/schema.prisma:1366-1378`), guarda `posicion`/`monto`/`descripcion` y no
  cambia. No existe tabla ni columna que persista resultados de ranking (H2).
- **RLS:** sin cambios (`premio_ranking` es service-role only).
- **Endpoints/rutas:** ninguna. El ranking se lee por Server Action
  (`lib/actions/ranking.ts::obtenerRankingAction`) desde `app/(app)/ranking/page.tsx`; ni la firma
  ni el DTO cambian.
- **Contrato I/O:** invariante. `ObtenerRankingServiceResult` /
  `RankingRowDTO` idénticos; `pct` y `premio` siguen siendo STRING money-safe.
- **Integraciones externas:** ninguna.
- **Índices:** la ventana sigue siendo un rango semiabierto sobre las mismas columnas, así que
  `@@index([mensajeroAsignadoId, asignadoAt])` (`db/schema.prisma:565`) sigue sirviendo igual. Se
  desplaza 6 h, no cambia de forma.

## 4. Anclajes que hoy CONGELAN la divergencia — inventario completo

Cada línea de esta tabla se verificó abriendo el fichero. **La columna «acción» es normativa: si se
deja uno vivo, el PR sale rojo; si se retira de más, se borra una guardia legítima.**

| # | Fichero:línea | Qué es | Acción |
| --- | --- | --- | --- |
| A1 | `lib/analytics/ranges.ts:39-51` (bloque «(c) DIVERGENCIA ACEPTADA CON EL RANKING (D6 / R31)») | Prosa que promete la divergencia como VIGENTE | **Reescribir**: la divergencia queda CERRADA por la 166; se conserva la explicación de por qué `startOfDayCR` no sirve contra `timestamp` y la prohibición de copiarla |
| A2 | `tests/unit/analytics/ranges-reuso.guardia.test.ts:98-106` | Guardia que exige **TRES coincidencias simultáneas** en `ranges.ts`: `"RankingService"`, `/18:00/` y `/D6/` | **Reexpresar** (no retirar): debe seguir exigiendo que la trampa esté nombrada, pero como historia cerrada. Ver §5 |
| A3 | `tests/unit/analytics/ranges-reuso.guardia.test.ts:5-28` | Cabecera en prosa del guardia que narra el defecto vivo y el ticket T0.3 pendiente | **Actualizar la prosa** (no hay assert sobre ella) |
| A4 | `tests/unit/analytics/ranges-reuso.guardia.test.ts:54-96` | Censos: import de `fecha-cr`, `6*60*60*1000`, `21600000`, `toISOString().slice`, `startOfDayCR` en `lib/analytics/**` | **NO TOCAR** (R10): siguen siendo válidos, `startOfDayCR` sigue existiendo |
| A5 | `tests/unit/services/ranking-service.test.ts:243-256` | Test que **codifica la ventana vieja** como comportamiento esperado (`desde = 2026-07-16T00:00:00Z`) | **Reescribir**: pasa a ser el test de R1/R2/R13 con bordes `T06:00:00.000Z` |
| A6 | `lib/utils/fecha-cr.ts:94-105` | Documento de la trampa (`startOfDayCR` ≠ `inicioDelDiaCREnUtc`) | **NO TOCAR** (R11): sigue siendo cierto y necesario |
| A7 | `lib/analytics/rollup-dia.ts:14`, `lib/services/AnaliticaOperativaService.ts:869-873`, `tests/unit/analytics/operativa-intradia.test.ts:101-102`, `tests/unit/analytics/rollup-dia.test.ts:111-119`, `tests/unit/analytics/rollup-guards.test.ts:477-513,558-575`, `tests/unit/analytics/rollup-service.test.ts:935-937` | Prosa y censos que citan «la ventana 18:00-18:00 de `RankingService`» o «ficha 166» | **NO TOCAR.** Ninguno afirma que el ranking siga roto de forma que rompa al arreglarlo: son censos sobre `lib/analytics/**` (siguen válidos) o prosa histórica. Tocarlos amplía el diff y arriesga guardias ajenas |
| A8 | `specs/76-ranking-mensajeros/requirements.md:40-41,54,167`, `specs/76-ranking-mensajeros/design.md:18-20,36,52,75,180` | Spec cerrado que define «Hoy(CR)» como `startOfDayCR + 24 h` | **Nota de supersesión** al final, sujeto a **Q4**. Sin reescribir el histórico |
| A9 | `specs/124/...`, `specs/135/...`, `progress/*` | Specs y bitácoras históricas | **NO TOCAR**: son registro de lo que se decidió cuando se decidió |

## 5. Cómo se reexpresa A2 sin vaciarlo

El caso actual («deja escrita en el propio módulo la divergencia aceptada con el ranking») existe
para que nadie «arregle» la analítica **copiando** `startOfDayCR`. Ese peligro no desaparece con
esta feature: `startOfDayCR` sigue exportada y sigue siendo la convención de `@db.Date`. Por eso el
caso **no se borra**; se convierte en:

> «documenta la trampa `startOfDayCR` y la divergencia YA CERRADA con el ranking»
> — sigue exigiendo tres coincidencias en `ranges.ts`: `"startOfDayCR"`, `/18:00/` y `/166/`.

Se sustituye `"RankingService"` por `"startOfDayCR"` (la trampa real, que sobrevive) y `/D6/` por
`/166/` (la decisión que la cerró). Mantener la exigencia de **tres** coincidencias conserva la
propiedad que hacía útil al guardia: no basta con nombrar la trampa de pasada.

## 6. Guardia nueva (R6/R7/R15/R16)

`tests/unit/guards/ranking-ventana-dia.guardia.test.ts` — censa la **fuente** de
`lib/services/RankingService.ts` y `lib/repositories/RankingRepository.ts`, con el patrón del repo
(quitar comentarios antes de censar el código, y exigir aparte que la prosa nombre la convención):

1. Sobre el **código sin comentarios**: cero apariciones de `startOfDayCR`, `getTimezoneOffset`,
   `toISOString().slice`, `6 * 60 * 60 * 1000`, `21600000`, `24 * 60 * 60 * 1000`, `86400000`,
   `T18:00`, `T00:00`.
2. Sobre el **código sin comentarios**: cero `new Date()` y cero `Date.now()` sin argumento (R7).
3. Sobre la **fuente completa**: aparecen `inicioDelDiaCREnUtc`, `inicioDelDiaSiguienteCREnUtc` y
   la cadena `166` (R15).
4. **Autocomprobación** del censo (patrón `ranges-reuso.guardia.test.ts:108-116`): un literal
   sospechoso inventado en el propio test es detectado, y `24 * 60 * 60 * 1000` no se confunde con
   un offset — si el censo dejara de medir, este caso lo revela.
5. `db/migrations/**` no contiene ninguna migración nueva con `ranking` o `premio` en el nombre
   posterior a la base de la rama (R16).

## 7. Alternativas descartadas

**Alt. 1 — Corregir con aritmética: `desde = startOfDayCR(now) + 6 h`.** Descartada. Es un offset
de zona horaria escrito a mano en un servicio de dominio: exactamente lo que los guardias del repo
(`rollup-guards.test.ts:507-556`, `ranges-reuso.guardia.test.ts:68-78`) llevan dos features
prohibiendo. Además deja el resultado correcto por una razón que hay que reconstruir mentalmente
cada vez, y volvería a romperse si Costa Rica adoptara DST.

**Alt. 2 — Reutilizar `resolverRango({ preset: "dia" }, now)` de `lib/analytics/ranges.ts`.**
Descartada. Es tentadora porque garantizaría R13 por construcción y `ranges.ts` es un módulo puro
(R1 de la 135), así que importarlo no rompe capas. Pero invierte la dirección de la dependencia:
`RankingService` (dominio, feature 76) pasaría a depender de la **analítica** (un consumidor de
lectura), arrastrando el tipo `RangoResuelto` y los presets `semana`/`mes` que el ranking no usa, y
atando la vida del ranking a decisiones futuras de la analítica (D2/D3 ya cambiaron una vez). La
dependencia común correcta es `lib/utils/fecha-cr.ts`, que es donde ya vive la aritmética.

**Alt. 3 — Eliminar `startOfDayCR` del repo.** Descartada: tiene tres consumidores **legítimos**
(`liberacion-reprogramada.ts:85`, `liberar-reprogramadas-handler.ts:72`, `periodicidad.ts:67,105`)
que comparan fechas `@db.Date`, para las que es la función correcta. Borrarla convertiría una
feature `low` en una refactorización de tres módulos con riesgo de off-by-one en dinero (gastos
fijos) y en liberaciones.

**Alt. 4 — Recortar la cota superior a `now` (paridad con el intradía de la analítica).**
Descartada: cambia la semántica de «día» del ranking sin que nadie lo haya pedido, y es
**indistinguible en resultados** (no existen `created_at`/`asignado_at` futuros). Se conserva
24:00 CR (R14).

**Alt. 5 — Mantener las dos ventanas tras un flag de entorno.** Descartada: dos verdades vivas en
el mismo servicio, sin dueño ni fecha de retirada, en una feature cuyo objetivo es eliminar
justamente eso. Además el ranking solo muestra «hoy», así que la rama vieja nunca se elegiría.

## 8. HALLAZGOS (divergencias entre la ficha y el código)

- **H1 — la ficha acierta en las líneas.** `RankingService.ts:60-61` son literalmente las dos
  líneas del defecto en `64957dca`. (Se verificó porque la ficha del módulo ya falló antes.)
- **H2 — «cambiar la ventana cambia cifras históricas» es inexacto.** *No hay histórico
  almacenado*: el ranking se **recalcula en cada lectura** y solo para «hoy» (`/ranking` llama a
  `obtenerRankingAction()` sin fecha). La única tabla del módulo es `premio_ranking`
  (`posicion`/`monto`/`descripcion`, 3 filas sembradas por migración): no guarda ganadores, ni
  fechas, ni conteos. **No hay nada que backfillear ni recalcular** (R16). Lo que sí cambia es
  (a) la lectura del propio día del despliegue y (b) las descargas ya emitidas por la feature 170,
  que son ficheros fuera de la base. Esto reduce Q1 a una decisión de comunicación, no de datos.
- **H3 — el corte del negocio ya es la medianoche CR.** `vercel.json` programa
  `/api/cron/corte-diario` a `0 6 * * *` = **00:00 CR**. Es decir, el sistema ya cierra el día
  operativo a medianoche CR mientras el ranking lo cierra a las 18:00 CR: la incoherencia no es
  solo con la analítica, es con el propio cierre diario.
- **H4 — el premio no está cableado a dinero dentro del sistema.** No existe ningún enlace de
  `premio_ranking` a `wallet_movimiento` ni a liquidación: el pago del podio ocurre fuera. El
  cambio de ventana toca **reconocimiento público** (podio visible al mensajero,
  `RankingPodio.tsx`, top 10 para el propio mensajero) y un pago **manual**, no un asiento
  contable automático. De ahí Q2/Q3.
- **H5 — un único guardia se cae, y exige tres coincidencias a la vez.**
  `ranges-reuso.guardia.test.ts:98-106` (ver A2/§5). El resto de menciones (seis ficheros, A7) son
  prosa o censos que sobreviven intactos. `ranking-service.test.ts:243-256` no es un guardia sino
  un test de comportamiento que codifica la ventana vieja: se reescribe (A5).
- **H6 — la complejidad `low` se sostiene, con una condición.** El cambio de producción son ~4
  líneas y cero migraciones. Pero el trabajo real es de coordinación: reexpresar un guardia sin
  vaciarlo, reescribir prosa en dos ficheros y **una decisión humana (Q1) que no puede tomarse
  desde el código**. Si el humano responde a Q1 con la opción **A** o **B** de
  `requirements.md §5`, la ficha **deja de ser `low`** (A exige inventar persistencia de rankings;
  B exige parametrizar por fecha un servicio que hoy solo conoce «hoy») y debe re-estimarse antes
  de implementar.
- **H7 — R13 es comprobable de forma exacta.** `resolverRango({ preset: "dia" }, now)` devuelve
  `desde = inicioDelDiaCREnUtc(hoyCR)` y `hasta = inicioDelDiaSiguienteCREnUtc(hoyCR)`: idénticos
  a la ventana nueva. (El `hasta = ahora` que se ve en la analítica es del **corte intradía** de
  `AnaliticaOperativaService`, una capa más abajo, y no afecta a esta comparación.)

## 9. Riesgos

| Riesgo | Mitigación |
| --- | --- |
| Alguien «revierte» el arreglo por parecer inconsistente con `startOfDayCR` | R15 + guardia §6: la razón queda escrita en el propio servicio y el censo la protege |
| Vaciar el guardia A2 al reexpresarlo | §5 fija la forma exacta: tres coincidencias, misma exigencia |
| Discontinuidad visible el día del despliegue | Q1 (opción C recomendada) + franja horaria de despliegue |
| Tocar prosa de la analítica de más y romper `rollup-guards` | A7 lo marca como **NO TOCAR** |
