# Feature 132 — analítica: tablero financiero · requirements (EARS)

> Zona: `frontend`. Complejidad: `medium`. `depends_on: 127` (**done**, PR #269).
> Rama: `feature/132-analitica-tablero-financiero`, nacida de `origin/dev` @ `a7962cc1`.
> Estado: **spec sin aprobar**. Las preguntas `Q1..Q6` del final son la puerta F1.4.

## 0. Contexto heredado (no se re-abre)

- **D7 de la 135, aviso DIRIGIDO a esta feature** (`specs/135-analitica-catalogo-kpis-rangos/design.md`
  §6.1, citado textualmente en `design.md` §2 de esta feature): el tablero financiero es **de dos
  roles**, exactamente los que `esAccesoTotal(rol)` acepta. Verificado en código:
  `ROLES_ACCESO_TOTAL = [maestro, admin]` (`lib/auth/acceso-total.ts:5`). **No hay tablero
  financiero "para tienda"**: las ocho métricas financieras son `prohibido` para `adminTienda`,
  `adminSatelite` y `mensajero` (`tests/unit/analytics/financiera-alcance.guardia.test.ts:39-51`).
- **D5/Q4 de la 129**: el shell es una **pila vertical de regiones con slots nombrados**, no
  pestañas. **D6 de la 129**: la región "financiero" no existe todavía y su punto de extensión
  está escrito en `app/(app)/analitica/_components/AnaliticaShell.tsx:28-36`.
- **Desfase de numeración de la ficha** (Q7/D8 de la 129): la `description` de la 132 dice
  «cablea 126 a las gráficas de 129 en la ruta 128». Los números reales son **127** (servicios
  financieros), **130** (gráficas) y **129** (ruta/shell). Ver `design.md` §1.

## 1. Alcance

DENTRO:

1. La región **"Tablero financiero"** de `/analitica`: paneles que pintan las **ocho** métricas
   financieras que la 127 sirve, con datos **pre-fetch en el Server Component** y bajados por
   props a los componentes de `components/private/analytics/` (patrón `private/`).
2. El punto de extensión del shell (slot `financiero`), tal como la 129 lo dejó escrito.
3. Los adaptadores **puros** que traducen el DTO de la 127 (importes `string` escala 2) a las
   props de las gráficas de la 130 (`number | null`), incluida la agrupación de cola que exige
   `components/private/analytics/topes.ts:16-17`.

FUERA, con su razón:

- **Ampliar el acceso a otros roles y recortar paneles por rol → feature 133.** Esta feature no
  toca `ROLES_ACCESO_ANALITICA` ni `ROLES_ANALITICA`: hacerlo rompería R10 de la 129 y/o el
  guard de no-convergencia (`tests/unit/guards/roles-analitica-acceso-vs-dominio.test.ts`).
- **Export CSV → feature 134.** Aquí no hay descarga, ni botón, ni serializador.
- **Barra de filtros (rango/zona/tienda/mensajero) → feature 131**, dueña del slot `filtros`
  (`AnaliticaShell.tsx:8-9`). Esta feature consume un rango por defecto (R26) y no pinta
  controles; construirlos aquí duplicaría el trabajo de la 131 en el mismo archivo.
- **Métricas operativas → 126 (pending) / 131.** Ninguna se cablea aquí.
- **Caché y `revalidateTag` → feature 128.**
- **Resolver nombres legibles de tienda a partir de su id → ver Q4.** Hoy el DTO entrega
  `cubo: tiendaId` y consultar `usuario` desde el tablero metería acceso a datos en una feature
  de presentación (`docs/architecture.md:147-156`).
- **Serie temporal (gráfica de líneas) → ver Q6.** El servicio de la 127 **no publica filas por
  fecha** para las métricas de caja: `AnaliticaFinancieraService.ts:196-201` declara `filas: []`
  a propósito («inventar una fila con la fecha de inicio del rango afirmaría que todo el dinero
  se movió ese día»). No hay dato con el que dibujar una línea.

## 2. Hechos verificados que estos requisitos dan por ciertos

| Hecho | Dónde se comprobó |
|---|---|
| El borde es un Server Action: `consultarMetricaFinanciera(metricaId, filtroRaw, deps?): Promise<RespuestaFinanciera>` | `lib/actions/analitica-financiera.ts:83-88` |
| `RespuestaFinanciera` = `ok` \| `validation_error` \| `forbidden` \| `error`; el `forbidden` no lleva motivo | `lib/types/analitica-financiera.ts:206-210` |
| Las ocho ids servidas están en una constante: `IDS_FINANCIERAS_SERVIDAS` | `lib/types/analitica-financiera.ts:225-234` |
| Todo importe es `string` escala 2, con `bruto` y `neto` | `lib/types/analitica-financiera.ts:53-60` |
| `cod_recaudado` trae DOS vistas con `sumableCon: []` | `AnaliticaFinancieraService.ts:242-276` |
| `esAcumulado` es `true` sólo en las dos cuentas por pagar | `lib/types/analitica-financiera.ts:243-251` |
| Las gráficas toman `valor: number \| null` y `null` = dato ausente, nunca 0 | `components/private/analytics/tipos.ts:23-31` |
| Topes del paquete: 5 series, 62 puntos; fuera de producción **lanzan** | `components/private/analytics/topes.ts:21-32,80-105` |
| Agrupar la cola en "otros" es trabajo del tablero, no del paquete | `components/private/analytics/topes.ts:16-17` |
| El shell no declara región financiera; el punto de extensión son 3 pasos | `AnaliticaShell.tsx:28-36` |
| El gate real de la página es `notFound()` server-side | `app/(app)/analitica/page.tsx:28-36` |

---

## 3. Requisitos

### 3.1 Alcance por rol

**R1.** CUANDO un actor autenticado cuyo rol satisface `esAccesoTotal(rol)` solicita `/analitica`,
el sistema DEBE renderizar una región con el nombre accesible **"Tablero financiero"**.

**R2.** MIENTRAS el rol del actor NO satisfaga `esAccesoTotal(rol)`, el sistema NO DEBE renderizar
la región financiera, ni su encabezado, ni el nombre de ninguna métrica financiera, ni ninguna
cifra de dinero, ni un estado vacío en su lugar.

**R3.** El conjunto de roles para los que se renderiza la región financiera DEBE derivarse del
catálogo de métricas y de `esAccesoTotal`, y NO de una lista de roles escrita de nuevo en esta
feature.

**R4.** SI la respuesta del borde para una métrica es `forbidden`, ENTONCES el sistema NO DEBE
renderizar el panel de esa métrica, NO DEBE mostrarlo en cero ni vacío, y NO DEBE mostrar al
usuario ningún motivo de denegación.

**R5.** El sistema NO DEBE modificar `ROLES_ACCESO_ANALITICA` (`lib/auth/menu-visibility.ts:79`)
ni `ROLES_ANALITICA` (`lib/analytics/types.ts`): el gate de la página, la visibilidad del ítem de
menú y su relación de subconjunto estricto DEBEN quedar exactamente como están.

### 3.2 El shell y la región

**R6.** El sistema DEBE añadir a `AnaliticaShellProps` una prop `financiero` opcional y renderizar
su contenido en una región propia, apilada verticalmente **debajo** de la región "Tablero
operativo", sin introducir pestañas ni navegación entre regiones.

**R7.** MIENTRAS el shell no reciba contenido para la región financiera, NO DEBE renderizar esa
región en absoluto (a diferencia de las regiones "Filtros" y "Tablero operativo", que sí muestran
su estado vacío).

**R8.** El sistema NO DEBE alterar el comportamiento existente de las regiones "Filtros" y
"Tablero operativo" ni el gate de rol de la página: los cuatro roles que hoy reciben `notFound()`
DEBEN seguir recibiéndolo.

### 3.3 Frontera RSC y pre-fetch

**R9.** El sistema DEBE obtener todos los datos financieros en el Server Component de la ruta,
antes de renderizar, invocando el Server Action de la 127; ningún componente de la región DEBE
hacer `fetch`, usar SWR, ni invocar Server Actions desde el navegador.

**R10.** Los archivos de servidor de esta feature (la página y los componentes que reciben el DTO)
NO DEBEN declarar `"use client"` ni pasar props cuyo valor sea una función a un componente
cliente.

**R11.** El sistema DEBE compilar en modo producción con la región financiera cableada: la
ejecución de `pnpm exec next build` DEBE terminar sin error.

**R12.** El sistema DEBE emitir las consultas de las métricas del tablero de forma concurrente, y
SI una consulta falla o es denegada, ENTONCES los paneles de las demás métricas DEBEN renderizarse
igualmente.

### 3.4 Fidelidad de las cifras

**R13.** El sistema DEBE renderizar un panel por cada una de las ids de `IDS_FINANCIERAS_SERVIDAS`
y NO DEBE renderizar ningún panel financiero cuya id no pertenezca a esa constante.

**R14.** El sistema NO DEBE sumar, restar, promediar ni derivar ningún importe: toda cifra pintada
DEBE proceder literalmente de un campo `bruto`, `neto` o `total*` del DTO, salvo la agrupación de
cola de R20.

**R15.** SI la conversión de un importe del DTO a número de presentación no produce un número
finito, ENTONCES el sistema DEBE pintarlo como **dato ausente**, y NO DEBE pintarlo como `0`.

**R16.** Cada panel que muestre un importe DEBE mostrar tanto el `bruto` como el `neto` de ese
importe, distinguibles entre sí.

**R17.** El sistema DEBE renderizar las dos vistas de `cod_recaudado` en paneles separados, y NO
DEBE sumarlas, combinarlas en una misma serie ni presentar un total conjunto de ambas.

**R18.** MIENTRAS el DTO de una métrica declare `esAcumulado: true`, su panel DEBE indicar en
texto visible que la cifra es un **saldo al corte** y no un flujo del período.

**R19.** CUANDO el DTO de `conciliacion_cierres` llega, el sistema DEBE renderizar los conteos por
`(nivel, estado)` con sus totales y el cuadre (`totalSnapshot`, `totalLedger`, `diferencia`), y SI
`cuadra` es `false`, ENTONCES DEBE mostrar un aviso visible de descuadre que incluya la cantidad de
cierres descuadrados.

**R20.** El sistema NO DEBE entregar a un componente de gráfica más series/segmentos que
`MAX_SERIES` ni más puntos por serie que `MAX_PUNTOS_SERIE`: cuando los cubos recibidos superen ese
techo, el tablero DEBE agrupar la cola en una categoría única antes de pasar los datos.

**R21.** La agrupación de R20 DEBE conservar el total: la suma de los valores de las categorías
resultantes DEBE ser igual a la suma de los valores recibidos.

**R22.** El sistema DEBE mostrar el rango efectivo de cada consulta usando las fechas calendario
que el propio DTO devuelve (`rango.desdeFecha`, `rango.hastaFecha`), sin recalcularlas.

**R23.** SI la respuesta de una métrica es `error` o `validation_error`, ENTONCES su panel DEBE
mostrar un estado de error y NO DEBE mostrar cifras, ceros ni una serie vacía presentada como dato.

**R24.** El sistema NO DEBE pintar identificadores de cubo distintos de los que el DTO entrega, ni
consultar tablas, servicios o repositorios adicionales para enriquecerlos.

### 3.5 Convenciones que esta feature no puede romper

**R25.** El sistema NO DEBE escribir en su código un símbolo de moneda, un código ISO de moneda ni
un literal de locale: todo formato de importe DEBE resolverse por las funciones de formato ya
existentes del paquete de gráficas.

**R26.** MIENTRAS no exista la barra de filtros (feature 131), el sistema DEBE resolver el rango de
todas las consultas desde una **única constante** de rango por defecto declarada en un solo
archivo, y NO DEBE aceptar rango, fechas ni filtros procedentes del cliente sin que pasen por el
esquema de validación del borde.

**R27.** El sistema NO DEBE declarar métricas ni escribir a mano la lista de ids financieros: DEBE
consumir `IDS_FINANCIERAS_SERVIDAS`, y ningún archivo nuevo bajo `app/`, `components/` o `lib/`
DEBE contener el literal `dominio: "financiera"`.

**R28.** Cada requisito `R1..R28` DEBE tener al menos un test nombrado por el comportamiento que
verifica, y el mapa `R<n> → test` DEBE quedar escrito en `progress/impl_132.md`.

---

## 4. Verificación

- Tests de componente/página en `tests/components/` (jsdom), siguiendo el patrón ya existente de
  `tests/components/AnaliticaPage.test.tsx` y `AnaliticaShell.test.tsx`.
- Tests unitarios puros para los adaptadores DTO→props y la agrupación de cola.
- Un guard estático para R10, R25 y R27 (censo de archivos, no de intenciones).
- **R11 no lo cubre ningún gate automático del repo**: se verifica ejecutando
  `pnpm exec next build` y pegando la salida en `progress/impl_132.md`. **Nunca `pnpm build`**,
  que encadena `migrate deploy` contra una base real.
- Cierre con `./init.sh` completo antes del PR.

---

## Preguntas abiertas (puerta F1.4) — **CERRADA el 2026-08-03**

> **CÓMO SE CERRÓ.** El humano ordenó continuar sin responderlas una a una («continua, vuelve y
> pregunta»), así que **las seis se toman con la recomendación que ya estaba escrita aquí** —no
> con un criterio inventado después— y quedan **PENDIENTES DE RATIFICACIÓN**. El detalle de cada
> decisión, con lo que cuesta revertirla, está en `tasks.md > T0`. Resumen:
>
> - **Q1 → `mes`.** Trivial de revertir (una constante y su test).
> - **Q2 → (a) id crudo**, con la limitación en pantalla. Ficha **178** para los nombres.
> - **Q3 → se acepta sin gráfica de líneas.** Ficha **179** para el desglose por fecha.
>   **Es la única cuya reversión NO es barata**: bloquearía la 132 hasta ampliar la 127.
> - **Q4/Q5/Q6 → sin objeción**, se aplican tal cual estaban escritas.
>
> Se deja el texto original íntegro debajo: es el razonamiento que sostiene cada respuesta, y
> borrarlo dejaría las decisiones sin su porqué.

**Q1 — BLOQUEANTE. ¿Cuál es el rango por defecto del tablero financiero mientras no exista la
barra de filtros de la 131?** Los presets disponibles son `dia`, `semana` (desde el lunes), `mes`
(ventana móvil de 30 días) y `personalizado` (`lib/analytics/ranges.ts`, D2/D3/D4 de la 135).
*Recomendación:* `mes`. Un tablero financiero abierto en `dia` a las 08:00 muestra casi todo en
cero y se lee como avería. Afecta a R26 y a su test.

**Q2 — BLOQUEANTE. ¿Qué se pinta como categoría de los cubos por tienda?** El DTO entrega
`cubo: tiendaId` crudo (`AnaliticaFinancieraService.ts:256-262`) y en este esquema el id de tienda
es una FK a `usuario` (`lib/analytics/alcance.ts:210-211`). Opciones: (a) pintar el id tal cual y
dejar los nombres para otra ficha; (b) que esta feature resuelva los nombres en el Server Component
con una lectura extra; (c) pedir a la 127 que añada la etiqueta al DTO (cambia una feature `done`).
*Recomendación:* (a), con la limitación escrita en pantalla y una ficha aparte. Afecta a R24.

**Q3 — BLOQUEANTE. ¿Se acepta que el tablero financiero NO tenga ninguna gráfica de líneas?** La
127 agrega la ventana entera y no publica filas por fecha para las cuatro métricas de caja ni para
la cuenta por pagar de mensajeros (`AnaliticaFinancieraService.ts:196-221,319-337`), así que no
existe serie temporal que dibujar sin inventarla. El tablero quedaría con tarjetas de KPI, un
donut (recaudo por método), una barra (recaudo por tienda) y tablas. *Recomendación:* aceptarlo y
abrir ficha aparte para el desglose por fecha si se quiere la línea. Afecta al inventario de
paneles de `design.md` §5.

**Q4 — no bloqueante. Región financiera ausente: ¿nada o estado vacío?** El comentario del punto de
extensión de la 129 (`AnaliticaShell.tsx:29-33`) enumera un tercer paso: «su placeholder
`EmptyState` a juego con los de abajo». Su propio razonamiento inmediato dice lo contrario: «una
región financiera visible y vacía es peor que no tenerla». *Recomendación:* R7 tal como está
escrito (no renderizar la región si no hay contenido), que es lo que hace coherente el razonamiento
con el resultado.

**Q5 — no bloqueante. ¿Se exige un E2E de Playwright?** `CHECKPOINTS.md:19-21` lo reserva a flujos
críticos (auth, pagos, recaudo…). Esto es lectura sin mutación, pero muestra recaudo y su gate es
una frontera de rol. La 130 dejó escrito que «el E2E corresponde a 131/132»
(`specs/130-.../design.md:513-514`). *Recomendación:* no en esta feature; el gate se cubre con
tests de página por rol (R1, R2), y el E2E se hace una sola vez en la 133, cuando el tablero ya
tenga su forma definitiva por rol.

**Q6 — no bloqueante. ¿El tablero muestra el aviso de descuadre (R19) a los dos roles o sólo a
`maestro`?** El descuadre ya se emite por `ErrorLogger` (`AnaliticaFinancieraService.ts:386-393`).
*Recomendación:* a los dos; `maestro` y `admin` son equivalentes en todo el repo
(`lib/auth/acceso-total.ts:3-5`) y partirlos aquí crearía una tercera categoría de rol.
