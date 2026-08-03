# Feature 125 — analítica: backfill histórico de `analytics_daily` · requirements

> **⚠️ ENMIENDA del 2026-08-02 (posterior al rechazo del reviewer): R34 se RETIRA de esta feature**
> y pasa a ficha propia, la **174**. Motivo: **R33 y R34 eran mutuamente incompatibles tal como
> estaban escritos**, y no existe el dato que R34 exige. El cuerpo completo de lo retirado —problema,
> los **tres** anclajes de la cifra con ruta y línea, por qué no se puede medir en local, qué
> autorización explícita necesitará la 174 y las alternativas descartadas— está en
> [`RETIRADO-R34.md`](./RETIRADO-R34.md).
>
> **No se renumera nada.** R1–R33 y R35 conservan su número: la trazabilidad `R<n>` → test del
> implementer y del reviewer depende de los números actuales. **La 125 cierra con 34/34 requisitos
> vigentes** (los 35 originales menos R34).
>
> **Zona:** backend. **Puerta T0 CERRADA el 2026-08-02.** Esta spec es una **reescritura completa**
> de la versión del 2026-08-01, que se escribió contra la 124 **planeada**. La 124 está
> **entregada y mergeada** (PR #260) y su contrato manda. **No queda ninguna `⧗Q`**; lo que no se
> puede decidir con datos existentes está escrito como **limitación declarada**, nunca como
> supuesto.
>
> **Renumeración:** los requisitos van de `R1` en adelante. **La numeración anterior (45 R) no se
> conserva ni se mapea**: la mitad de aquellos requisitos definían un agregador que hoy existe.
>
> **Contrato heredado, verificado archivo por archivo en este worktree (`C:/w125`, sobre
> `origin/dev` @ `5314a2a8`) — nada citado de memoria:**
> - `lib/interfaces/services/IAnaliticaRollupService.ts` — `agregarFecha(fecha: string):
>   Promise<ResumenCorrida>`; idempotente (R27 de la 124), todo-o-nada (R30), y **un día sin datos
>   termina con éxito y CERO filas** (R46). `ResumenCorrida = { fecha, filasEscritas,
>   filasRetiradas, ms }`, **sin `BigInt`, sin ids y sin PII** (líneas 7-20).
> - `lib/repositories/AnaliticaRollupRepository.ts` — `escribirFecha` hace, **en una sola
>   transacción**: `now()` de Postgres → upsert `ON CONFLICT` por las 6 columnas del grano →
>   `retirarFilasRancias` (`DELETE ... WHERE fecha = ? AND updated_at < marca`) → reconciliación
>   (líneas 417-489).
> - `lib/analytics/rollup-dia.ts` — `ventanaDelDia`, `fechaObjetivo`, `fechaComoDate`,
>   `validarFechaInvocacionManual`.
> - `scripts/rollup-analitica-manual.ts` — invocación manual de **UNA** fecha, con dos guardas:
>   solo hoy/ayer CR (remite explícitamente al backfill de la 125, líneas 53-63) y **aborta si
>   `DATABASE_URL` no es `localhost:5432/ordenex`** (líneas 65-74).
> - `lib/config/analitica-rollup.ts` — `UMBRAL_AVISO_FILAS_CORRIDA = 20000`, declarada
>   **provisional y no medida**, y `TIMEOUT_TX_ROLLUP_MS = 120_000`.
> - Guardias vigentes que esta feature no puede romper:
>   `tests/unit/analytics/alcance-obligatorio.guardia.test.ts` (122/R18),
>   `tests/unit/analytics/rollup-guards.test.ts` (124/T5.4),
>   `tests/integration/db/analytics-daily-guards.test.ts` (124/T5.2),
>   `tests/unit/analytics/modulo-puro.guardia.test.ts` (135/R1).
>
> **Frontera dura.** Esta feature entrega: un **planificador puro de rango**, un **servicio de
> orquestación**, un **script one-shot** y sus guardias. **NO** entrega agregador (es de la 124),
> **NO** entrega migración ni cambia `db/schema.prisma`, **NO** entrega ruta HTTP, cron, job de la
> cola ni Server Action, **NO** lee ni escribe dinero, y **NO** toca `analytics_daily` por su
> cuenta: todo lo que se escribe pasa por `AnaliticaRollupService.agregarFecha`.

## Glosario mínimo

- **Fecha CR**: fecha calendario de Costa Rica `YYYY-MM-DD`, resuelta con `lib/utils/fecha-cr.ts`.
  Todo borde de día es `...T06:00:00.000Z`.
- **Corrida**: una invocación del backfill sobre un rango.
- **Pasada**: el recorrido completo del rango dentro de una corrida.
- **Agregador**: `AnaliticaRollupService.agregarFecha(fecha)`, propiedad de la **124**.
- **Horizonte del historial**: **2026-07-13**. Hecho verificado: `orden_historial_estado` se creó en
  `db/migrations/20260713120000_orden_historial_estado/migration.sql`, migración **aditiva que no
  backfilleó** filas para las órdenes preexistentes (líneas 12 y 29-42 del `.sql`).
- **Fecha no comparable**: fecha del rango **anterior** al horizonte del historial. Ver R20 y la
  *Limitación L1*.

---

## Requisitos

### Frontera y forma de la entrega

**R1.** El sistema DEBE entregar el backfill como un **script one-shot** bajo `scripts/`, que solo
se auto-ejecute cuando es el entrypoint del proceso (patrón de `scripts/rollup-analitica-manual.ts`,
líneas 90-93), de modo que importarlo desde un test no ejecute nada.

**R2.** El sistema NO DEBE exponer el backfill como route handler, cron de `app/api/cron/`, job
recurrente de la cola (`lib/services/jobs/`) ni Server Action.

**R3.** Toda la orquestación DEBE vivir en un **servicio** que reciba por inyección el agregador
(por su interfaz `IAnaliticaRollupService`), el reloj, la salida de progreso y la pausa entre
fechas, de modo que la corrida completa sea ejecutable en test **sin base de datos, sin proceso
hijo y sin red**. El script DEBE limitarse a validar argumentos, construir dependencias reales y
delegar.

**R4.** El sistema DEBE obtener las filas de cada fecha **invocando `agregarFecha` de la 124** y NO
DEBE contener consultas propias a `orden`, `gestion_orden`, `orden_historial_estado` ni
`analytics_daily`, ni una segunda definición de ninguna de las diez medidas del rollup.

**R5.** El sistema NO DEBE añadir migración, tabla, columna ni cambio de `db/schema.prisma`, y NO
DEBE leer ni escribir ninguna tabla de dinero (`wallet_movimiento`, `wallet_tienda_movimiento`,
`pago_mensajero_movimiento`, `cierre_dia`, `cierre_bodega`).

### Entrada y recorrido del rango

**R6.** El sistema DEBE aceptar el rango como **dos fechas CR explícitas** (`--desde`, `--hasta`,
formato `YYYY-MM-DD`), validadas con zod en el borde del script.

**R7.** SI falta el rango, o `desde > hasta`, o alguna fecha no tiene formato válido, ENTONCES el
sistema DEBE abortar **antes de invocar el agregador ni una vez**, imprimir el motivo y terminar con
código distinto de 0. El sistema NO DEBE interpretar la ausencia de rango como «toda la base».

**R8.** El sistema DEBE recorrer el rango **fecha calendario CR a fecha calendario CR**, inclusivo
en ambos extremos, apoyándose en `lib/utils/fecha-cr.ts`, y NO DEBE usar los presets de
`lib/analytics/ranges.ts` (`dia`/`semana`/`mes`) para delimitar lo que recomputa: `mes` es una
ventana móvil de 30 días y no un rango de calendario (135/D3).

**R9.** El recorrido DEBE cruzar correctamente fin de mes, fin de año y año bisiesto, y DEBE
producir exactamente `N` fechas para un rango de `N` días, en orden ascendente y sin repetir
ninguna.

**R10.** SI el rango incluye el **día CR en curso** o cualquier fecha posterior, ENTONCES el sistema
DEBE rechazar el rango **entero**, nombrar la fecha ofensora y terminar con código distinto de 0 sin
invocar el agregador. El último día recomputable es **ayer CR** (D3 de esta spec).

### Ejecución sobre el contrato de la 124

**R11.** El sistema DEBE invocar `agregarFecha` **exactamente una vez por fecha del rango y por
pasada**, en orden ascendente, y NO DEBE invocarlo con ninguna fecha fuera del rango.

**R12.** CUANDO se ejecuten dos pasadas consecutivas sobre el mismo rango sin que la fuente viva
haya cambiado, la segunda pasada DEBE reportar, para cada fecha, `filasRetiradas === 0` y el mismo
`filasEscritas` que la primera.

**R13.** SI `agregarFecha` lanza para una fecha, ENTONCES el sistema DEBE registrar esa fecha como
**fallida**, **continuar** con la siguiente y terminar la corrida con código distinto de 0. El
sistema NO DEBE reintentar automáticamente esa fecha dentro de la misma pasada.

**R14.** SI se acumulan **fallos consecutivos** hasta el número declarado en la constante única de
configuración, ENTONCES el sistema DEBE abortar la pasada, decir cuántas fechas quedaron sin
procesar y terminar con código distinto de 0.

**R15.** El sistema DEBE procesar **una fecha a la vez**: NO DEBE lanzar las fechas en paralelo y NO
DEBE acumular en memoria el resultado de más de una fecha más allá de sus contadores agregados.

**R16.** El sistema DEBE aceptar una **pausa entre fechas** en milisegundos, con valor por defecto
0, y DEBE respetarla entre fechas consecutivas. Esta entrega NO DEBE imponer un tope de días por
invocación (D5).

### Observabilidad de la corrida larga

**R17.** El sistema DEBE emitir, por cada fecha procesada, una línea de progreso con: fecha CR,
`filasEscritas`, `filasRetiradas`, `ms` y la clasificación de esa fecha.

**R18.** Al terminar, el sistema DEBE emitir un **resumen** con: fechas del rango, procesadas,
fallidas, no comparables, suma de `filasEscritas`, suma de `filasRetiradas` y duración total; y DEBE
terminar con código distinto de 0 si hubo alguna fecha fallida.

**R19.** El sistema DEBE escribir un **reporte de corrida legible por máquina** en la ruta indicada
por argumento, con una entrada por fecha (`fecha`, `filasEscritas`, `filasRetiradas`, `ms`,
clasificación) más la cabecera del rango, el modo y el instante de la corrida. El reporte NO DEBE
contener identificadores de zona, tienda, mensajero, estatus ni orden.

### Horizonte del historial

**R20.** El sistema DEBE declarar el horizonte del historial como **una sola constante** con su
procedencia (la migración que creó `orden_historial_estado`) y DEBE clasificar como **no
comparable** toda fecha del rango anterior a ese horizonte, marcarla en el progreso de R17 y
contarla aparte en el resumen de R18 y en el reporte de R19.

**R21.** Para una fecha no comparable, el sistema DEBE invocar `agregarFecha` **igual que para
cualquier otra** y NO DEBE alterar, simular ni rellenar ninguna medida: la única diferencia
admitida es la **etiqueta** con la que se reporta el resultado.

**R22.** El sistema NO DEBE presentar el resultado de una fecha no comparable como equivalente al de
una fecha comparable: la salida de R17/R18/R19 DEBE permitir distinguir «cero porque el historial no
alcanza» de «cero porque ese día no hubo actividad».

### Modo verificación

**R23.** El sistema DEBE ofrecer un modo `--verificar` que ejecute una **segunda pasada** sobre el
rango y compare, fecha a fecha, el `ResumenCorrida` obtenido contra el reporte de corrida de una
pasada anterior, indicado por argumento obligatorio.

**R24.** SI el modo `--verificar` se invoca sin reporte previo, o el reporte no cubre el rango
pedido, ENTONCES el sistema DEBE abortar antes de invocar el agregador y terminar con código
distinto de 0.

**R25.** El modo `--verificar` DEBE clasificar cada fecha en exactamente una de **cuatro**
categorías: `estable` (`filasRetiradas === 0` y `filasEscritas` igual a la del reporte previo),
`cambiada`, `no_comparable` (R20) y `fallida`; y DEBE terminar con código distinto de 0 si hay
alguna `cambiada` o `fallida`.

**R26.** El sistema DEBE declarar en su propio eco que `--verificar` **escribe**, porque recomputa
la fecha con el agregador de la 124. El sistema NO DEBE anunciarse como modo de solo lectura.

### Seguridad y operación

**R27.** ANTES de invocar el agregador por primera vez, el sistema DEBE imprimir un **eco de la
corrida** con: host, puerto y nombre de la base de destino **sin usuario ni contraseña**, el modo,
el rango `desde`–`hasta`, el número de fechas y cuántas de ellas son no comparables.

**R28.** El sistema DEBE exigir **confirmación explícita** antes de la primera invocación del
agregador: sin el indicador de confirmación DEBE imprimir el eco y el plan y terminar **sin invocar
el agregador**. CUANDO el indicador esté presente, el sistema DEBE exigir además que el operador
reintroduzca literalmente el rango, y SI lo reintroducido no coincide exactamente con el rango del
eco, ENTONCES DEBE abortar sin invocar el agregador y con código distinto de 0.

**R29.** El sistema NO DEBE contener ninguna URL de conexión ni credencial escrita en el código, y
NO DEBE imprimir la contraseña ni el usuario de `DATABASE_URL` en ninguna salida.

**R30.** Por defecto, el sistema NO DEBE imprimir el **mensaje crudo** de un error del agregador:
DEBE imprimir la fecha, el nombre del error y —cuando exista— la etapa. CUANDO se invoque con
`--verboso`, el sistema DEBE imprimir el error completo. `--verboso` NO DEBE estar activo por
defecto ni activarse por omisión de otro argumento.

**R31.** El sistema DEBE propagar el contexto de todo fallo (qué fecha, qué modo), NO DEBE contener
`catch` vacíos y NO DEBE continuar en silencio: toda fecha fallida DEBE aparecer en el resumen y en
el código de salida.

### Guardias y contrato con la 124

**R32.** El sistema DEBE mantener un **guardia estructural** sobre los archivos de esta feature que
verifique que: no nombran `analytics_daily` en código, no consultan ninguna tabla de analítica, no
declaran superficie HTTP ni job recurrente, no mencionan tablas de dinero y no declaran una segunda
definición de las medidas del rollup. El guardia DEBE autocomprobarse con fixtures (uno legítimo y
al menos dos infractores), para no pasar por vacío.

**R33.** El sistema NO DEBE modificar la semántica del agregador de la 124 ni de sus guardias. Los
únicos archivos de la 124 que esta feature puede tocar son `lib/config/analitica-rollup.ts` (para
las constantes de R14, R20 y R34) y el allowlist de R47 del guardia
`tests/unit/analytics/rollup-guards.test.ts`, y solo por lo que R34 obliga.

> **R33 se conserva LITERALMENTE, sin retocar ni una palabra.** Es el requisito que se cumplió: la
> 125 solo añadió constantes a `lib/config/analitica-rollup.ts` y no tocó ninguna aserción ajena.
> Su texto sigue mencionando R34 porque así se escribió y así se verificó; la mención hay que leerla
> como **histórica**. Al retirarse R34, la autorización que R33 concedía («y solo por lo que R34
> obliga») **queda sin objeto dentro de esta feature**: el permiso de tocar el allowlist `AJENAS_A_R47`
> **no se ejerce**. Cambiar R33 para borrar la mención habría alterado el enunciado contra el que ya
> se corrieron los tests, y eso rompe la trazabilidad; retirar R34 no la rompe.

**R34. — RETIRADA de la feature 125. Trasladada a la ficha 174.** *(Número reservado: NO se reasigna
ni se reutiliza en esta spec.)*

Texto original, conservado solo como registro de lo que se retira:

> ~~CUANDO exista la medición de la corrida real (R35), el sistema DEBE sustituir
> `UMBRAL_AVISO_FILAS_CORRIDA` por una cifra **con procedencia documentada**, manteniéndola en **una
> sola constante**, y DEBE dejar en verde el allowlist `AJENAS_A_R47` del guardia de cifra única, que
> hoy exime dos ocurrencias de `20_000` usadas como timeout en
> `lib/clients/google-route-optimization.ts` y `lib/config/route-optimization.ts` y que **caduca en
> cuanto el valor cambie**.~~

**Por qué se retira** (tres motivos, cualquiera de ellos bastaba):

1. **Contradicción interna de la spec.** R33 autoriza tocar exactamente dos cosas de la 124: el
   archivo de configuración y el **allowlist** `AJENAS_A_R47`. Cumplir R34 exige además editar una
   **aserción** de un guardia ajeno —`tests/unit/analytics/rollup-guards.test.ts`, caso «(a) el
   comentario declara que la cifra es PROVISIONAL y NO MEDIDA (D9)», **líneas 710-738**, que exige
   que la prosa previa a la declaración case `/provisional/i` **y** `/\bno\s+…medid[ao]\b/i`—, cosa
   que R33 **no** autoriza. Los dos requisitos no pueden cumplirse a la vez.
2. **El anclaje es TRIPLE, no doble.** La spec original solo contaba dos puntos (la constante y el
   allowlist). Hay un tercero, verificado en este worktree:
   `tests/unit/analytics/rollup-service.test.ts:1047` teclea el literal `20_000` **a mano** dentro de
   la regex (`new RegExp(\`\\b${UMBRAL_AVISO_FILAS_CORRIDA}\\b|\\b20_000\\b\`)`), y ese mismo archivo
   vuelve a anclar la prosa en la **línea 1072** (`expect(config).toMatch(/PROVISIONAL Y NO MEDIDA/i)`).
   Ver el inventario completo en `RETIRADO-R34.md`.
3. **No hay dato.** La corrida real de R35 midió **58 órdenes** en el rango, con un pico de **24 filas
   en una sola fecha** (`progress/backfill_125.md`, T7.5, líneas 118-123). Convertir 24 en un umbral
   de producción exige un multiplicador **inventado**, que es exactamente lo que **D5** prohíbe. R34
   no se puede cumplir con integridad desde esta feature.

**Efecto sobre la 125:** ninguno en el código entregado. R34 no llegó a implementarse (T6.1 y T6.2
quedaron sin ejecutar, ver `tasks.md > T6`), `UMBRAL_AVISO_FILAS_CORRIDA` **se queda en 20000,
provisional y no medida**, y los tres guardias siguen verdes sin tocar ninguna aserción ajena.

**Efecto sobre la 174:** hereda el requisito entero **más** el tercer anclaje descubierto aquí, y
tendrá que pedir autorización explícita para **editar aserciones de guardias ajenos** —no basta con
tocar allowlists—. Todo el material está en `RETIRADO-R34.md`.

**R35.** El sistema DEBE quedar cerrado solo con una **corrida real medida**: backfill sobre un
rango real de la base local, `--verificar` a continuación contra el reporte de esa corrida, y la
evidencia (fechas, filas, ms por fecha y totales) pegada en `progress/backfill_125.md`. La medición
DEBE tomarse sobre una base **sin drift de migraciones**, comprobado antes de medir.

---

## Trazabilidad `R<n>` → test

Archivos de test previstos:
`P` = `tests/unit/analytics/backfill-rango.test.ts` ·
`S` = `tests/unit/services/analitica-backfill-service.test.ts` ·
`C` = `tests/unit/scripts/backfill-analitica-cli.test.ts` ·
`G` = `tests/unit/analytics/backfill-guards.test.ts` ·
`I` = `tests/integration/db/analytics-daily-backfill.test.ts`

| R | Test que lo cubre |
|---|---|
| R1 | `C` › «importar el script no ejecuta nada; solo se auto-ejecuta como entrypoint» |
| R2 | `G` › «censo: ningún archivo bajo app/api, lib/services/jobs ni con "use server" referencia el backfill» |
| R3 | `S` › «la corrida completa se ejecuta con agregador, reloj y salida falsos, sin Prisma» |
| R4 | `G` › «los archivos de la 125 no contienen queryRaw, prisma.<modelo> ni el nombre de ninguna tabla de analítica» |
| R5 | `G` › «la feature no añade carpetas bajo db/migrations, no modifica db/schema.prisma y no menciona las cinco tablas de dinero» |
| R6 | `C` › «--desde 2026-07-20 --hasta 2026-07-22 produce un plan de 3 fechas» |
| R7 | `C` › «sin rango, con desde>hasta y con 2026-13-01 sale ≠ 0 y hace 0 llamadas al agregador» |
| R8 | `P` › «el plan sale de fecha-cr» + `G` › «0 imports de @/lib/analytics/ranges en los archivos de la 125» |
| R9 | `P` › «cruza fin de mes, fin de año y bisiesto; N fechas ascendentes y sin repetidos para N días» |
| R10 | `P` › «con el reloj inyectado rechaza el rango que incluye hoy CR o mañana CR, nombrando la fecha ofensora» |
| R11 | `S` › «una llamada por fecha, en orden ascendente, y ninguna fuera del rango» |
| R12 | `I` › «dos pasadas seguidas sobre el mismo rango: la segunda da filasRetiradas 0 y el mismo filasEscritas» |
| R13 | `S` › «una fecha que lanza no detiene el rango: se marca fallida, se sigue y el código final es ≠ 0» |
| R14 | `S` › «N fallos consecutivos abortan la pasada y el resumen dice cuántas fechas quedaron sin procesar» |
| R15 | `S` › «las llamadas al agregador no se solapan y el servicio no retiene más de una fecha de detalle» |
| R16 | `S` › «con pausa 50 ms espera entre fechas con el reloj falso; con el default no espera» |
| R17 | `S` › «cada fecha emite una línea con fecha, filasEscritas, filasRetiradas, ms y clasificación» |
| R18 | `S` › «el resumen trae los siete campos y una fecha fallida fuerza código ≠ 0» |
| R19 | `C` › «el reporte escrito se relee y contiene una entrada por fecha, sin ids de zona, tienda, mensajero, estatus ni orden» |
| R20 | `P` › «toda fecha anterior a la constante de horizonte se clasifica no comparable» + `G` › «el horizonte se declara una sola vez y su comentario cita la migración» |
| R21 | `S` › «una fecha no comparable se pasa igual al agregador y su ResumenCorrida se reporta sin modificar» |
| R22 | `S` › «una fecha bajo horizonte con cero filas y una fecha comparable con cero filas producen salidas distinguibles» |
| R23 | `S` › «--verificar compara el resumen de la segunda pasada contra el reporte previo, fecha a fecha» |
| R24 | `C` › «--verificar sin reporte previo, y con un reporte que no cubre el rango, sale ≠ 0 con 0 llamadas al agregador» |
| R25 | `S` › «clasifica estable, cambiada, no_comparable y fallida, y sale ≠ 0 solo con cambiada o fallida» |
| R26 | `C` › «el eco de --verificar dice que la verificación escribe» |
| R27 | `C` › «el eco trae host, puerto, base, modo, rango, número de fechas y no comparables, y no imprime la contraseña de la URL de prueba» |
| R28 | `C` › «sin confirmación no hay llamadas al agregador; con confirmación y rango reintroducido distinto sale ≠ 0 sin llamadas» |
| R29 | `G` › «0 literales de URL de conexión en los archivos de la 125» + `C` › «ninguna salida contiene el usuario ni la contraseña» |
| R30 | `C` › «por defecto imprime fecha + nombre del error + etapa y no el mensaje crudo; con --verboso imprime el error completo» |
| R31 | `S` › «el error registrado nombra la fecha» + `G` › «0 catch vacíos en los archivos de la 125» |
| R32 | `G` › «el guardia detecta sus fixtures sintéticos: uno legítimo y dos infractores» |
| R33 | `G` › «la 125 no toca los módulos del escritor de la 124 salvo lib/config/analitica-rollup.ts» |
| ~~R34~~ | **RETIRADO a la ficha 174.** No cuenta en la cobertura de la 125. Ver `RETIRADO-R34.md` |
| R35 | `I` › «backfill de un rango real de la base local, seguido de --verificar, deja todas las fechas estables» + evidencia en `progress/backfill_125.md` |

**Cobertura tras la enmienda: 34 requisitos vigentes, 34 con test nombrado (34/34). Ninguno sin
test.** R34 sale del denominador porque sale de la feature, no porque se dé por cubierto. El resto
del párrafo se conserva como estaba escrito antes de la enmienda:

**Cobertura (redacción original):** 35 requisitos, 35 con test nombrado. Ninguno sin test. **Reducción respecto de la
versión anterior: de 45 a 35 (−22 %)**, y la reducción real de *alcance* es mayor que la de
numeración: los 12 requisitos de agregador (R39–R45 y R35–R37 antiguos) desaparecen y en su lugar
entran requisitos de **consumo, clasificación y observabilidad**, que son mucho más baratos.

---

## Limitaciones declaradas

**L1 — Bajo el horizonte no se pierde solo el embudo: se pierde TODO. (Hallazgo nuevo, verificado.)**
La decisión D4 (⧗Q4 → c) se tomó suponiendo que para fechas anteriores a 2026-07-13 se podrían
calcular «solo las medidas de flujo» con `ordenes_estado_stock = 0`. **Contra la 124 entregada eso
no es así.** Las cinco consultas del repositorio (`contarOrdenesCreadas`,
`contarOrdenesEnEstadoAlCorte`, `contarGestionesVigentes`, `listarEntregasVigentes`,
`acumularCiclosCerrados`) hacen `JOIN estatus_al_corte`, la CTE que exige **al menos una fila de
`orden_historial_estado` con `created_at < corte`** (`AnaliticaRollupRepository.ts`, líneas 110-119
y sus cinco usos). Una orden sin historial anterior al corte **no entra en ningún cubo**. Como la
migración del historial no backfilleó nada, para toda fecha anterior al 2026-07-13 el resultado es
**cero filas en todas las medidas**, no «flujo sí, stock no». `totalesDeControl` aplica el mismo
`EXISTS` (líneas 345-348), así que la reconciliación compara 0 contra 0 y **la corrida termina en
éxito**: el backfill no falla, simplemente no produce nada. Consecuencias aceptadas:
- La categoría «no comparable» se aplica a **la fecha entera**, no a una medida.
- **No se entrega** ninguna corrección de esto: rescatar el pasado exigiría reconstruir historial
  sintético, que es escribir dominio, y R4 de la 124 lo prohíbe al escritor.
- Existe además una **penumbra**: para fechas *posteriores* al horizonte, las órdenes que ya
  existían y **no volvieron a transicionar** siguen sin `estatus_al_corte` y siguen invisibles. El
  ancho de esa penumbra **no está medido** y esta feature no lo mide.

**L2 — La verificación es por DÍA, no por cubo.** `ResumenCorrida` declara explícitamente que no
lleva ids ni PII (`IAnaliticaRollupService.ts`, líneas 7-11), y el guardia de frontera de la 124
prohíbe **cualquier lectura** de `analytics_daily` fuera de `sumarMedidasEscritasDeFecha`
(`tests/integration/db/analytics-daily-guards.test.ts`, `LECTURAS` + `REPOSITORIO_ESCRITOR`). Por
tanto el modo `--verificar` **no puede decir qué cubo cambió**: solo puede decir que la fecha
cambió, con `filasEscritas`/`filasRetiradas` como señal. Un diff por cubo exigiría un lector nuevo
del rollup: es trabajo de la **126**, no de esta feature.

**L3 — La seudonimización de D9 queda vacía de contenido, y se dice.** No hay ids que seudonimizar:
el material del reporte son fechas y conteos. La única vía por la que un id de catálogo puede llegar
a un log es el **mensaje de `PrimerIntentoIncoherenteError`**, que incluye la clave del cubo
(`IAnaliticaRollupService.ts`, líneas 55-67). Por eso D9 se cumple **no construyendo un
seudonimizador que sería código muerto**, sino por R30: por defecto no se imprime el mensaje crudo
del error, y `--verboso` sí. Cualquier lectura de D9 que espere un mapa de seudónimos no se cumple
en esta entrega.

**L4 — La marca de «no comparable» no viaja en la base.** Vive en el progreso, el resumen y el
reporte de la corrida. Un lector que consulte `analytics_daily` sin conocer la constante seguirá
viendo la ausencia de filas como un día vacío corriente. Llevar la marca a la tabla exigiría
migración, que R5 excluye.

**L5 — El script se corre a mano contra producción.** No hay guarda de host que lo impida (a
diferencia de `scripts/rollup-analitica-manual.ts`, que aborta fuera de `localhost`): D8 decidió
que producción es un destino **legítimo** para esta herramienta. Lo que contiene el modo de fallo es
humano y está en R27/R28: eco de la base y del rango, y reintroducción literal del rango.

**L6 — La ficha de la 124 en `feature_list.json` sigue diciendo `"status": "in_progress"`** en el
árbol a `5314a2a8`, pese a que su código está mergeado. Es bookkeeping pendiente del leader; esta
spec no edita la ficha, y **manda el código verificado**, no la ficha.

**L7 — `UMBRAL_AVISO_FILAS_CORRIDA` sigue siendo provisional y no medida al cerrar la 125.** *(Nueva,
enmienda del 2026-08-02.)* La 125 prometía sustituirla (R34) y **no lo hace**: la corrida real no
produjo un dato que autorice una cifra de producción (D5). La constante queda en `20000` con su
comentario intacto y **los tres anclajes de la cifra siguen exactamente donde estaban**. Consecuencias
aceptadas:
- El aviso de volumen del job de la 124 sigue siendo decorativo: nada se rechaza ni se trunca por
  superarlo, así que el riesgo operativo de dejarlo provisional es **un log poco informativo**, no un
  comportamiento incorrecto.
- Quien lea `lib/config/analitica-rollup.ts` verá que el comentario sigue remitiendo a «la feature
  125» como quien fijará el número. **Eso ya no es cierto**: es la **174**. La 125 no corrige ese
  comentario porque corregirlo es tocar el archivo por un motivo que R33 no autoriza y, sobre todo,
  porque la redacción definitiva depende de la cifra que la 174 decida.
- La deuda queda **nombrada y con dueño** (ficha 174), no diluida.

---

## Decisiones cerradas — puerta T0 · 2026-08-02

> Reescritas contra la 124 **entregada**. Donde una decisión del 2026-08-01 se apoyaba en «el
> agregador no existe», se dice explícitamente qué cambió.

**D1 (⧗Q1 → la 125 CONSUME el agregador). Cambia respecto del 2026-08-01.**
La 124 está entregada: `agregarFecha` es idempotente, todo-o-nada, y un día sin datos termina en
éxito con cero filas. La 125 es **iterador de fechas + horizonte + modo verificar + runbook +
observabilidad de la corrida larga**.
*Consecuencia aceptada:* el alcance **se reduce mucho**. Todos los requisitos que la versión
anterior añadía para definir el agregador (semántica de medidas, coordenadas, `seg_ciclo`,
`primer_intento_ok`, contrato propio) **se eliminan**: duplicarlos crearía dos definiciones capaces
de divergir. `depends_on: 124` **vuelve a ser correcto**.
*Propagación:* R4, R11, R21 y el §2 de `design.md`.

**D2 (⧗Q2 → resuelta aguas arriba; la 124 no se toca). Cambia respecto del 2026-08-01.**
`escribirFecha` hace upsert + retirada de rancias + reconciliación **en una sola transacción** y
devuelve `filasRetiradas`. **Verificado en código y en test**: `retirarFilasRancias` borra
`WHERE fecha = ? AND updated_at < marcaCorrida`, con `marcaCorrida = now()` de Postgres tomado al
inicio de la transacción, así que las filas que esta corrida reescribió (cuyo `updated_at` **es**
esa marca) sobreviven y las que no reescribió desaparecen
(`AnaliticaRollupRepository.ts`, líneas 417-489). El comportamiento está medido, no solo declarado,
en `tests/integration/db/analytics-daily-job.test.ts`: «el cubo cuya única gestión se anula
desaparece» (`filasRetiradas === 1`, línea 817) y «dos corridas seguidas dejan el mismo conjunto»
(`filasRetiradas === 0`, línea 785). **La retirada de rancias hace lo que su nombre promete.**
*Consecuencia aceptada:* la 125 **no** implementa `DELETE + INSERT` por fecha; el borrado de cubos
que dejan de existir ya está resuelto aguas arriba y **sin dejar el día vacío para un lector
concurrente**, que era el coste de la opción anterior.

**D3 (⧗Q3 → a) — El backfill no puede incluir el día CR en curso.** Sin lock compartido con la 124.
*Consecuencia aceptada:* el día de hoy no se corrige hasta mañana; el último recomputable es ayer CR.
Nótese que `validarFechaInvocacionManual` de la 124 **sí admite hoy**: el backfill es más estricto
que la invocación manual, a propósito.
*Propagación:* R10.

**D4 (⧗Q4 → c) — Bajo el horizonte se procesa igual y se etiqueta.** Se conservan la constante única
de horizonte, la marca por fecha y la cuarta categoría «no comparable» en `--verificar`. **Lo que
cambia:** el cero no es solo de `ordenes_estado_stock` sino de **todas** las medidas (ver L1), y la
125 no lo fuerza: se limita a etiquetar lo que el agregador devuelve.
*Propagación:* R20, R21, R22, R25, L1.

**D5 (⧗Q5 → c) — Medir primero, fijar el tope después.** Esta entrega no trae tope de días por
invocación; lo que acota el radio de daño es la pausa (R16), el corte por fallos consecutivos (R14)
y la confirmación (R28). La 124 ya registra `filasEscritas` y `ms` por corrida y su `status_note`
deja una primera medición local (~20 filas y ~1 s por fecha, **sin extrapolar a producción**): esa
cifra se sustituye por la medida en R34/R35, no se adivina.
*Propagación:* R16, R34, R35.
*Enmienda 2026-08-02:* **D5 sigue vigente y es justo lo que respalda la retirada de R34.** La medición
de R35 se hizo (58 órdenes, pico de 24 filas/fecha) y **no autoriza ningún umbral de producción**:
llegar de 24 a una cifra de producción exige un multiplicador que nadie midió, o sea, adivinar. D5
dice «medir primero, fijar el tope después»; lo medido **no alcanza** para fijar el tope, así que el
tope no se fija en esta feature. La propagación de D5 hacia R34 se traslada a la **174**; hacia R16 y
R35 se mantiene intacta.

**D6 (⧗Q6 → retirada).** La 124 ya importa `lib/analytics/rollup-dia.ts` desde `interfaces` y
`repositories` y resolvió por su cuenta la colisión con el guardia R18 de la 122 (exención nominal
de un solo archivo, `alcance-obligatorio.guardia.test.ts`, línea 151). La 125 **hereda** esa
solución y **no necesita evitar** `@/lib/analytics/`.
**Verificado:** el guardia solo marca a un archivo de `lib/{repositories,services,actions}` que, a
la vez, (a) importe algo de `lib/analytics/` **y** (b) consulte una tabla de analítica sin nombrar
`ConsultaAnalitica` — `violacionDeAlcanceObligatorio`, **líneas 95-101**: la línea 99
(`if (!tabla) return null;`) es la que salva a los archivos de la 125, porque ninguno consulta
tablas (R4). **Los archivos que la 125 añade NO disparan el guardia.**
*Consecuencia aceptada:* si algún archivo de la 125 llegara a consultar una tabla de analítica, el
guardia se pondría rojo **y con razón**; la salida no sería una exención, sería quitar la consulta.

**D7 (⧗Q7 → b) — El modo de borrado de rango NO se entrega.**
*Consecuencia aceptada, con todas las letras:* corregir un rango se hace recomputándolo, y con la
retirada de rancias de D2 eso ya borra los cubos sobrantes; pero **si un rango simplemente ya no
debe existir, recomputarlo no lo vacía** y no queda forma soportada de vaciarlo con esta
herramienta. Habría que hacerlo por SQL manual o entregar el modo en una feature posterior.
*Propagación:* «Fuera de alcance».

**D8 (⧗Q8 → a) — Se ejecuta desde la máquina del humano con `DATABASE_URL` de producción exportada a
mano.** El patrón de `scripts/rollup-analitica-manual.ts` (abortar si no es `localhost`) **no se
copia tal cual**, porque aquí producción es el destino legítimo; sí se copia su estructura: guardas
**antes** de abrir la base, `console.error` + `process.exit(1)`, y ni una línea de agregación en el
script.
*Propagación:* R27, R28, R29, L5 y el runbook de `tasks.md` T7.

**D9 (⧗Q9 → b) — Ids seudonimizados por defecto, `--verboso` para verlos.** Cumplida en la forma que
el material permite: ver L3. R30 es su expresión operativa.

**D10 (⧗Q10 → a) — La corrida real medida es requisito de cierre.** R35, con saneo previo de la base
local (drift de migraciones) descrito en el runbook.

---

## Fuera de alcance (declarado)

- **El agregador y el job diario**: son de la **124**, entregada. Esta feature no los redefine ni los
  reprograma.
- **Modo de borrado de rango**: retirado por D7, con el hueco escrito arriba.
- **Diff por cubo en la verificación**: imposible sin un lector del rollup; es de la **126** (L2).
- **Corregir el pasado anterior al horizonte**: no se entrega (L1).
- **Retención y purga de `analytics_daily`**: sigue siendo follow-up de D5 de la 123.
- **Tope de días por invocación**: se redacta con dato, después de R35 (D5).
- **E2E: no aplica.** `CHECKPOINTS.md` exige E2E para flujos críticos *en ejecución de usuario*;
  esto es un script de operador sin camino de UI. El riesgo que un E2E cubriría se cubre por vía más
  fuerte: `--verificar` (R23–R26) y la corrida real medida (R35).

---

## Contradicciones detectadas — estado tras la puerta

1. **La ficha de la 125 se contradice a sí misma**: `depends_on: 124` frente a «Depende de 123», y
   llama «(123)» al job diario, que es la 124. → **Resuelta**: manda `depends_on: 124`, que además
   es lo correcto con la 124 entregada. El texto de `feature_list.json` lo corrige el leader; esta
   spec no edita la ficha.
2. ~~«La 124 es dependencia y sigue `pending`; el agregador no existe»~~ → **MUERTA al mergear la
   124.** Era la premisa central de la spec del 2026-08-01 y hoy es falsa.
3. ~~«La 123 R35 delega en la 125 la semántica de escritura, y el `upsert` de la ficha no borra
   cubos que dejan de existir»~~ → **MUERTA**: resuelta aguas arriba por la retirada de rancias de
   la 124 (D2), verificada por test.
4. **«Recomputa sobre toda la data existente» vs «por rango de fechas»** → **Resuelta**: manda el
   rango explícito obligatorio (R6/R7), acotado además por el horizonte (D4) y por la prohibición
   del día en curso (D3).
5. **El horizonte histórico limita lo que «toda la data existente» puede significar** → **Vigente y
   agravada**: ver L1. Ninguna spec heredada mencionaba este límite; esta sigue siendo la primera
   que lo escribe, y ahora además con el alcance correcto (todas las medidas, no solo el embudo).
6. **El guardia de alcance de la 122 no distingue lectores de escritores** → **Vigente, y ya no es
   problema de esta feature**: la 124 lo resolvió con una exención nominal para su repositorio. La
   nota se conserva a propósito: la sección «avisos dirigidos» de la 122 avisa a la **126/127/134**
   y **nunca nombró a la 124 ni a la 125**, que son las que chocaron primero.
7. **La 124 admite recomputar «hoy» por invocación manual y la 125 no** → **Deliberado, no es un
   error**: son dos herramientas con dueños distintos del mismo día (D3).
8. **R33 y R34 son mutuamente incompatibles** *(detectada por el reviewer, 2026-08-02; único
   bloqueante del rechazo)*. R33 autoriza tocar el archivo de configuración y el **allowlist**
   `AJENAS_A_R47`; R34 obliga además a editar una **aserción** de un guardia ajeno
   (`rollup-guards.test.ts`, caso (a), líneas 710-738, que exige literalmente «PROVISIONAL» y «NO
   MEDIDA»). No hay forma de cumplir los dos. → **Resuelta por decisión humana: R33 se queda tal cual
   —es el que se cumplió— y R34 se RETIRA a la ficha 174.** Se descartó la salida contraria
   (ensanchar R33 para autorizar aserciones ajenas) porque habría convertido un permiso quirúrgico y
   auditable en una licencia genérica para editar los tests de otra feature, y porque el dato que
   R34 necesita **tampoco existe** (D5): habría comprado el permiso para nada. Detalle en
   `RETIRADO-R34.md`.
