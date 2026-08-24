# Feature 271 — El segundo cierre se puede solicitar, y acumular dos bloquea

> **LA REGLA, dictada por el humano el 2026-08-23.** Con **N** = cierres del mensajero sin aprobar
> (`solicitado` + `vencido` + `rechazado`) y **V** = cuántos de esos están en `vencido` o `rechazado`:
>
> ### **LIBRE si `N ≤ 1` Y `V = 0`. En cualquier otro caso, BLOQUEADO para gestionar Y para recibir asignaciones.**
>
> Se resuelve **siempre del más viejo al más nuevo**. **El bloqueo alcanza TODO:** ni gestionar, ni
> cobrar, ni recibir trabajo nuevo — **sea reparto o recolección**. Un solo predicado, todas las
> superficies, sin excepciones.
>
> ⚠️ **Q1 resuelta por el humano el 2026-08-23, y REVIERTE un «solo reparto» que llegó a estar
> escrito en este spec.** Palabras textuales: *«Error mío, en realidad no puede recibir recolecciones
> porque son dos tareas diferentes, una cosa es ir a repartir y otra diferente es recoger en tienda,
> un mensajero no puede hacer las dos gestiones, solo una a la vez.»* Si alguien encuentra un resto de
> la excepción de recolección en el código o en la prosa, **es basura de la versión anterior**, no una
> decisión.

---

## Aviso al lector: hubo un intento anterior y se descartó entero

Se especificó antes un modelo de **«un cierre por jornada con columna `fecha_jornada` fija»**. El
humano lo descartó y aquel spec se borró. **No se reintroduce.** Dos razones, y las dos siguen
valiendo:

1. **La reprogramación lo rompía.** Una orden reprogramada se libera con `fecha_reparto = null`
   (`LiberacionReprogramadaRepository.ts:95`) y luego se reasigna a otro día. Derivar la jornada del
   cierre desde `orden.fecha_reparto` dejaba la gestión de hoy —que lleva dinero— colgando de una
   fecha ya movida.
2. **Sobraba.** Con la regla de arriba, **`cierre_id IS NULL` reparte el trabajo solo**: el cierre de
   ayer ya se llevó lo de ayer. Verificado en el código —`CierreDiaRepository.crearCierre` vincula
   con `where: { mensajeroId, cierreId: null, anuladaAt: null }` (`:686`)—, así que **esta ficha no
   necesita ninguna columna de fecha ni ninguna migración de jornada**.

## El caso que la origina, medido en producción

Cierre `79cb2c0f` (Jose): nació `vencido` el **22/08 a las 00:03:15 CR**, pasó a `solicitado` a las
**16:39:05** al re-solicitarlo, y sus **2 gestiones de las 16:56 siguen con `cierre_id` NULL** porque
el corte del 23/08 (200 a las 06:00:27 UTC, **no falló**) no pudo crearle el segundo cierre. Es
dinero cobrado que no tiene cierre al que ir.

## Fuentes leídas para escribir esto (ninguna heredada)

`feature_list.json` (fichas 271 y 272), `progress/current.md` §EN CURSO,
`lib/repositories/OrdenRepository.ts` (`:291-329`, `:3181-3339`),
`lib/repositories/CierreDiaRepository.ts` (`:414-500`, `:520-740`),
`lib/repositories/CorteDiarioRepository.ts` (entero),
`lib/repositories/CierresAdminRepository.ts` (`:80`, `:1399-1470`, `:1700-1730`),
`lib/services/CierreDiaService.ts` (`:140-300`, `:444-600`),
`lib/services/CorteDiarioService.ts` (entero), `lib/services/GuiaAsignacionService.ts` (`:320-400`,
`:418-560`), `lib/services/AsignacionSateliteService.ts` (`:30-170`),
`lib/services/MisAsignacionesService.ts` (`:160-200`), `lib/services/RecoleccionTiendaService.ts`
(`:85-125`), `lib/services/CierresAdminService.ts` (`:60-72`, `:1040-1062`),
`lib/actions/cierre-dia.ts` (`:59-105`), `lib/actions/ordenes-guia.ts` (`:125-216`),
`lib/actions/recepcion-satelite.ts` (`:270-345`), `lib/constants/bloqueo-mensajero.ts`,
`lib/utils/colas-cierre.ts`, `lib/notificaciones/emitir.ts` (`:1-150`, `:400-462`),
`db/schema.prisma` (`CierreDia :1057-1104`, enums de notificación `:2060-2120`),
`db/migrations/20260822140000_notificacion_evento_dia_reparto_corregido/**`,
`app/(app)/cierre-dia/_components/CierreDiaModule.tsx` (`:110-190`, `:560-580`),
`app/(app)/mis-asignaciones/_components/RepartoModule.tsx`, `RecogerModule.tsx`,
`app/(app)/recoleccion/_components/RecoleccionModule.tsx`,
`app/(app)/ordenes/_components/OrdenesListado.tsx` (`:60-100`, `:270-280`),
`app/(app)/_components/FiltrosEntregas.tsx` (`:60-80`),
`tests/unit/services/cierre-bloqueo-asimetria.test.ts`,
`tests/integration/db/cierre-sin-gestion-sql-real.test.ts`, `docs/specs.md`,
`docs/architecture.md`, `docs/conventions.md`.

---

## Vocabulario

| Término | Qué significa aquí |
| --- | --- |
| **cierre abierto** | Fila de `cierre_dia` del mensajero cuyo `estado` es `solicitado`, `vencido` o `rechazado`. `aprobado` es el ÚNICO terminal. |
| **N** | Cantidad de cierres abiertos de UN mensajero. |
| **V** | Cuántos de esos N están en `vencido` o `rechazado`. Subconjunto de N, nunca mayor. |
| **LIBRE** | `N ≤ 1` **y** `V = 0`. |
| **BLOQUEADO** | Cualquier otro caso: `N ≥ 2` **o** `V ≥ 1`. |
| **cierre re-solicitable** | Cierre abierto en `vencido` **o** en `rechazado`. Es el que el mensajero puede volver a enviar a aprobación por su cuenta. Los que suman a V. |
| **gestionar y cobrar** | Entregar, escoger, recoger, deshacer una gestión y recolectar en tienda. Las cinco superficies que hoy consultan `findMensajerosBloqueadosParaGestion`. |
| **recibir trabajo nuevo** | Que alguien le ponga órdenes en la mano. Son **tres** escrituras: reparto desde la bodega central (`GuiaAsignacionService.asignarDesdeBodega`), reparto desde la satélite (`AsignacionSateliteService.asignar`) y recolección en tienda (`GuiaAsignacionService.asignarRecoleccion`, `:418`). **Las tres se bloquean igual.** |
| **la regla de dedicación** | Feature 157, `OrdenRepository.findMensajerosConOrdenesEn`: reparto y recolección **se excluyen mutuamente**, un mensajero hace una tarea o la otra. Es una regla **SEPARADA** de este bloqueo y esta ficha **no la toca**; se nombra porque explica por qué no tiene sentido dejar pasar una de las dos: son la misma jornada de trabajo. |
| **el que toca resolver** | El cierre abierto **más viejo** del mensajero. |
| **el corte** | El cron `/api/cron/corte-diario`, `0 6 * * *` UTC = 00:00 de Costa Rica. |
| **re-solicitar** | Transición `vencido → solicitado` o `rechazado → solicitado`. No crea fila nueva ni recalcula dinero. |
| **la bodega responsable** | Quien resuelve el cierre: `maestro` y `admin` sin alcance, más `adminSatelite` de la zona destino del cierre. Mismo alcance que `CierresAdminService`. |

## Precisiones verificadas en el código, no supuestas

1. **Nada en la base impide dos cierres abiertos.** `cierre_dia` no tiene ningún índice único
   —parcial ni total— sobre `(mensajero_id)` ni sobre `(mensajero_id, estado)`; el `@@index` de
   `schema.prisma:1102` es **no único**. El invariante «un mensajero nunca tiene 2 cierres abiertos»
   (feature 109/R30) vive **sólo en código**, en dos sitios: `CierreDiaService.ts:506` y
   `CorteDiarioRepository.ts:12`. Levantarlo no exige migración.
2. **El reparto del trabajo entre cierres ya está resuelto.** `crearCierre` vincula
   `gestion_orden` con `cierreId: null` (`CierreDiaRepository.ts:686`), y su guarda «algo pasó»
   (`:695`) hace `rollback → null` si no vincula gestiones ni barre órdenes. Es la idempotencia
   R9 de la 41 y esta ficha se apoya en ella sin inventar otra.
3. **Hay TRES escrituras que ponen trabajo en la mano de un mensajero, y sólo se pensaba en una.**
   `GuiaAsignacionService.asignarDesdeBodega` (reparto central),
   `AsignacionSateliteService.asignar` (reparto satélite, `lib/actions/recepcion-satelite.ts:270`) y
   `GuiaAsignacionService.asignarRecoleccion` (`:418`, acción `lib/actions/ordenes-guia.ts:125`).
   **El incidente del 18/08 ocurrió en la segunda**, y la tercera es la que este spec llegó a dejar
   fuera por error. Las tres se tratan igual.
4. **Los selectores son DOS acciones, y una de ellas alimenta TRES consumidores.**
   `listarMensajerosParaAsignacion` (`lib/actions/ordenes-guia.ts:165`) y
   `listarMensajerosSatelite` (`lib/actions/recepcion-satelite.ts:290`). La primera la llama
   `OrdenesListado.tsx:69` **una vez**, y con su respuesta pinta el modal de **reparto**, el modal de
   **recolección** (`conRecoleccionIds`) y `FiltrosEntregas.tsx:72` la usa como **filtro de
   listado**. Los dos modales bloquean; el **filtro no**, porque filtrar no es asignar.
5. **La regla de dedicación ya vive dentro de `asignarRecoleccion`.** Justo debajo del bloque de
   la guarda retirada (`GuiaAsignacionService.ts:468`), esa misma acción consulta
   `findMensajerosConOrdenesEn` para impedir que quien lleva reparto reciba recolección. Reponer
   aquí el bloqueo por cierres **no inventa una política nueva en esa acción**: se suma a una que ya
   estaba, dos líneas más abajo.
6. **El corte diario no emite ninguna notificación.** `CorteDiarioService` no recibe ni llama a
   ningún notificador. Verificado contra producción: **0 filas en `notificacion` a las 00:03 del
   22/08**.
7. **El mensajero no recibe NINGUNA notificación de cierre, nunca.**
   `emitirCierreDiaPorAprobar` (`emitir.ts:441`) emite sólo a `maestro`, `admin` y `adminSatelite`.
   El soporte para dirigir a un usuario **ya existe** (`destinatarioUsuarioId`, XOR con
   `destinatarioRol`, usado por `carga_masiva_terminada` y `dia_reparto_corregido`).
8. **`NotificacionEvento` es inventario CERRADO** (`schema.prisma:2074`): añadir un valor exige
   migración de enum.
9. **La dedupe hace no-op si ya hay una NO LEÍDA** para el mismo `(evento, entidadId, destinatario)`
   (`emitir.ts:92-111`), y por debajo hay un índice único `notificacion_dedupe_key` que
   `NotificacionRepository.crear` absorbe devolviendo `false`.
10. **`rechazado` no está en `ESTADOS_COLA_CIERRE_DIA`** (`lib/utils/colas-cierre.ts:32`): un
    mensajero puede contar N=2 y la administración ver **una sola fila** en su cola.
11. **La administración SÍ puede destrabar un `rechazado`:** `ESTADOS_REABRIBLES = ["vencido",
    "rechazado"]` (`CierresAdminRepository.ts:80`), aunque el método se siga llamando
    `forzarSolicitudVencido`.
12. **`BLOQUEO_AVISO` tiene DOS copias vivas** —`lib/constants/bloqueo-mensajero.ts:23` (dos
    portales) y `CierreDiaModule.tsx:175` (variante sin CTA)— y **las dos afirman «Sí puedes seguir
    recibiendo asignaciones»**, que es falso a partir de esta ficha para las dos clases de trabajo.
13. **El texto de bloqueo de la recolección se queda corto.** `RecoleccionTiendaService.ts:42`
    (`MSG_BLOQUEADO`) dice *«Tenés un cierre pendiente sin resolver»*, que no describe el caso de
    **acumulación** (`N ≥ 2`, `V = 0`): ahí no hay nada «sin resolver» por parte del mensajero.
14. **⚠️ LA FECHA DE NACIMIENTO DE UN CIERRE `vencido` NO ES SU JORNADA. Va un día por delante.**
    Medido contra producción sobre el cierre `79cb2c0f`: `created_at` en hora de Costa Rica es
    **2026-08-22**, y la jornada real —la fecha de sus 3 gestiones vinculadas— es **2026-08-21**. No
    es una anomalía de esa fila: el corte corre a las 00:0x de la madrugada **siguiente** a la
    jornada que cierra, así que **todo** `vencido` nace fechado un día por delante del día que el
    mensajero trabajó. Decirle «resuelve el cierre del 22» a quien trabajó el 21 es exactamente el
    aviso confuso que esta ficha viene a evitar. **Y no hay columna de jornada** —el humano descartó
    ese modelo—, así que la fecha hay que **derivarla**. Ver **R57–R61**.
15. **`gestion_orden.created_at` existe, es el instante en que el mensajero registró la gestión y
    está indexado** (`schema.prisma:884` y `:915`). Es la fuente natural de la jornada.
16. **`cierre_sin_gestion.created_at` NO sirve como jornada** (`schema.prisma:1832`): es el instante
    del barrido, o sea el mismo `now` del corte que ya va desfasado. La tabla de la 264 congela
    guía, remisión, destinatario, producto, tienda, zona y estatus de origen — **ninguna fecha de la
    jornada**.
17. **La re-solicitud elige rama por ESTADO, no por edad.** `solicitarCierre` mira primero
    `existeCierreVencido` y sólo después `existeCierreRechazado` (`CierreDiaService.ts:459` y `:490`).
    Con un `rechazado` viejo y un `vencido` nuevo, hoy resolvería **el nuevo primero**, que contradice
    «del más viejo al más nuevo». Con un solo cierre abierto daba igual; con dos, no. Ver **R18**.

## El caso «dos `vencido`»: se afirmó imposible, se razonó, y la MEDIDA lo desmintió

> ⚠️ **CORREGIDO EL 2026-08-23, DESPUÉS DE MEDIRLO.** Este apartado decía, en mayúsculas, **«DOS
> `vencido` A LA VEZ ES IMPOSIBLE»**, y de esa frase colgaban tres decisiones. El test de integración
> de **T10.3** —la corrida del corte sembrada contra Postgres— lo **desmintió el mismo día**: es
> **raro, pero alcanzable**, y **lo introduce esta ficha**.
>
> **Se deja escrita la historia entera, no sólo el resultado.** La creencia estaba razonada en tres
> pasos, verificada contra el código, copiada a cinco sitios y aceptada por una revisión. Lo único
> que faltaba era ejecutarla. Es exactamente el tipo de afirmación que se copia de un spec a otro sin
> volver a comprobarla, y por eso el razonamiento de abajo se conserva **tal cual, tachado por la
> medida**, en vez de borrarse.

### Lo que se afirmó (razonamiento original, **conservado — y FALSO en su paso 2**)

1. En cuanto un mensajero tiene **un** `vencido`, `V ≥ 1` y queda **BLOQUEADO para gestionar y para
   recibir reparto** (R3). No genera trabajo nuevo: ni gestiones, ni órdenes en la mano.
   → **Sigue siendo cierto.**
2. El corte que creó ese `vencido` ya barrió, **en la misma transacción**, sus órdenes de
   `en_reparto` y `ayuda_tienda` a `sin_gestionar` (`CierreDiaRepository.ts:572-672`), y vinculó sus
   gestiones sueltas (`:686`).
   → 🔴 **AQUÍ SE ROMPE.** El barrido **tiene una excepción desde la feature 246**: una orden
   **reservada para un día posterior NO se barre** (246/R11). El mensajero puede quedar bloqueado
   **con una guía todavía en la mano**.
3. Por tanto, la noche siguiente **no le queda nada que cerrar**: el corte lo evalúa, `crearCierre`
   encuentra 0 gestiones y 0 órdenes que barrer, y devuelve `null` por su guarda «algo pasó» (`:695`).
   → **Falso en el caso de arriba**, y **mal descrito incluso en el caso normal**: ver «el mecanismo
   real» más abajo.

### Lo que se midió (2026-08-23, `tests/integration/db/corte-diario-segundo-cierre-sql-real.test.ts`)

**La protección de la 246 caduca sola** (246/R13): `diaCerrado` avanza una noche y alcanza a la orden
reservada. Entonces el mensajero —**ya bloqueado**— vuelve a entrar por la rama (b) de la selección,
`crearCierre` barre esa orden, `sinGestionarTransicionadas` vale 1, la guarda «algo pasó» **pasa**, y
nace el **segundo `vencido`**.

**Y es alcanzable en producción, no fabricado.** Para que una guía esté en `en_reparto` **con** fecha
futura hay un camino puesto por diseño: **`CorreccionDiaRepartoService`, feature 262**, permite mover
el día de reparto de una orden que **ya está en `en_reparto`** —su `ESTADOS_CON_DIA_DE_REPARTO_VIVO`
lo dice y su comentario llama a esa población *«la que la 261 dejó atrapada: el paquete ya está en la
mano del mensajero»*—. Secuencia completa:

| Paso | Qué pasa | Quién lo habilita |
| --- | --- | --- |
| 1 | Día D: el mensajero recoge una guía → `en_reparto`, `fecha_reparto = D` | — |
| 2 | Día D: bodega la corrige a «mañana» → `fecha_reparto = D+1`, **sigue en `en_reparto`** | **262** |
| 3 | Corte de la noche D→D+1: sus gestiones sueltas lo arrastran al bucle; la guía está **protegida** y no se barre → **`vencido` #1**, bloqueado | **246/R11** |
| 4 | Día D+1: bloqueado, no gestiona. La guía sigue donde estaba | R3 |
| 5 | Corte de la noche D+1→D+2: la reserva **caducó sola**, entra por la rama (b), se barre → **`vencido` #2** | **246/R13** + **271/R21** |

**El paso 5 no ocurría antes de esta ficha**: la exclusión por cierre abierto lo sacaba de la corrida
siguiente. **Es decir: `N=2, V=2` con dos `vencido` lo introduce la 271.**

### Y aun así NO se escribe código defensivo — pero por OTRA razón, y la diferencia importa

Antes se decía «no se programa porque el estado **no existe**». Eso era falso. Se sigue sin programar
nada nuevo porque **el estado ya está cubierto**, que es una razón distinta y verificable:

1. **Es la fila 7 de la tabla de verdad** (`N=2, V=2`) con dos `vencido` en vez de dos `rechazado`.
   La regla general no distingue el estado: cuenta N y V.
2. **La re-solicitud ya lo trata bien, y por el cinturón que se puso «por si acaso».** Cuando se
   arregló **M2** se pidió arreglar **también** su gemelo del `vencido` «aunque dos `vencido` sea
   imposible». Ese cinturón resulta ser **la pieza que sujeta esto**: `transicionarASolicitado` lleva
   el **`id` en el `WHERE`**, así que con dos `vencido` mueve **uno**, el más viejo (**R18**), y no
   escribe-y-reporta-fallo. Si aquella petición no se hubiera hecho, hoy habría un fallo mudo aquí.
3. **El aviso ya lo dice bien.** La rama `v === n` —«Envíalos a aprobación, empezando por el más
   antiguo…», aprobada por el humano— cubre dos `vencido` igual que dos `rechazado`.
4. **El desenlace medido es el correcto.** La orden necesitaba barrido y necesitaba un cierre al que
   ir. Volver a excluir al bloqueado sería reponer el bug de producción (`79cb2c0f`) que esta ficha
   existe para arreglar.

### El mecanismo real del caso normal (también estaba mal escrito)

El paso 3 decía «el corte **lo evalúa** y `crearCierre` devuelve `null` por su guarda». **Medido: no
llega a evaluarlo.** Con el mensajero bloqueado y **nada** suelto, las **dos** ramas de la selección
—gestiones con `cierre_id IS NULL` y órdenes en `en_reparto`/`ayuda_tienda`— vienen **vacías** para
él: no entra en la lista y no entra en el bucle. Es una garantía **más fuerte** que la guarda, y es la
que de verdad corre.

**La guarda «algo pasó» se conserva como la segunda red que es**, y conviene saber dónde está su
prueba: la mata **`tests/unit/repositories/cierre-dia-repository.test.ts`** (4 casos), y **no la cubre
nada en `tests/integration/db`** —medido: con la guarda rota, los 133 archivos de esa carpeta pasan en
verde—, porque por el camino del corte el estado «seleccionado y sin nada que cerrar» no es alcanzable
con datos estáticos.

**Dónde SÍ se acumulan dos cierres re-solicitables: el RECHAZO.** El rechazo es **retroactivo** —cae
sobre un cierre que el mensajero solicitó cuando **no** estaba bloqueado y por tanto pudo solicitar
otro—. Secuencia alcanzable, cuatro pasos:

| Paso | Qué pasa | N | V | Estado |
| --- | --- | --- | --- | --- |
| 1 | Día 1: trabaja y cierra → `solicitado`#1 | 1 | 0 | libre |
| 2 | Día 2: trabaja y cierra → `solicitado`#2 | 2 | 0 | bloqueado, pero el día 2 **ya está cerrado** |
| 3 | El administrador rechaza #1 → `rechazado`#1 | 2 | 1 | bloqueado |
| 4 | El administrador rechaza #2 → `rechazado`#2 | 2 | **2** | **dos cierres re-solicitables** |

Y también es alcanzable la mezcla `{vencido, rechazado}`: `solicitado`#1 → el día 2 no cierra → el
corte crea `vencido`#2 (N=2, V=1) → el administrador rechaza #1 (N=2, V=2).

**Conclusión que va al código:** el caso «dos re-solicitables» existe, y hay que escribirle código
—unificar la re-solicitud sobre la lista entera, eligiendo por **edad** y con el `id` en el `WHERE`—
**sin ramificar por estado**. Es lo que hace **R18/R19**.

> ⚠️ **CORREGIDO EL 2026-08-23.** Aquí decía que el caso «siempre incluye al menos un `rechazado`» y
> que programar para «dos `vencido`» sería programar para un estado inalcanzable. **Lo primero es
> falso** (hay una vía con dos `vencido`: 246 + 262, ver arriba) y **lo segundo sobra**: la solución
> que ya se eligió —elegir por edad sobre la lista de re-solicitables, sin mirar el estado— cubre las
> tres combinaciones sin una sola rama nueva. Es el mejor argumento a favor de haberla elegido, y
> conviene que quede dicho: **la regla general acertó donde el razonamiento falló.**

## Los tres fallos mudos que esta ficha DESPIERTA

Hoy son **inalcanzables** porque el invariante R30 impide dos cierres abiertos. En cuanto se rompa,
son alcanzables el primer día.

- **M2 — la re-solicitud transiciona de más y luego miente. ES EL PRIORITARIO, y muerde por el
  gemelo, no por el original.**
  `transicionarRechazadoASolicitado` (`CierreDiaRepository.ts:479`) es un `updateMany` por
  `(mensajeroId, estado)` **sin `id`**. Con **dos `rechazado`** —los cuatro pasos de arriba—
  transiciona **LOS DOS**, `count` vale `2`, y su `return count === 1` devuelve **`false`**: el
  servicio responde `conflict` y el mensajero lee «no se pudo» **mientras sus dos cierres ya se
  movieron a `solicitado`**. Escribe y reporta fallo.
  `transicionarVencidoASolicitado` (`:454`) tiene la **forma idéntica**. Se corrige igual —misma
  unificación— y **sin escribirle un caso de test propio**.
  > ⚠️ **CORREGIDO EL 2026-08-23:** aquí decía que su caso de dos era «inalcanzable por el invariante
  > derivado de arriba», y **eso resultó ser falso** (ver el apartado corregido). Lo importante es que
  > **la decisión fue la correcta por accidente**: se pidió arreglar el gemelo «aunque dos `vencido`
  > sea imposible», y ese cinturón —el `id` en el `WHERE`— es hoy **la única pieza que impide un fallo
  > mudo real** en un caso que sí ocurre. La razón para no escribirle test propio ya no es «es un
  > estado imposible», sino que **el `WHERE` es exactamente el mismo** que el que ya prueban los
  > cuatro pasos del rechazo (**R19**): es la misma línea, medida una vez.
- **M7 — aprobar uno vacía la mano del otro.** Al aprobar, la liberación de `sin_gestionar`
  (`CierresAdminRepository.ts:1417`) filtra por `mensajeroAsignadoId` **y no por cierre**: con dos
  cierres, aprobar el 1.º libera también las órdenes del 2.º.
- **M9 — el aviso «cierre por aprobar» nombrará el cierre equivocado.** *(Hallado al escribir este
  spec, no venía en la ficha.)* `avisarCierrePorAprobar` (`CierreDiaService.ts:180`) resuelve el
  cierre con `findCierreSolicitado`, que es un `findFirst … orderBy: { createdAt: "desc" }`
  (`CierreDiaRepository.ts:427`): con dos `solicitado`, siempre devuelve **el más nuevo**. Al
  re-solicitar **el más viejo** (R18), el aviso apunta al otro y la clave de dedupe se calcula sobre
  la entidad equivocada.

---

# Requisitos

## Bloque A — El conteo N/V y la regla

**R1.** El sistema DEBE derivar, para un mensajero dado, **N** = cantidad de sus filas de `cierre_dia`
en estado `solicitado`, `vencido` o `rechazado`, y **V** = cuántas de esas están en `vencido` o
`rechazado`.

**R2.** MIENTRAS un mensajero cumpla `N ≤ 1` **y** `V = 0`, el sistema DEBE tratarlo como **LIBRE**.

**R3.** MIENTRAS un mensajero cumpla `N ≥ 2` **o** `V ≥ 1`, el sistema DEBE tratarlo como
**BLOQUEADO**.

**R4.** MIENTRAS un mensajero no tenga ningún cierre abierto (`N = 0`, `V = 0`), el sistema DEBE
tratarlo como LIBRE. *(Caso 1: sin cierres, gestionando hoy.)*

**R5.** MIENTRAS un mensajero tenga exactamente un cierre abierto y ese cierre esté en `solicitado`
(`N = 1`, `V = 0`), el sistema DEBE tratarlo como LIBRE. *(Casos 2 y 3: terminó el día y solicitó su
cierre; y trabaja hoy con el de ayer aún sin aprobar.)*

**R6.** MIENTRAS un mensajero tenga dos o más cierres abiertos, todos en `solicitado`
(`N ≥ 2`, `V = 0`), el sistema DEBE tratarlo como BLOQUEADO. *(Caso 4: ya solicitó el segundo.)*

**R7.** CUANDO un cierre del mensajero pase a `vencido` o a `rechazado`, el sistema DEBE tratarlo
como BLOQUEADO **desde ese instante**, sin esperar a ninguna corrida ni a ninguna escritura
adicional. *(Caso 5: dejó vencer el único.)*

**R8.** MIENTRAS un mensajero tenga `N ≥ 2` y `V ≥ 1`, el sistema DEBE tratarlo como BLOQUEADO,
**incluso después** de que re-solicite el cierre vencido o rechazado. *(Caso 6: re-solicitar el 2.º
no basta, sigue `N = 2`.)*

**R9.** El sistema DEBE admitir **dos o más cierres abiertos simultáneos** por mensajero. El
invariante de la feature 109/R30 —«un mensajero nunca tiene 2 cierres abiertos a la vez»— queda
**DEROGADO**: ninguna guarda de servicio, ningún índice y ningún test DEBE volver a imponerlo.

**R10.** El sistema DEBE resolver LIBRE/BLOQUEADO con **un único predicado**. Ninguna superficie DEBE
re-derivar el estado de bloqueo por su cuenta ni a partir de una lista de estados propia.

**R11.** El sistema DEBE identificar como **«el que toca resolver»** el cierre abierto **más viejo**
del mensajero, ordenando por `solicitado_at` y desempatando de forma estable por `id`.

**R12.** El sistema NO DEBE persistir ninguna bandera de bloqueo. CUANDO cambie el estado de
cualquier cierre del mensajero, la siguiente consulta DEBE reflejar el nuevo veredicto sin ninguna
escritura adicional.

## Bloque B — Solicitar cierre

**R13.** CUANDO un mensajero LIBRE con un cierre en `solicitado` (`N = 1`, `V = 0`) y con al menos
una gestión sin vincular pida «Solicitar cierre», el sistema DEBE **crear un segundo cierre** en
`solicitado` y NO DEBE responder conflicto por duplicado.

**R14.** CUANDO el sistema cree ese segundo cierre, DEBE vincularle **exactamente** las gestiones del
mensajero con `cierre_id` nulo y no anuladas en ese instante, y NO DEBE tocar ninguna gestión ya
vinculada a otro cierre.

**R15.** MIENTRAS un mensajero esté BLOQUEADO, el sistema NO DEBE crear un cierre nuevo por la vía de
creación, y DEBE responder con un motivo que diga cuántos cierres arrastra y cuál toca resolver
primero. *(Derivado — ver supuesto **S4**.)*

**R16.** MIENTRAS un mensajero esté BLOQUEADO y tenga al menos un cierre re-solicitable, el sistema
DEBE permitirle **re-solicitarlo**, sea cual sea N. *(Anti-deadlock: conserva 111/R9 y 109/R28; sin
esto, el caso 5 no tiene salida.)*

**R17.** *(REESCRITO el 2026-08-23 tras medirlo. Ver más abajo la versión original y por qué se
cayó.)* El sistema DEBE tratar **dos cierres en `vencido` a la vez** como un estado **raro pero
ALCANZABLE**, cubierto por la regla general (`N=2, V=2`, fila 7 de la tabla de verdad) y por la
re-solicitud del más viejo (**R18**), **sin ninguna guarda específica añadida** para impedirlo ni
para detectarlo. El sistema NO DEBE afirmar, en código ni en prosa, que ese estado sea imposible.

> **Versión original, conservada porque la historia importa más que el resultado:**
> *«El sistema NO DEBE permitir que un mensajero tenga dos cierres en `vencido` a la vez. Esta
> propiedad DEBE sostenerse como consecuencia de la regla —un mensajero con un `vencido` está
> bloqueado, no genera trabajo nuevo, y su corte ya barrió lo que tenía—, sin ninguna guarda
> específica añadida para imponerla.»*
>
> **Por qué se cayó:** «su corte ya barrió lo que tenía» dejó de ser cierto con la feature **246**
> —una orden reservada para un día posterior sobrevive al barrido y su protección caduca sola—, y la
> feature **262** deja mover el día de una orden que ya está en `en_reparto`. Medido el 2026-08-23 en
> `tests/integration/db/corte-diario-segundo-cierre-sql-real.test.ts`. **Lo introduce esta ficha**:
> antes, la exclusión por cierre abierto sacaba al bloqueado de la corrida siguiente.
>
> **Lo que NO cambia:** no se añade guarda, y **no se necesita**. Un mensajero sigue pudiendo tener
> dos cierres re-solicitables, y ahora se sabe que no siempre incluyen un `rechazado`.

**R18.** CUANDO un mensajero con **dos o más** cierres re-solicitables re-solicite, el sistema DEBE
transicionar **exactamente uno —el más viejo—**, con independencia de si ese más viejo está en
`vencido` o en `rechazado`, y DEBE dejar los demás en su estado.

**R19.** CUANDO el sistema ejecute una re-solicitud, DEBE reportar éxito **si y sólo si** transicionó
esa fila concreta, y NO DEBE reportar conflicto habiendo escrito. En particular, CUANDO el mensajero
tenga **dos cierres `rechazado`**, el sistema NO DEBE transicionar los dos ni responder «no se pudo»
después de haberlos movido. *(Cierra **M2** por la vía por la que muerde.)*

**R20.** CUANDO el sistema ejecute una re-solicitud, NO DEBE recalcular ni re-snapshotear totales,
pago al mensajero ni ingreso de bodega, NO DEBE re-vincular gestiones y NO DEBE tocar
`resuelto_por`, `resuelto_at`, `motivo_rechazo` ni `solicitado_at`. *(Money-safe; conserva 111/R8 y
109/R28.)*

## Bloque C — El corte diario

**R21.** CUANDO el corte corra, DEBE evaluar **también** a los mensajeros que ya tienen uno o más
cierres abiertos, y DEBE crearles un cierre `vencido` por el trabajo del día que quedó sin cerrar.
*(Supuesto **S3**: es así como aparece el `vencido` del caso 5 y el del caso 6, en las dos noches en
que el mensajero **aún no estaba bloqueado**.)*

**R22.** CUANDO el corte evalúe a un mensajero que no tenga ninguna gestión sin vincular **ni**
ninguna orden que barrer a `sin_gestionar`, el sistema NO DEBE crear ningún cierre y NO DEBE dejar
ningún efecto. *(Se apoya en la guarda «algo pasó» ya existente; no se añade otra. Es lo que hace que
un mensajero ya bloqueado no acumule un `vencido` más cada noche — ver **R17**.)*

**R23.** CUANDO el corte corra, NO DEBE crear más de **un** cierre por mensajero y corrida.

**R24.** CUANDO el corte cree un cierre para un mensajero que ya tenía otro abierto, NO DEBE
re-vincular ninguna gestión ya vinculada ni volver a registrar como sin gestionar una orden ya
barrida por un cierre anterior.

## Bloque D — Gestionar y cobrar

**R25.** MIENTRAS un mensajero esté BLOQUEADO, el sistema DEBE rechazar **entregar, escoger,
recoger, deshacer una gestión y recolectar en tienda**. Las cinco, sin excepción: recolectar en
tienda es cobrar, y el dinero que cobre no tendría cierre al que ir.

**R26.** MIENTRAS un mensajero esté LIBRE, el sistema DEBE permitirle esas cinco acciones. En
particular, DEBE permitirlas con `N = 1` y `V = 0`, es decir con un cierre `solicitado` pendiente de
aprobación. *(La parte de la regla firmada del 20/08 que esta ficha **no** revierte.)*

**R27.** CUANDO el sistema rechace una de esas acciones por bloqueo, DEBE hacerlo **sin efectos** y
con un motivo que diga por qué está bloqueado y qué tiene que hacer para salir.

## Bloque E — Recibir trabajo nuevo

**R28.** MIENTRAS un mensajero esté BLOQUEADO, el sistema DEBE rechazar toda asignación de **reparto**
hacia él **desde la bodega central**.

**R29.** MIENTRAS un mensajero esté BLOQUEADO, el sistema DEBE rechazar toda asignación de **reparto**
hacia él **desde la bodega satélite**. *(Es la superficie donde ocurrió el incidente del 18/08.)*

**R30.** CUANDO el sistema rechace una asignación por bloqueo del mensajero, DEBE abortar el **lote
completo sin efectos sobre ninguna orden** y devolver un motivo que nombre la causa.

**R31.** MIENTRAS un mensajero esté BLOQUEADO, el sistema DEBE rechazar toda asignación de
**recolección en tienda** hacia él. **No hay excepción y no hay asimetría:** las tres escrituras de
asignación usan el mismo predicado. *(Q1, resuelta por el humano el 2026-08-23, revirtiendo un «solo
reparto» que llegó a estar escrito en este spec.)*

**R32.** Los selectores de mensajero de las **tres** superficies de asignación —reparto central,
reparto satélite y recolección— DEBEN marcar como bloqueados **exactamente** a los mensajeros que el
servidor va a rechazar. Ni uno más, ni uno menos.

**R33.** El **filtro** de mensajero del listado de entregas NO DEBE deshabilitar ni ocultar a un
mensajero por estar bloqueado por cierres. *(Filtrar no es asignar: un bloqueado sigue teniendo
órdenes que alguien necesita buscar.)*

**R34.** El bloqueo de un mensajero NO DEBE bloquear a su bodega entera: los compañeros sin cierres
acumulados DEBEN poder seguir recibiendo asignaciones.

## Bloque F — Aprobar

**R35.** CUANDO un administrador apruebe un cierre de un mensajero que tenga más de un cierre
abierto, el sistema DEBE liberar a bodega **exclusivamente** las órdenes `sin_gestionar` registradas
en **ese** cierre, y NO DEBE tocar las de ningún otro cierre del mismo mensajero. *(Cierra **M7**.)*

**R36.** CUANDO se apruebe un cierre y con ello el mensajero quede en `N ≤ 1` y `V = 0`, el sistema
DEBE tratarlo como LIBRE en la siguiente consulta.

**R37.** CUANDO un administrador apruebe un cierre, el sistema NO DEBE vincular, desvincular ni
recalcular gestiones que pertenezcan a otro cierre del mismo mensajero.

## Bloque G — Avisos

> Pedido explícito del humano: *«avisos bien explicados de por qué los bloqueos y de qué debe hacer
> para solucionarlos, tanto al mensajero como a la bodega»*.

**R38.** CUANDO el corte cree un cierre `vencido`, el sistema DEBE emitir un aviso **al mensajero
dueño de ese cierre**.

**R39.** CUANDO el corte cree un cierre `vencido`, el sistema DEBE emitir un aviso a la **bodega
responsable** de ese cierre.

**R40.** CUANDO un mensajero solicite un cierre y con ello quede en `N ≥ 2`, el sistema DEBE emitir
un aviso **al mensajero** que le diga que ha quedado bloqueado y que la salida depende de que se
apruebe su cierre más viejo.

**R41.** CUANDO un mensajero solicite un cierre y con ello quede en `N ≥ 2`, el sistema DEBE emitir
un aviso a la **bodega responsable** que diga que ese mensajero está bloqueado y que aprobar su
cierre más viejo lo desbloquea.

**R42.** CUANDO un administrador rechace un cierre, el sistema DEBE emitir un aviso **al mensajero**
diciéndole que quedó bloqueado y que re-enviarlo a aprobación es lo que le toca hacer.
*(Q3, resuelta por el humano el 2026-08-23: **sí entra en alcance**. Ver **S6**. Además el rechazo es
la única vía por la que se acumulan dos cierres re-solicitables.)*

**R43.** Todo aviso de bloqueo dirigido al mensajero DEBE decir las **tres** cosas: (a) qué **no**
puede hacer, (b) **cuántos** cierres arrastra, y (c) **cuál** toca resolver primero y **quién** lo
resuelve. NO DEBE prometer ninguna actividad que el servidor vaya a rechazar. *(Un aviso que permite
más de lo que el servidor acepta es el fallo que la feature 241 documentó al revés.)* SI el aviso
nombra una fecha para identificar un cierre, ENTONCES DEBE ser la de su **jornada** (**R57–R60**), no
la de su creación.

**R44.** CUANDO el sistema vuelva a emitir un aviso por el **mismo** hecho de bloqueo y el anterior
siga sin leerse, NO DEBE crear un aviso duplicado. CUANDO el hecho sea **otro** —otro cierre, u otra
causa— el sistema DEBE emitir un aviso nuevo aunque el anterior siga sin leerse.

**R45.** Ningún aviso DEBE contener monto, dirección, teléfono, correo ni el nombre del destinatario
de una orden.

**R46.** Todo texto visible DEBE estar en **lenguaje claro y sin siglas**.

**R47.** SI la emisión de un aviso falla, ENTONCES el sistema DEBE completar igualmente la operación
que lo originó —crear el cierre, transicionarlo o aprobarlo— y NO DEBE hacer fallar la corrida del
corte.

## Bloque H — Lo que la administración ve

**R48.** El sistema DEBE mostrarle a la administración, en la fila de un cierre, que ese mensajero
está **bloqueado y por qué** —cuántos cierres arrastra y cuál toca resolver primero—. Un
`rechazado` NO DEBE entrar en la cola de «pendientes de decisión»: sobre ése la bodega **ya decidió**.
*(Q2, resuelta por el humano el 2026-08-23. `ESTADOS_COLA_CIERRE_DIA` no se toca.)*

**R49.** La administración DEBE poder destrabar tanto un cierre `vencido` como uno `rechazado`.
*(No-regresión: ya funciona —`ESTADOS_REABRIBLES`—, y esta ficha no lo estrecha. **Se afirma
explícitamente porque R48 saca al `rechazado` de la cola:** que no esté en la lista de pendientes NO
significa que el mensajero se quede sin rescate.)*

## Bloque I — La prosa que deja de ser cierta

> Esto **revierte en parte una regla firmada** el 2026-08-20 (feature 241): *«RECIBIR ASIGNACIONES —
> NUNCA se bloquea»*. Es un **cambio de regla**, no la corrección de un olvido, y se trata como tal.

**R50.** Los comentarios de `lib/repositories/OrdenRepository.ts` (`:3187` y el bloque `:301-328`) y
de `lib/constants/bloqueo-mensajero.ts` DEBEN reescribirse para declarar la regla vigente, nombrando
esta ficha y su fecha, y diciendo **qué parte de la regla de la 241 sobrevive** (`solicitado` solo no
bloquea) y **cuál se revierte** (recibir trabajo nuevo —reparto **y** recolección— sí se bloquea).

**R51.** Ninguna línea del árbol DEBE seguir afirmando que recibir asignaciones no se bloquea nunca,
ni prometer al mensajero que «sí puede seguir recibiendo asignaciones», ni distinguir reparto de
recolección a efectos de bloqueo. En particular, `MSG_BLOQUEADO` de
`RecoleccionTiendaService.ts:42` DEBE cubrir también el caso de acumulación, en el que no hay nada
«sin resolver» por parte del mensajero.

**R52.** Los textos de bloqueo del portal «Entregas», del portal «Recolección» y del módulo «Cierre
del día» DEBEN decir lo mismo sobre qué no puede, qué sí puede y cuál resolver primero. La **única**
diferencia admitida entre ellos es el llamado a la acción.

## Bloque J — No regresión

**R53.** Ningún cambio de esta ficha DEBE alterar un total, un pago snapshoteado ni un ingreso de
bodega ya escrito.

**R54.** `crearCierre` DEBE seguir devolviendo «nada creado» y sin efectos cuando no vincule ninguna
gestión ni barra ninguna orden.

**R55.** El despliegue de esta ficha NO DEBE cambiar ninguna fila existente de `cierre_dia`,
`gestion_orden` ni `orden`.

**R56.** CUANDO un mensajero con dos cierres en `solicitado` genere un aviso de «cierre por aprobar»,
ese aviso DEBE nombrar el cierre sobre el que se acaba de actuar y no otro. *(Cierra **M9**.)*

## Bloque K — La fecha de la jornada, que hoy saldría mal

> Un aviso que nombra un cierre por su fecha tiene que nombrar **el día que el mensajero trabajó**, no
> el día en que la fila nació. Ver la precisión **14**: se miden **un día de diferencia** en todo
> `vencido`, que son justamente los que más avisos generan.

**R57.** CUANDO el sistema necesite nombrar la **jornada** de un cierre, DEBE derivarla de la fecha de
Costa Rica de las **gestiones vinculadas** a ese cierre que no estén anuladas.

**R58.** CUANDO un cierre no tenga **ninguna** gestión vinculada, el sistema DEBE derivar su jornada
como **el día de Costa Rica de su creación menos un día**.

**R59.** El sistema NO DEBE derivar la jornada de un cierre a partir de `orden.fecha_reparto`.
*(Es la fuente que el humano descartó: una orden reprogramada se libera con `fecha_reparto = null` y
se reasigna a otro día, y el propio barrido del corte admite `fecha_reparto IS NULL`.)*

**R60.** SI la jornada de un cierre no se puede derivar con certeza —porque sus gestiones caen en más
de un día de Costa Rica, o porque ninguna fuente resuelve—, ENTONCES el sistema DEBE **omitir la
fecha** del texto y NO DEBE inventar ninguna. El resto del aviso DEBE seguir siendo correcto y
accionable sin ella.

**R61.** El sistema DEBE derivar la jornada con **un único derivador**, compartido por los avisos y
por la pantalla. Ninguna superficie DEBE calcularla por su cuenta.

---

## La tabla de verdad, y qué requisito cubre cada fila

| # | Caso dictado por el humano | N | V | Resultado | Requisitos |
| --- | --- | --- | --- | --- | --- |
| 1 | Sin cierres, gestionando hoy | 0 | 0 | **libre** | R4, R26 |
| 2 | Terminó el día y solicitó su cierre | 1 | 0 | **libre** | R5, R26 |
| 3 | Trabaja hoy y el de ayer sigue sin aprobar | 1 | 0 | **libre**, gestiona y **puede solicitar el segundo** | R5, R13, R14, R26 |
| 4 | Ya solicitó el segundo | 2 | 0 | **bloqueado** hasta que aprueben **el más viejo** | R6, R25, R28, R29, R31, R36, R40, R41 |
| 5 | Dejó vencer el único | 1 | 1 | **bloqueado al instante**; re-solicitarlo lo libera | R7, R16, R19, R38, R39 |
| 6 | Solicitó el 1.º y dejó vencer el 2.º | 2 | 1 | re-solicitar el 2.º **no basta**; hace falta aprobar el 1.º | R8, R18, R21, R36 |
| 7 | *(derivado)* Dos cierres rechazados | 2 | 2 | **bloqueado**; re-solicitar mueve **uno** | R3, R17, R18, R19 |

**Consecuencia asumida, dicha por el humano y registrada aquí para que nadie la «arregle»:** en el
caso 4 el mensajero queda bloqueado por una demora que **no depende de él**. Palabras textuales:
*«aunque esto no depende de él no importa igual queda bloqueado»*. El único remedio previsto es que
la administración apruebe el más viejo, y por eso R41 existe.

---

## Decisiones ya confirmadas por el humano (no volver a preguntarlas)

**S0 — Q1 RESUELTA el 2026-08-23. El bloqueo alcanza TODO: reparto Y recolección, recibirlas Y
ejecutarlas.** Un solo predicado, todas las superficies, sin excepciones. **Revierte** el «solo
reparto» que llegó a estar escrito en este spec. Palabras del humano: *«Error mío, en realidad no
puede recibir recolecciones porque son dos tareas diferentes, una cosa es ir a repartir y otra
diferente es recoger en tienda, un mensajero no puede hacer las dos gestiones, solo una a la vez.»*
Encaja con la **regla de dedicación** de la feature 157, que ya declara reparto y recolección
mutuamente excluyentes: son la misma jornada de trabajo, así que dejar pasar una de las dos no
protegía nada.
→ Fija **R25, R31, R32, R33, R43, R50, R51**.

**S1 — CONFIRMADO el 2026-08-23. `rechazado` cuenta igual que `vencido`: suma a V.**
Coincide con lo que ya hace el código (`ESTADOS_CIERRE_BLOQUEAN_GESTION = ["vencido","rechazado"]`,
`OrdenRepository.ts:328`, y `ESTADOS_REABRIBLES` incluye los dos).
→ Fija **R1, R7, R16, R17, R18, R42, R48**.

> ⚠️ **NOTA SOBRE S2 — 2026-08-23, por la tarde.** La **decisión** de S2 sigue en pie y fue acertada:
> el requisito de «uno, el más viejo» se reformula sobre **cierres re-solicitables** y M2 muerde por
> el `rechazado`. Lo que **no** se sostiene es la **premisa** con la que se argumentó —que dos
> `vencido` a la vez fuera imposible—: medida y desmentida ese mismo día (ver el apartado de R17). La
> reformulación sobre «re-solicitables» resulta ser, además, **lo que salva el caso**: por eso no hay
> que reabrir S2, sólo dejar de citarla como prueba de una imposibilidad.

**S2 — CORREGIDO el 2026-08-23 por el humano. No es «de uno en uno entre dos `vencido`»: dos
`vencido` a la vez es IMPOSIBLE.** La propiedad se escribe como **invariante derivado** (**R17**), con
su razón, y el requisito de «uno, el más viejo» se reformula sobre **cierres re-solicitables**
(**R18**), porque el caso real de dos siempre incluye un `rechazado`. La consecuencia directa es que
**M2 muerde por `transicionarRechazadoASolicitado`**, no por su gemelo del `vencido`: su requisito
(**R19**) no es defensivo y necesita un test que reproduzca los **cuatro pasos** del rechazo.

**S5 — Q2 RESUELTA: `rechazado` NO entra en la cola de «pendientes de decisión».** La bodega **ya
decidió** sobre ese cierre; meterlo ahí cambia lo que significa la cola. Lo que **sí** debe verse es
que ese mensajero está **bloqueado y por qué**, en su fila. Y queda escrito para que nadie concluya
lo contrario: **un `rechazado` no deja al mensajero sin rescate** — `forzarSolicitudVencido` acepta
`vencido` **y** `rechazado` (`ESTADOS_REABRIBLES`, `CierresAdminRepository.ts:80`), así que la bodega
conserva la salida aunque la fila no esté en la cola.
→ Reescribe **R48**; `ESTADOS_COLA_CIERRE_DIA` **no se toca**.

**S6 — Q3 RESUELTA: SÍ, el aviso de rechazo entra en alcance.** Un rechazo bloquea, y el humano pidió
que el mensajero sepa por qué está bloqueado y qué hacer. Además es **la única vía** por la que se
acumulan dos cierres re-solicitables.
→ Confirma **R42**.

**S7 — Q4 RESUELTA: SÍ a los dos valores nuevos de `NotificacionEvento`.** Son necesarios para lo que
pidió el humano. Se aplica lo que este repo ya sabe de una migración de enum: mirar si el `down.sql`
del enum **recrea-con-lista o sólo dropea**, **no tocar** los `down.sql` previos (son fotos
históricas) y correr `tests/integration/db` entero.
→ Confirma `design.md` §3.2 y §9.2.

**S8 — Q5 RESUELTA: a la bodega por la CAMPANA.** Es el patrón de `cierre_dia_por_aprobar` y el sitio
donde ya mira. **La cola sigue siendo la vista de trabajo, no el canal de aviso.**
→ Confirma **R39, R41**.

**S9 — Q7 RESUELTA: SIN tope de N.** Con el bloqueo puesto, N sólo puede crecer por rechazos del
administrador, así que está **acotado por construcción**. Un tope sería código defensivo para un caso
que la regla ya impide.
> ⚠️ **2026-08-23:** aquí se citaba **R17** («los dos `vencido`») como precedente exacto, y ese
> precedente **se cayó**: R17 resultó alcanzable. **La conclusión de S9 no cambia** —se sostiene por
> su propia razón, que N sólo crece por rechazos del administrador—, pero **ya no se apoya en R17**.
> Es el ejemplo de por qué una imposibilidad afirmada y no medida es cara: se cita como prueba.

**S3 — CONFIRMADO. El corte sigue creando cierre para el trabajo sin cerrar aunque el mensajero ya
esté bloqueado, y NO hace falta excluirlo.** Es lo que produce el
`vencido` de los casos 5 y 6, y en las dos noches el mensajero **aún no estaba bloqueado**. Para uno
**ya** bloqueado el corte corre, no encuentra nada y `crearCierre` devuelve `null` por su guarda «algo
pasó»: no acumula. Por eso el corte deja de excluir a quien tiene cierre abierto **sin ninguna
condición nueva**.
→ Afecta a **R21, R22, R23**.

**S4 — CONFIRMADO. La vía de CREACIÓN de cierre se le cierra al mensajero bloqueado; la de
RE-SOLICITUD no.** El gate de creación pasa a ser la regla LIBRE/BLOQUEADO, y la re-solicitud sigue
exenta porque es la única salida del caso 5.
→ Fija **R15, R16**.

> **Ya no queda ningún supuesto abierto del autor.** Los nueve (`S0`–`S9`) son decisiones humanas.

---

## Preguntas abiertas

**Queda UNA.**

**Q6 — Texto exacto de los cinco avisos.** R43 fija el **contenido obligatorio**, no las palabras.
Los cinco literales están propuestos en `design.md` §10.2 y son **contrato de test**: se afirman
escritos a mano y completos, así que conviene que el humano los lea antes de que se conviertan en
aserciones. *(En revisión con el humano; no la cierra el autor de este spec.)*

### Cerradas, con su razón en la sección de arriba

| | Pregunta | Resuelta | Dónde |
| --- | --- | --- | --- |
| Q1 | ¿La recolección se bloquea? | **Sí, todo se bloquea** | **S0** |
| Q2 | ¿`rechazado` entra en la cola? | **No** | **S5** |
| Q3 | ¿El aviso de rechazo entra en alcance? | **Sí** | **S6** |
| Q4 | ¿Dos valores nuevos de enum? | **Sí** | **S7** |
| Q5 | ¿Campana o cola para la bodega? | **Campana** | **S8** |
| Q7 | ¿Tope de N? | **Sin tope** | **S9** |
