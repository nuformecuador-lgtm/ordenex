# Feature 196 — Snapshot diario del ranking de mensajeros

**Requisitos en notación EARS.** Sin detalles de implementación (esos van en `design.md`).
Cada `R<n>` termina mapeado a un test concreto (`docs/specs.md > Trazabilidad`); el mapa
vive en `design.md §8` y lo verifica el reviewer.

> **Punto de partida, verificado en el código (no supuesto).**
>
> - `IRankingService.obtenerRanking(actor, now?)` calcula el ranking del **día en curso** y
>   **no persiste nada** — `lib/interfaces/services/IRankingService.ts:24`.
> - El criterio de orden vive hoy dentro de `RankingService.obtenerRanking`:
>   `pct desc → entregadas desc → nombre asc`, con los de `pct` indefinido al final
>   — `lib/services/RankingService.ts:105-114`.
> - El podio lo ocupan los tres primeros **elegibles** (`pct` definido y
>   `asignadas >= MIN_ASIGNADAS_PODIO`); el resto se **lista** sin posición
>   — `lib/services/RankingService.ts:124-131`, `lib/config/ranking.ts`.
> - `premio_ranking` guarda **configuración** de premios (3 posiciones, monto nullable,
>   descripción), no resultados — `db/schema.prisma:1409`.
> - La ventana del día es la de Costa Rica, `[fecha+06:00Z, fecha+1+06:00Z)`
>   — `lib/utils/fecha-cr.ts:106-119`. `toISOString` está prohibido para esto.
> - `analytics_daily` agrega por `fecha × zona × tienda × mensajero × estatus × causa`,
>   pero **no** por las dos magnitudes que ordenan el ranking (`entregadas del día` sobre
>   `órdenes asignadas ese día`): su columna `entregas` cuenta gestiones y no existe
>   ninguna columna de «asignadas» — `db/migrations/20260731120000_analytics_daily/migration.sql:64-81`.
> - El patrón de cron vivo es `app/api/cron/corte-diario/route.ts` (Bearer `CRON_SECRET`
>   antes de cualquier efecto) y `vercel.json` declara las programaciones.
> - La descarga de listados ya existe: `DataTable.descarga` + `filasLocales` +
>   `construirDescarga`/`buildXlsxRows`. `/ranking` ya la usa
>   — `app/(app)/ranking/_components/RankingModule.tsx:123-127`.

## Glosario (vocabulario cerrado, para que los requisitos no se interpreten)

- **Fecha CR**: fecha calendario de Costa Rica (`YYYY-MM-DD`), UTC−6 fijo.
- **Día D−1**: la fecha CR del día anterior al instante de la ejecución.
- **Congelar**: escribir en almacenamiento propio, de forma inmutable, el resultado del
  ranking de una fecha CR ya cerrada.
- **Snapshot**: el conjunto formado por **una cabecera** de una fecha CR y sus **filas**.
- **Fila**: el resultado congelado de un mensajero en esa fecha.
- **Actividad**: en la fecha CR, el mensajero tiene al menos una entrega vigente contada
  por el ranking, o al menos una orden asignada contada por el ranking (`entregadas > 0`
  **o** `asignadas > 0`).
- **Elegible para podio**: `pct` definido (`asignadas > 0`) **y**
  `asignadas >= MIN_ASIGNADAS_PODIO`.
- **Podio**: las posiciones 1, 2 y 3, que ocupan los tres primeros elegibles.
- **Puesto**: la posición del mensajero en la lista completa congelada (1..N), exista o no
  podio.
- **Ranking en vivo**: lo que hoy devuelve `obtenerRanking` para el día en curso.
- **Histórico**: la superficie de consulta de snapshots ya congelados.
- **Actor lector**: usuario con rol de acceso total (`maestro`/`admin`) o rol `mensajero`.

---

## A. Congelado del día (el cron)

**R1** — El sistema DEBE persistir, por cada fecha CR congelada, **una cabecera única** que
guarde: la fecha CR, el instante de generación, el umbral mínimo de asignadas aplicado y el
número de filas congeladas.

**R2** — CUANDO se ejecuta el congelado en el instante `T`, el sistema DEBE congelar la
fecha CR **D−1** respecto de `T`, y ninguna otra.

**R3** — El sistema DEBE producir las filas con **exactamente el mismo criterio de orden y
de podio** que el ranking en vivo: mismas magnitudes, mismo umbral y misma regla de podio.

**R4** — El criterio de orden DEBE ser **totalmente determinista**: dos ejecuciones sobre
los mismos datos DEBEN producir el mismo orden, incluso cuando dos mensajeros empatan en
porcentaje, en entregadas y en nombre.

**R5** — El sistema DEBE congelar **una fila por mensajero con actividad** en esa fecha. Un
mensajero sin actividad NO DEBE producir fila.

**R6** — Cada fila congelada DEBE guardar: el **puesto** en la lista completa, la **posición
de podio** (1–3) o su ausencia, el **identificador** del mensajero, su **nombre tal como
estaba al congelar**, las **entregadas** y las **asignadas** de esa fecha.

**R7** — SI una fila ocupa posición de podio Y esa posición tiene premio configurado en el
instante del congelado, ENTONCES la fila DEBE guardar el **monto** y la **descripción** de
ese premio.

**R8** — SI una fila NO ocupa posición de podio, ENTONCES DEBE quedar **sin premio
congelado** (monto y descripción ausentes).

**R9** — MIENTRAS un mensajero no alcance el umbral mínimo de asignadas, el sistema DEBE
listarlo con puesto pero NO DEBE asignarle posición de podio (paridad con R7 de la
feature 76).

**R10** — El sistema NO DEBE congelar el porcentaje ya calculado: DEBE conservar numerador
y denominador, y el porcentaje mostrado DEBE derivarse de ellos con el **mismo redondeo**
que el ranking en vivo.

**R11** — SI ningún mensajero tuvo actividad en la fecha, ENTONCES el sistema DEBE persistir
la **cabecera con cero filas** (nunca la ausencia de cabecera).

**R12** — SI la fecha ya tiene snapshot, ENTONCES una nueva ejecución NO DEBE crear, alterar
ni borrar nada, y DEBE reportar que la fecha se **omitió** por estar ya congelada.

**R13** — El sistema DEBE impedir **por restricción de base de datos** que existan dos
cabeceras de la misma fecha, dos filas del mismo mensajero dentro de un snapshot, dos filas
con el mismo puesto y dos filas con la misma posición de podio.

**R14** — SI el congelado falla a mitad, ENTONCES la fecha DEBE quedar **sin cabecera y sin
filas**: no existe snapshot parcial.

**R15** — El sistema NO DEBE ofrecer forma de congelar una fecha distinta de D−1: la
ejecución NO DEBE admitir la fecha por parámetro (sin backfill, decisión humana 3).

**R16** — CUANDO un mensajero cambia de nombre después del congelado, el histórico DEBE
seguir mostrando el nombre **congelado**, no el actual.

**R17** — El sistema DEBE impedir que se borre un usuario que tiene filas congeladas, de
modo que ningún snapshot quede huérfano.

**R18** — El congelado NO DEBE modificar ninguna tabla preexistente: solo escribe en las
tablas nuevas del snapshot.

## B. Endpoint del cron

**R19** — CUANDO llega una petición al endpoint del cron sin el secreto correcto (ausente,
mal formado, distinto o no configurado en el entorno), el sistema DEBE responder **401** y
NO DEBE producir efecto alguno.

**R20** — CUANDO el congelado termina bien, el sistema DEBE responder **200** con la fecha
congelada, el estado (`creado` u `omitido`) y el número de filas, **sin datos personales**.

**R21** — El sistema NUNCA DEBE emitir el secreto del cron ni datos personales en la
respuesta ni en los registros de error.

**R22** — SI el congelado falla, ENTONCES el sistema DEBE responder con error y DEBE
registrar el fallo por el canal de errores del repo (no fallar en silencio).

**R23** — La programación del cron DEBE estar declarada en UTC y corresponder a una hora de
**madrugada de Costa Rica posterior al cambio de fecha CR**, y DEBE ser independiente de la
programación del corte diario (decisión humana 2).

**R24** — El histórico DEBE permitir distinguir que el cron corrió: la cabecera de una fecha
DEBE llevar el instante de generación y ese instante DEBE ser visible en la consulta.

## C. Consulta del histórico

**R25** — CUANDO un actor lector solicita el histórico de una fecha que tiene snapshot, el
sistema DEBE devolver **todas** sus filas en el **orden congelado**, sin reordenarlas ni
recalcular posiciones.

**R26** — SI la fecha solicitada no tiene cabecera, ENTONCES el sistema DEBE responder
«no se generó snapshot de esa fecha», y SI tiene cabecera con cero filas, ENTONCES DEBE
responder «ese día no hubo actividad»: los dos casos DEBEN ser distinguibles.

**R27** — MIENTRAS el usuario no sea actor lector (otro rol o sin sesión), el sistema NO
DEBE exponer dato alguno del histórico.

**R28** — El rol `mensajero` DEBE ver el histórico **completo** de cualquier fecha en solo
lectura, sin recorte a sus propias filas (decisión humana 4).

**R29** — El histórico DEBE ser de SOLO LECTURA: ninguna superficie del sistema DEBE
permitir crear, editar ni borrar filas ni cabeceras congeladas.

**R30** — SI la fecha solicitada no es una fecha calendario `YYYY-MM-DD` válida, ENTONCES el
sistema DEBE rechazar la petición **sin consultar** el almacenamiento.

**R31** — Los montos y el porcentaje DEBEN cruzar del servidor al cliente como **cadenas ya
formateadas** (paridad con R12 de la feature 76): el cliente no recibe decimales de la base
ni recalcula montos.

## D. Descarga

**R32** — CUANDO el actor lector activa la descarga del histórico, el sistema DEBE producir
un archivo con **exactamente** las filas mostradas y en el **mismo orden**.

**R33** — La descarga DEBE reusar el generador de descargas existente y su tope común de
filas; SI se supera el tope, ENTONCES NO DEBE producirse archivo y DEBE mostrarse un
mensaje accionable.

**R34** — El archivo NO DEBE contener identificadores internos del mensajero; la fila se
identifica por su nombre congelado.

**R35** — El nombre del archivo descargado DEBE identificar la **fecha consultada**.

## E. No regresión y esquema

**R36** — `obtenerRanking` (en vivo) y `editarPremio` DEBEN conservar su comportamiento
actual: mismos resultados, mismo orden, misma autorización y misma serialización.

**R37** — La migración DEBE ser **aditiva** (no altera, renombra ni borra nada preexistente)
y DEBE traer su `down.sql`, que restaura exactamente el esquema previo.

**R38** — Las tablas nuevas DEBEN tener **RLS habilitada**, siguiendo el criterio del repo
para tablas con datos de personas.

---

## Preguntas abiertas

**Ninguna.** Las cinco se cerraron en la puerta humana del **2026-08-10**: Q1, Q2 y Q3 las
respondió el humano confirmando el default propuesto; Q4 y Q5 quedan adoptadas por defecto sin
objeción. El detalle de cada una se conserva abajo como registro de la decisión y de su coste,
que es lo que hay que releer si algún día el coste se materializa.

### Decisiones cerradas (2026-08-10)

- **Q1 → se reusa el criterio del ranking en vivo tal cual (R3).** Un mensajero desactivado
  entre el día D y la corrida NO aparece en el snapshot de D. **Coste aceptado y consciente:**
  si ese mensajero ocupaba podio, el podio congelado NO coincidirá con el que se vio en
  pantalla ese día. Se elige una sola regla de universo —la del vivo— sobre la fidelidad del
  caso borde.
- **Q2 → el premio se congela tal como esté vigente en el instante de la corrida.** `premio_ranking`
  no tiene historia y no existe forma de saber qué premio regía a las 23:59 CR del día D. La
  cabecera guarda el instante de generación (R24), que deja el desfase auditable. Ventana real
  de riesgo: las ~2 horas entre el cambio de fecha CR y la corrida. Cerrarla exigiría versionar
  `premio_ranking`, que es otra feature.
- **Q3 → rehacer una fecha ya congelada queda FUERA DE ALCANCE.** R12 mantiene la reejecución
  como no-op. Rehacer una fecha exige intervención deliberada en base de datos, igual que el
  backfill descartado en la decisión humana 3. El histórico es inmutable por diseño.
- **Q4 → la descarga acompaña a la tabla para TODOS los actores lectores**, incluido el rol
  `mensajero`. Es lo que ya ocurre en `/ranking` en vivo (`RankingModule.tsx:123`); restringirla
  al acceso total sería una asimetría nueva sin motivo.
- **Q5 → no se purga el histórico.** El volumen es de una fila por mensajero activo y día
  (decenas de filas diarias). Si algún día hace falta retención, será una decisión propia.

### Registro original de las preguntas

Cada una lleva el **valor por defecto** que el spec adoptó. Están aquí porque el dato no estaba
en el código, en `docs/` ni en el encargo, y `CLAUDE.md > No inventes` obliga a marcarlo en vez
de rellenarlo.

**Q1 — Mensajero desactivado entre el día y la corrida del cron.** El ranking en vivo solo
considera mensajeros con `estado = "activo"` (`UserRepository.listMensajeros`,
`:144`). El cron corre horas después del día que congela: si un mensajero se desactiva en
esa ventana, reusar el criterio en vivo (R3) lo deja **fuera** del snapshot aunque hubiera
trabajado ese día, y si ocupaba podio, el podio congelado no coincide con lo que se vio en
pantalla. *Default adoptado:* se reusa el criterio en vivo tal cual (R3 manda sobre este
caso borde) y la limitación queda documentada en `design.md §9`. La alternativa —tomar la
unión con los mensajeros con actividad, activos o no— **cambiaría el universo** del ranking
respecto del vivo y por tanto el podio.

**Q2 — Premio vigente: se lee en la corrida, no al cierre del día.** `premio_ranking` no
tiene historia: no existe forma de saber qué premio estaba configurado a las 23:59 CR del
día D. Si un `maestro` edita el premio entre la medianoche y la corrida, se congela el
valor **nuevo**. *Default adoptado:* se congela el premio vigente en el instante de la
corrida y la cabecera guarda ese instante (R24), que hace auditable el desfase. Cerrar la
ventana del todo exigiría versionar `premio_ranking`, que es otra feature.

**Q3 — Reconstrucción deliberada de una fecha ya congelada.** R12 hace la reejecución un
no-op. Si una corrida congelara datos incorrectos (por un defecto propio), hoy no habría
forma de rehacerla desde la aplicación. *Default adoptado:* fuera de alcance; rehacer una
fecha exige una intervención deliberada en base de datos, igual que el backfill descartado
por la decisión humana 3.

**Q4 — ¿La descarga del histórico también para el rol `mensajero`?** La decisión humana 4
dice «ve el histórico completo en solo lectura» y menciona la descarga junto a
`maestro`/admin. *Default adoptado:* la descarga acompaña a la tabla para **todos** los
actores lectores, que es lo que ya ocurre en `/ranking` en vivo hoy
(`RankingModule.tsx:123`); restringirla al acceso total sería una asimetría nueva.

**Q5 — Retención del histórico.** Nadie ha dicho cuánto vive un snapshot. *Default
adoptado:* no se purga; el volumen es de una fila por mensajero activo y día
(orden de magnitud: decenas de filas diarias).
