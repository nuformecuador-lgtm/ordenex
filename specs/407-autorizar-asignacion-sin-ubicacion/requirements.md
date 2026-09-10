# 407 — Autorizar la asignación de una orden sin ubicación

## Contexto medido (no es requisito, es la evidencia)

El 2026-09-10, en producción:

- **Guía 76068276**, ÓSCAR ELIZONDO SOLIS, Quesada / San Carlos / Alajuela, zona «FGAM San
  Ramón», estatus `en_bodega_satelite`, sin mensajero. Cargada el 5-sep, geocodificada el
  7-sep con `geocode_status = ZERO_RESULTS` y `latitud`/`longitud` en `null`. **Cinco días
  parada**, porque el gate de asignabilidad por coordenadas (feature 92, R3) la clasifica como
  `direccion_no_geocodificable` y ninguno de los dos caminos de asignación la deja pasar.
- Su dirección: «DE LA CLINICA VETERINARIA MASCOTICAS, 75 METROS HACIA EL SUR SE ENCUENTRA LA
  ENTRADA PRINCIPAL DEL RESIDENCIAL VISTAS DEL SOL, DE ESA ENTRADA 870 METROS HACIA EL ESTÉ, EN
  LÍNEA RECTA HASTA PEGAR CON PORTON GRANDE». Correcta para un humano, ilegible para Google.
- Hay **otra** igual (Palmira / Carrillo, «Del doit center 8 kilómetros al norte camino a
  papagayo…»), todavía sin guía. **Son las 2 únicas órdenes sin coordenadas de toda la base**:
  el fenómeno es raro, pero deja la orden muerta.

**Premisa firmada por el humano el 2026-09-10:** la dirección es descriptiva pero el mensajero
llega sin problema, así que **no debe bloquear**. La vía elegida es **autorizar la asignación**,
no capturar coordenadas a mano (ver `design.md` §9, alternativa A1 descartada).

**Vocabulario de esta ficha.** «Dirección irresoluble» = el estado `direccion_no_geocodificable`
del gate de asignabilidad por coordenadas (feature 92). Es el ÚNICO veredicto DEFINITIVO del
gate: los tres `geocode_status` que lo producen (`ZERO_RESULTS`, `INVALID_REQUEST`,
`SIN_DIRECCION`) son deterministas y reintentarlos no los mejora. «Autorización» = el acto por el
que una persona decide, a sabiendas, que esa orden puede asignarse sin ubicación en el mapa.

---

## Requisitos

### Quién autoriza y sobre qué

**R1.** MIENTRAS el gate de asignabilidad por coordenadas clasifique una orden como bloqueada por
dirección irresoluble, el sistema DEBE permitir que una persona autorizada registre una
autorización de asignación sin ubicación sobre esa orden.

**R2.** CUANDO se solicite autorizar una orden cuyo estado de asignabilidad NO sea «dirección
irresoluble», el sistema DEBE rechazar esa orden, NO registrar ninguna autorización para ella y
devolver el motivo por el que no se puede autorizar.

**R3.** SI el rol del actor es `maestro` o `admin`, ENTONCES el sistema DEBE aceptar la solicitud
de autorización sobre órdenes de cualquier zona.

**R4.** SI el rol del actor es `adminSatelite`, ENTONCES el sistema DEBE aceptar la autorización
únicamente sobre órdenes cuya zona coincida con la zona del propio actor, y DEBE rechazar cada
orden de otra zona con su motivo propio y sin registrar autorización para ella.

**R5.** SI el rol del actor no es `maestro`, `admin` ni `adminSatelite`, ENTONCES el sistema DEBE
rechazar la solicitud completa sin registrar ninguna autorización y sin revelar dato alguno de
las órdenes pedidas.

**R6.** CUANDO la solicitud de autorización llegue sin sesión válida, el sistema DEBE rechazarla
antes de leer ninguna orden y sin registrar ninguna autorización.

### Por lote, y qué pasa con los motivos mezclados

**R7.** CUANDO una solicitud de autorización incluya a la vez órdenes autorizables y órdenes no
autorizables, el sistema DEBE registrar la autorización de las autorizables y rechazar
individualmente las demás, sin abortar la solicitud completa.

**R8.** El sistema DEBE devolver un desenlace por CADA orden recibida en la solicitud, sin omitir
ninguna.

**R9.** El sistema NUNCA DEBE registrar una autorización sobre una orden cuyo bloqueo sea
`geocodificacion_en_curso`, `geocodificacion_encolada`, `geocodificacion_no_encolable` o
`geocodificacion_agotada`: ninguno de esos cuatro es un veredicto definitivo sobre la dirección y
la orden todavía puede resolverse sola.

### El rastro

**R10.** CUANDO el sistema registre una autorización, DEBE dejar constancia permanente de: la
orden autorizada, el usuario que autorizó, el instante en que autorizó y la huella de la
dirección vigente de la orden en ese instante.

**R11.** El sistema NUNCA DEBE modificar ni borrar un registro de autorización ya escrito; una
autorización posterior sobre la misma orden DEBE añadir un registro nuevo.

**R12.** SI la orden ya tiene una autorización vigente para su dirección actual, ENTONCES el
sistema NO DEBE escribir un registro nuevo y DEBE devolver esa orden como ya autorizada.

**R13.** Todo registro de autorización DEBE quedar inaccesible salvo para el servidor de la
aplicación (seguridad a nivel de fila habilitada en la tabla que lo guarda).

### El gate deja pasar

**R14.** MIENTRAS una orden no tenga coordenadas y exista al menos una autorización cuya huella
coincida con la dirección vigente de la orden, el gate de asignabilidad DEBE clasificarla como
asignable sin ubicación por autorización, y los dos caminos de asignación (bodega central y
bodega satélite) DEBEN dejarla pasar.

**R15.** SI la orden tiene latitud y longitud, ENTONCES el gate DEBE clasificarla como asignable
con normalidad, con independencia de que exista o no una autorización.

**R16.** SI la dirección vigente de la orden difiere de la que se autorizó, ENTONCES el gate NO
DEBE honrar esa autorización y DEBE volver a clasificar la orden por su situación real.

**R17.** El estado de asignabilidad que produce esta ficha DEBE ser distinto del que produce el
fallo de configuración del geocodificador (feature 400), y ninguna orden DEBE clasificarse en los
dos a la vez.

### Lo que ve el operador, y que no mienta

**R18.** CUANDO una asignación deje pasar órdenes por autorización, el resultado de la asignación
DEBE informar cuántas fueron, como cifra agregada y separada de la cifra de la feature 400.

**R19.** El sistema NUNCA DEBE describir una orden asignada por autorización con el texto de la
feature 400 («por un problema del sistema, no de la dirección»): en este caso el problema **sí**
es la dirección, y ese texto sería falso.

**R20.** CUANDO el sistema informe de órdenes asignadas por autorización, DEBE usar el literal
fijado en `design.md` §6.2, que dice que se autorizó y qué consecuencia tiene, en lenguaje llano,
sin siglas ni jerga interna.

**R21.** ANTES de que la persona confirme una autorización, el sistema DEBE mostrarle el literal
de consecuencia fijado en `design.md` §6.1: que la orden se asignará sin ubicación en el mapa,
que aparecerá al final de la lista de entregas del mensajero y que no se tendrá en cuenta al
calcular el orden del recorrido.

**R22.** El sistema NUNCA DEBE incluir en los textos de los requisitos R20 y R21 la dirección, el
destinatario, el teléfono, el número de guía ni el identificador interno de ninguna orden.

**R23.** CUANDO un intento de asignación devuelva al menos una orden bloqueada por dirección
irresoluble, el modal correspondiente DEBE ofrecer la autorización sobre esas órdenes, tanto si
el intento no asignó ninguna orden como si asignó solo una parte del lote.

**R24.** Los modales de asignación NUNCA DEBEN decidir con literales propios qué motivo del gate
es autorizable: DEBEN obtener ese criterio del único módulo compartido de vocabulario.

**R25.** CUANDO una solicitud de autorización termine, el modal DEBE indicar qué órdenes quedaron
autorizadas y cuáles no, identificándolas por su número de remisión y nunca por su identificador
interno ni por su dirección.

**R26.** El sistema NO DEBE asignar la orden como efecto de autorizarla: asignar sigue siendo un
acto aparte que la persona vuelve a pedir explícitamente.

### No regresión

**R27.** MIENTRAS no exista ninguna autorización registrada, el sistema DEBE comportarse
exactamente como antes de esta ficha: misma clasificación del gate, mismos textos, mismos
resultados de las dos asignaciones.

**R28.** La migración que introduzca la tabla de autorizaciones DEBE ser reversible mediante su
`down.sql`.

---

## Mapa `R<n>` → test

Los tests marcados «(nuevo)» no existen todavía; el resto se amplía. El criterio de «hecho» de
cada uno está en `tasks.md`.

| R | Test que lo cubre |
| --- | --- |
| R1 | `tests/unit/services/autorizar-asignacion-sin-ubicacion.test.ts` (nuevo) — orden con `geocode_status = ZERO_RESULTS` y sin coordenadas → se registra la autorización |
| R2 | idem — orden `geocodificacion_en_curso` → desenlace `no_autorizable` y CERO llamadas al escritor (`expect(repo.registrar).not.toHaveBeenCalled()`) |
| R3 | idem — actor `maestro` y actor `admin` sobre orden de zona ajena → autorizada |
| R4 | idem — actor `adminSatelite`: orden de su zona autorizada, orden de otra zona → `zona_ajena` y sin escritura |
| R5 | idem — actor `mensajero` / `adminTienda` → `forbidden`, sin lecturas de orden ni escrituras |
| R6 | `tests/unit/actions/autorizar-asignacion-sin-ubicacion.action.test.ts` (nuevo) — sin actor → `unauthenticated`, y el service nunca se construye |
| R7 | `autorizar-asignacion-sin-ubicacion.test.ts` — lote de 3 (una irresoluble, una en curso, una ya asignable) → 1 autorizada + 2 rechazadas, una sola escritura |
| R8 | idem — el resultado tiene exactamente tantos items como ids pedidos, en el mismo orden |
| R9 | idem — caso por cada uno de los cuatro estados, tabla parametrizada; ninguno escribe |
| R10 | `tests/integration/db/orden-asignacion-sin-ubicacion-migration.test.ts` (nuevo) — inserta y lee la fila real: `orden_id`, `actor_usuario_id`, `created_at`, `direccion_hash` presentes y no nulos |
| R11 | idem — la tabla no tiene columnas `updated_at` ni `deleted_at` (`information_schema.columns`), y dos autorizaciones sobre la misma orden con huellas distintas dejan DOS filas |
| R12 | `autorizar-asignacion-sin-ubicacion.test.ts` — orden ya autorizada para su dirección vigente → desenlace `ya_autorizada` y `registrar` no se llama |
| R13 | `orden-asignacion-sin-ubicacion-migration.test.ts` — `pg_class.relrowsecurity` es `true` y `pg_policies` está vacío para la tabla |
| R14 | `tests/unit/services/asignabilidad-coordenadas-autorizada.test.ts` (nuevo) — fila con `geocodeStatus: "ZERO_RESULTS"` + autorización con la huella de su dirección → estado `asignable_sin_ubicacion_autorizada`; y `esAsignable(estado) === true` |
| R14 (writers) | `tests/unit/services/guia-asignacion-gate-coordenadas.test.ts` y `tests/unit/services/asignacion-satelite-gate-coordenadas.test.ts` — la orden autorizada NO aparece en `bloqueadas` y SÍ en `resultados` |
| R15 | `asignabilidad-coordenadas-autorizada.test.ts` — con lat/lng presentes y autorización presente → `asignable` (no el estado nuevo) |
| R16 | `asignabilidad-coordenadas-autorizada.test.ts` — autorización con huella de OTRA dirección → vuelve a `direccion_no_geocodificable`; y `tests/integration/db/orden-asignacion-sin-ubicacion-migration.test.ts` para el `select` real de `findParaAsignabilidad` |
| R17 | `guia-asignacion-gate-coordenadas.test.ts` / `asignacion-satelite-gate-coordenadas.test.ts` — lote con una orden de cada clase → `{ sinUbicacion: 1, sinUbicacionAutorizada: 1 }`, sumas disjuntas |
| R18 | idem — `ok` y `partial` llevan `sinUbicacionAutorizada` solo cuando es mayor que cero |
| R19 | `tests/unit/guards/autorizacion-texto-no-miente.guardia.test.ts` (nuevo) — el literal de R20, leído del árbol real, NO contiene «no de la dirección»; y el mensaje renderizado por los modales para un resultado con solo `sinUbicacionAutorizada` no contiene el literal de la 400 |
| R20 | `tests/unit/components/geocodificacion-motivo-messages.test.ts` — comparación contra el texto **escrito a mano en el test**, copiado de `design.md` §6.2 (singular y plural) |
| R21 | `tests/components/AsignarBodegaModal.autorizacion.test.tsx` y `...Satelite...` (nuevos) — el literal de `design.md` §6.1 está en pantalla ANTES de pulsar confirmar |
| R22 | `geocodificacion-motivo-messages.test.ts` — las funciones de R20 reciben un `number`, así que no pueden emitir PII; test de firma + barrido del literal contra una dirección/guía de ejemplo |
| R23 | `AsignarBodegaModal.autorizacion.test.tsx` / `AsignarSateliteModal.autorizacion.test.tsx` — dos casos: respuesta `conflict` (nada asignado) y respuesta `partial` |
| R24 | `tests/unit/guards/geocodificacion-motivo-por-orden-mismo-modulo.guardia.test.ts` (ampliado) — el barrido de literales del gate sobre el código real de los dos modales, con el estado nuevo añadido a su lista |
| R25 | `AsignarBodegaModal.autorizacion.test.tsx` / `...Satelite...` — la lista de desenlaces muestra `numRemision` y NO el uuid |
| R26 | idem — tras autorizar, `asignarDesdeBodega` / `asignarDesdeSatelite` NO se volvió a llamar |
| R27 | `tests/unit/services/asignabilidad-coordenadas.test.ts` (existente, sin cambios de expectativa) + `guia-asignacion-gate-coordenadas.test.ts` / `asignacion-satelite-gate-coordenadas.test.ts` siguen verdes sin tocar sus `toEqual` |
| R28 | `orden-asignacion-sin-ubicacion-migration.test.ts` — ejecuta el `down.sql` REAL en un esquema temporal dentro de una transacción revertida, y la tabla deja de existir |

---

## Preguntas abiertas

**Q1 — ¿El rastro debe además producir una fila en `historial_accion` (ficha 362)?**
No encaja limpiamente en ninguna de sus tres categorías. Autorizar **no mueve dinero**, **no hace
desaparecer nada** y **no cambia quién puede hacer qué**. Forzarlo obligaría a ampliar el criterio
de la 362, y R17 de aquella ficha exige exactamente una categoría por tipo. Por eso el diseño
propone una tabla propia (§4.1), que es el mismo camino que ya tomaron `orden_dia_reparto_cambio`
(262) y `gestion_fecha_reprogramacion_cambio` (371). **Pregunta:** ¿se quiere ADEMÁS una fila
transversal en `historial_accion` para que la autorización aparezca en el listado «quién hizo
qué»? Si la respuesta es sí, hace falta decidir su categoría, y eso es una decisión del humano,
no del spec.

**Q2 — ¿La autorización debe VERSE en algún sitio después?**
Esta ficha la escribe y la lee el gate, pero no propone ninguna pantalla que muestre «esta orden
está autorizada, por Fulano, el día tal». ¿Debe aparecer en el detalle de la orden? ¿En la línea
de tiempo? Sin respuesta, queda fuera de alcance.

**Q3 — ¿`geocodificacion_agotada` debe poder autorizarse también?**
Hoy R9 dice que no: significa que el servicio de mapas agotó los intentos, no que la dirección sea
mala, y el operador ya tiene el mensaje que se lo dice. Pero si en la práctica hay órdenes que se
quedan ahí clavadas, sería el siguiente candidato. **No hay dato medido** que lo respalde: en la
base solo hay 2 órdenes sin coordenadas y las dos son `ZERO_RESULTS`.

**Q4 — ¿Hace falta REVOCAR una autorización?**
El diseño la deja inerte sola en dos casos (la orden gana coordenadas, o alguien corrige la
dirección). No contempla un «me equivoqué, quítala». ¿Se necesita?

**Q5 — ¿Puede autorizar alguien más?**
R3/R4 dan la capacidad a quien ya puede asignar esa orden (`maestro`/`admin` en la central,
`adminSatelite` en su zona), y el motivo está en `design.md` §3. ¿Debe restringirse solo a
`maestro`, aun sabiendo que el caso medido lo destapó una bodega satélite y que escalar sería
volver a los cinco días de espera?

**Q6 — Los dos literales de §6.1 y §6.2 necesitan el visto bueno del humano.**
Están fijados a mano como contrato de test; cambiarlos después obliga a tocar el spec y los tests.
</content>
</invoke>
