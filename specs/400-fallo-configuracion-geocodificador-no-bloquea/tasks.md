# Feature 400 — Tasks

> `requirements.md` = el QUÉ · `design.md` = el CÓMO · esto = el desglose.
> Ficha `fullstack`: se secuencia **backend → frontend** (fases 1-2 y 4 son backend; la fase 3 es
> frontend y depende del tipo que sale de T6).
> `[P]` = puede ir en paralelo con las tareas marcadas igual **dentro de su fase**.
> **El gate y las mutaciones nunca corren a la vez**: T21 se ejecuta con el árbol quieto.
>
> **Corrección 2026-09-09:** T1 y T20 se reescriben porque el incidente ya se resolvió a mano (ver
> `requirements.md`); T10b, T13b y T16b se añaden para el aviso que el humano pidió en la puerta de
> aprobación (Bloque F, R31-R36). Todo lo demás sigue igual.

---

## Fase 0 — Antes de escribir una línea

### T0. Confirmar en el árbol real lo que el spec da por vigente
**Depende de:** nada.
**Hacer:** abrir y verificar que siguen ahí (el índice del grafo caduca y su forma de mentir es
devolver de más): `AsignabilidadCoordenadasService.evaluar` (paso R5 en `:96-100`),
`GeocodificacionService` `case "config_invalida"` (`:168-173`) y la guarda de credencial (`:114-118`),
`JobQueueService.mensajeError` (`:20-24`), `JobDTO.lastError` (`IJobRepository.ts:19`), el mapa
`MOTIVO_A_MENSAJE` (`geocodificacion-motivo-messages.ts:33-40`) y el guard de la 368
(`tests/unit/guards/geocodificacion-motivo-por-orden-mismo-modulo.guardia.test.ts`).
**Hecho cuando:** los seis puntos están confirmados en el archivo (no en el grafo) y anotados en
`progress/impl_400_backend.md`. Si alguno se movió, el spec se corrige **antes** de implementar.

### T1. Medir la fotografía de producción, en SOLO LECTURA
**Depende de:** nada. **[P]** con T0.
**Hacer:** contra la base de producción (vía el MCP de Supabase; `DATABASE_URL` de prod es
`sensitive`), sin escribir nada:
1. nº de jobs `tipo = 'geocodificacion'` por `estado`, y de ellos cuántos tienen el `last_error`
   legado del fallo de configuración;
2. nº de órdenes vivas sin `latitud`/`longitud`, partido en «con `geocode_status` determinista» vs
   «sin `geocode_status`»;
3. fecha del último geocode con éxito (¿sigue rota la credencial?).
**Hecho cuando:** los tres números están escritos en `progress/impl_400_backend.md` con su fecha y su
consulta. **Corrección 2026-09-09:** ya se midieron una vez, a las 15:41 UTC (ver `requirements.md`,
"Actualización"): **0 `failed`, 0 `pending`, credencial funcionando** (sonda NA-1143,
`geocode_status=OK`, `ROOFTOP`), **1 sola** orden viva sin coordenadas (NA-817, `ZERO_RESULTS`,
legítima). Repetir la medición al implementar sigue siendo obligatorio —puede haber pasado tiempo y
el proveedor puede haber vuelto a fallar— pero **ya no es la línea base de "cuántas se desbloquean"**:
hoy no hay nada que desbloquear. Si aparecen jobs `failed`/`pending` nuevos con el `last_error` del
fallo de configuración, es señal de que el corte se repitió: avisar antes de seguir.

---

## Fase 1 — Backend: el marcador (R11-R16)

### T2. Módulo del marcador
**Depende de:** T0.
**Hacer:** crear `lib/geo/fallo-config-geocode.ts` con `MARCADOR_FALLO_CONFIG_GEOCODE`,
`marcarFalloConfigGeocode(detalle)` y `esFalloConfigGeocode(lastError)` (design §2.1). Prefijo,
detección con `startsWith`, `null`/`undefined` → `false`.
**Hecho cuando:** `tests/unit/geo/fallo-config-geocode.test.ts` (nuevo) está verde y cubre:
el marcado y la detección son inversos; **sobrevive a `slice(0, 500)` con un detalle de 2000
caracteres** (R12); `null`/`undefined`/cadena vacía → `false`; un mensaje que **menciona** el
marcador en medio del texto → `false` (no es prefijo); el literal del marcador se afirma **escrito a
mano** y no contiene dígitos, `@`, ni nada derivado de una dirección (R14).

### T3. `GeocodificacionService` emite el marcador — y solo donde debe
**Depende de:** T2.
**Hacer:** (design §3) añadir `GeocodeConfigInvalidaError` (su `message` pasa por
`marcarFalloConfigGeocode`), usarlo en `case "config_invalida"`; hacer que
`GeocodeNoConfiguradoError` marque también; dejar `GeocodeIntentoFallidoError` **solo** para
`transitorio` y reescribir su docstring, que hoy dice que sirve para las dos causas —esa ambigüedad
es el bug—.
**Hecho cuando:** `tests/unit/services/geocodificacion-service.test.ts` *(ext.)* está verde y afirma:
el error de `config_invalida` y el de credencial ausente **llevan** el marcador; los de `transitorio`
(red, timeout, 5xx, `OVER_QUERY_LIMIT`, `UNKNOWN_ERROR`, estado desconocido), el de payload inválido
y `GeocodeRespuestaInvalidaError` **no** lo llevan (R16). Sigue verde el test vigente «el payload
crudo persistido en la cache NO arrastra la direccion en claro» (R15).

### T4. Barrer los tests que afirmaban los literales de error viejos
**Depende de:** T3.
**Hacer:** buscar en `tests/` toda aserción sobre `"geocodificacion: GOOGLE_MAPS_API_KEY no esta
configurada"` y sobre el mensaje de `GeocodeIntentoFallidoError`, y decidir **caso por caso** si ese
literal ERA el contrato (entonces se actualiza a la forma nueva, a mano) o era un polizón (entonces se
sustituye por una aserción sobre el comportamiento). **Prohibido** cambiar la aserción por «comparar
contra la constante que la genera»: eso la deja verde para siempre.
**Hecho cuando:** no queda ninguna aserción sobre esos literales en su forma vieja, y cada cambio está
justificado en una línea del informe.

### T5. Guard: el marcador se declara una sola vez [P con T6]
**Depende de:** T3.
**Hacer:** `tests/unit/guards/marcador-fallo-config-declaracion-unica.guardia.test.ts` (nuevo),
patrón del guard de la 368 (lee el **árbol real**, no una copia del texto): el literal del marcador
aparece **solo** en `lib/geo/fallo-config-geocode.ts`; `GeocodificacionService.ts` y
`AsignabilidadCoordenadasService.ts` lo importan de ese módulo; `IJobRepository.ts` conserva
`lastError` y no gana campos por esta ficha (R27).
**Hecho cuando:** el guard está verde **y** sus contrapruebas fallan como deben (un literal copiado en
otro archivo lo pone rojo; un import desde otro módulo lo pone rojo). Sin contraprueba, el guard no
cuenta.

### T6. Test de contrato de las dos puntas [P con T5]
**Depende de:** T3, T9.
**Hacer:** `tests/unit/services/geocodificacion-marcador-contrato.test.ts` (nuevo). Recorre el camino
completo **sin doble intermedio**: `GeocodificacionService.ejecutar` lanza → se recorta el `message`
igual que hace la cola (500 chars) → se arma un `JobDTO` con ese `lastError` → se pasa al gate real →
se comprueba la clasificación. Parametrizado sobre las dos causas propias (→ `asignable_sin_ubicacion`)
y sobre las siete ajenas (→ `geocodificacion_agotada` / `geocodificacion_en_curso`).
**Hecho cuando:** verde, y **mutación comprobada**: quitar el marcado en `GeocodificacionService` o el
predicado en el gate lo pone rojo. Es el test que evita el fallo mudo típico de este repo (una punta
escribe y la otra no lee, con la suite verde).

---

## Fase 2 — Backend: el gate (R1-R10; T10b añade R31-R33/R35)

### T7. Partir la unión de estados en asignables y bloqueantes
**Depende de:** T0.
**Hacer:** en `lib/interfaces/services/IAsignabilidadCoordenadasService.ts` añadir
`asignable_sin_ubicacion` y exportar `EstadoAsignable` y `EstadoBloqueante` (design §5), con el
comentario de cada valor.
**Hecho cuando:** `pnpm typecheck` pasa y el árbol compila. ⚠️ Esta tarea toca `lib/interfaces/`, que
es **cimiento**: desde aquí, el gate rápido se niega solo y **`./init.sh` completo es obligatorio**
(ver T21).

### T8. `esAsignable` acepta los dos estados asignables
**Depende de:** T7.
**Hacer:** actualizar `esAsignable` y reescribir su docstring, que hoy afirma que `asignable` es el
único que deja pasar (R30), citando esta ficha y su fecha.
**Hecho cuando:** test unitario que afirma, uno por uno, el veredicto de **los siete** valores de la
unión (dos `true`, cinco `false`) — enumerados a mano, no derivados del tipo.

### T9. El paso nuevo en el árbol de decisión
**Depende de:** T2, T8.
**Hacer:** en `AsignabilidadCoordenadasService.evaluar`, entre el bloque que no toca la cola y la rama
por estado del job (design §4.1): si `esFalloConfigGeocode(job.lastError)` **y**
`job.estado ∈ {failed, pending, processing}` → `asignable_sin_ubicacion`. Reescribir el bloque
NORMATIVO de la cabecera para incluir el paso nuevo, con la justificación de por qué va ahí (§4.2) y
la fecha.
**Hecho cuando:** `tests/unit/services/asignabilidad-coordenadas.test.ts` *(ext.)* está verde con:
R1 (los tres estados, con marcador → `asignable_sin_ubicacion`); R2 (sin marcador y con `lastError`
`null` → clasificación vigente); R3 (con coordenadas presentes **no** se consulta la cola aunque el
job lleve marcador — doble que cuenta llamadas a `findByDedupeKeys`); R4 (los tres `geocode_status`
deterministas ganan al marcador); R5 (sin job y con job `done` **con** marcador → se sigue encolando);
R10 (`asignable_sin_ubicacion` no aparece nunca como motivo). Y los tests vigentes del archivo siguen
verdes sin tocarlos.

### T10. Los dos writers dejan pasar y no escriben ubicación
**Depende de:** T9.
**Hacer:** ningún cambio de código esperado (los writers preguntan `esAsignable`); **verificarlo**.
**Hecho cuando:** `tests/unit/services/guia-asignacion-gate-coordenadas.test.ts` *(ext.)* y
`tests/unit/services/asignacion-satelite-gate-coordenadas.test.ts` *(ext.)* afirman que una orden
`asignable_sin_ubicacion` (a) recibe mensajero, (b) **no** entra en el `detalle` / `bloqueadas`
(R6/R10), y (c) el repo **no** recibe `latitud`, `longitud`, `geocodeStatus` ni `geocodedAt` en esa
escritura (R7) — con un doble que falla si se le pasan. Si el código de los writers **sí** necesitó
tocarse, se documenta por qué.

### T10b. Los dos gates cuentan `asignable_sin_ubicacion` y lo exponen (R31-R33, R35) — **añadida 2026-09-09**
**Depende de:** T9. Puede hacerse en el mismo cambio que T10 (mismo archivo).
**Hacer:** en `gateCoordenadas` (`GuiaAsignacionService`) y su equivalente privado en
`AsignacionSateliteService`, sumar una segunda cuenta sobre el mismo `Map` de estados que ya se
recorre para armar `detalle`/`bloqueadas` (design §6.5-a): cuántas órdenes salieron
`asignable_sin_ubicacion`. Exponer `sinUbicacion?: number` en `ok` y `partial` de
`AsignarBodegaServiceResult` / `AsignarSateliteServiceResult` (`IGuiaAsignacionService.ts`,
`IAsignacionSateliteService.ts`), presente **solo si es mayor que cero** (patrón aditivo, igual que
`AsignarBodegaInput.dia?`). Espejar el mismo campo en los DTOs de acción (`lib/types/orden-guia.ts`,
`lib/types/recepcion-satelite.ts`), que hoy duplican la forma a mano.
**Hecho cuando:** `tests/unit/services/guia-asignacion-gate-coordenadas.test.ts` *(ext.)* y
`tests/unit/services/asignacion-satelite-gate-coordenadas.test.ts` *(ext.)* están verdes con: R31 (un
lote con N órdenes `asignable_sin_ubicacion` entre las asignables devuelve `sinUbicacion=N`, tanto en
`ok` como en `partial`); R32 (el campo es un `number`; ningún test permite que se filtre un
`ordenId`/`numRemision` por ahí); R33 (sin ninguna `asignable_sin_ubicacion`, el campo está AUSENTE —
`toEqual` sin esa clave, no `toEqual({..., sinUbicacion: 0})`); R35 (con `bloqueadas` y `sinUbicacion`
presentes a la vez, son campos hermanos del mismo objeto, ninguno anidado dentro del otro). Los tests
vigentes que comparan `toEqual({ status: "ok", resultados })` sin este campo siguen verdes sin
tocarlos (por eso es opcional).

### T11. Anclar el modo degradado río abajo [P con T10]
**Depende de:** T7.
**Hacer:** no es código nuevo: es la red que impide que un cambio futuro convierta esta ficha en una
pérdida de órdenes. Extender `tests/unit/services/optimizacion-ruta-degradacion.test.ts` para afirmar
explícitamente 92/R37 (la orden sin coordenadas se excluye del cálculo y **no** aborta la
optimización) y que se reporta como parada sin posición (R9).
**Hecho cuando:** verde, y **mutado**: quitar la exclusión en `OptimizacionRutaService` lo pone rojo.

### T12. Comprobar que las coordenadas pueden llegar después de asignar [P con T10]
**Depende de:** T7.
**Hacer:** `tests/unit/services/geocodificacion-service.test.ts` *(ext.)*: `guardarResultado` escribe
en una orden que ya tiene mensajero y estatus de asignada (el `updateMany` filtra por `id` y
`deletedAt`, nada más) (R8).
**Hecho cuando:** verde. Es el argumento que sostiene la decisión de §8-A4; si dejara de ser cierto,
la puerta de esta ficha habría que reconsiderarla.

---

## Fase 3 — Frontend: el mensaje deja de mentir (R19-R25; T13b/T16b añaden R31/R34/R36)

### T13. Mapa tipado por `EstadoBloqueante` + mensaje nuevo
**Depende de:** T7 (necesita el tipo).
**Hacer:** en `app/(app)/_components/geocodificacion-motivo-messages.ts` (design §6.1-6.2):
sustituir los dos arrays por `Record<EstadoBloqueante, string>`; exportar `MOTIVOS_BLOQUEANTES`;
añadir `MSG_UBICACION_NO_VERIFICADA` y asignárselo a `geocodificacion_agotada`; dejar
`MSG_DIRECCION_NO_ENCONTRADA` **solo** para `direccion_no_geocodificable`. `import type` para el
tipo (no crea acoplamiento en runtime). Actualizar la cabecera del archivo.
**Hecho cuando:** `pnpm typecheck` pasa y, borrando a mano una entrada del `Record`, **falla** (esa es
la prueba de que la exhaustividad es real, no un comentario aspiracional).

### T13b. Mensaje del aviso de R31 en el módulo compartido — **añadida 2026-09-09**
**Depende de:** T13 (mismo archivo).
**Hacer:** añadir `mensajeAsignadasSinUbicacion(n: number): string` a
`geocodificacion-motivo-messages.ts` (design §6.5-b), con el literal fijado (R36): sin siglas, sin
"geocodificación"/"config_invalida"/"API", en lenguaje llano, dejando claro que el problema es del
sistema y no de la dirección. `n <= 0` devuelve `""`.
**Hecho cuando:** `tests/unit/components/geocodificacion-motivo-messages.test.ts` *(ext.)* está verde
con: `mensajeAsignadasSinUbicacion(0)` → cadena vacía (R33); `(1)` y `(>1)` → el literal exacto,
**afirmado a mano** (nunca comparado contra la constante que lo genera); ninguna variante contiene
"geocodificación", "config_invalida" ni "API" (case-insensitive, R36).

### T14. Precedencia de tres clases en el mensaje agregado
**Depende de:** T13.
**Hacer:** `geocodificacionMotivoMessage` pasa de «definitivo vs transitorio» a la tabla ordenada de
tres clases (§6.3): irresoluble > fallo del servicio > en validación.
**Hecho cuando:** implementado con una tabla ordenada, no con `if` anidados.

### T15. Tests del módulo de mensajes
**Depende de:** T13, T14.
**Hacer:** extender `tests/unit/components/geocodificacion-motivo-messages.test.ts`.
**Hecho cuando:** verde, cubriendo: R19 (`geocodificacion_agotada` **no** devuelve «Dirección no
encontrada»; el literal nuevo afirmado **a mano**); R20 (`direccion_no_geocodificable` devuelve
exactamente «Dirección no encontrada», literal a mano); R21 (los tres transitorios, sin cambios);
R22 (matriz de las tres clases, dos a dos y las tres juntas); R24 (ningún mensaje del mapa contiene
dígitos, `@`, ni la dirección/id de prueba); R25 (las claves del mapa son **exactamente**
`MOTIVOS_BLOQUEANTES`, y `asignable_sin_ubicacion` **no** está).
⚠️ Ninguna aserción de literal puede compararse contra la constante que lo genera.

### T16. Que no quede ningún consumidor atrás
**Depende de:** T13.
**Hacer:** (a) extender el guard vigente
`tests/unit/guards/geocodificacion-motivo-por-orden-mismo-modulo.guardia.test.ts` para que su lista
de literales prohibidos en los modales cubra la **unión completa**, incluido `asignable_sin_ubicacion`
(R23); (b) afirmar en `tests/unit/components/guia-decision-error-messages.test.ts`,
`tests/unit/utils/guia-decision-error-message.test.ts` y el test del mapper satélite que el mensaje
nuevo **llega por los dos mappers**.
**Hecho cuando:** los tres archivos verdes + el guard verde con su contraprueba. Registrar en el
informe los **seis** consumidores revisados (4 modales de asignación + `RutearSateliteModal` +
`QuitarRecoleccionModal`) y por cuál de los dos mappers recibe cada uno el cambio.

### T16b. Los dos modales muestran el aviso de R31 (R31/R34/R35) — **añadida 2026-09-09**
**Depende de:** T13b, T10b.
**Hacer:** en `AsignarBodegaModal.tsx` y `AsignarSateliteModal.tsx`, extender el `mensaje` que ya
construye `handleConfirm` (el mismo que hoy va al toast y a `<ManifiestoResultado>`) concatenando
`mensajeAsignadasSinUbicacion(result.sinUbicacion ?? 0)` cuando el campo llega presente (design
§6.5-c). **No crear ningún bloque de UI nuevo** — nada de un segundo `role="status"`/`role="alert"`.
**Hecho cuando:** `tests/components/AsignarBodegaModal.test.tsx` *(ext.)* y
`tests/components/AsignarSateliteModal.test.tsx` *(ext.)* están verdes con: (a) con `sinUbicacion`
presente, el toast/DOM contiene el número (R31); (b) el DOM del aviso no incluye ningún `numRemision`
ni id de las órdenes afectadas (R32); (c) sin el campo, no aparece nada nuevo en el DOM (R33); (d) el
aviso vive dentro del MISMO bloque de resultado que ya existe, sin navegación ni modal nuevos (R34);
(e) un caso con `bloqueadas` Y `sinUbicacion` a la vez no mezcla los dos textos ni los dos
contenedores — la lista `role="alert"` de bloqueadas no contiene el aviso (R35).

### T17. Ver la pantalla, no solo la suite
**Depende de:** T16, T16b, fase 2 completa.
**Hacer:** levantar la app (si ya hay un dev server de otro agente, **no** levantar otro: comparten
`.next`) y provocar los casos en local: una orden con `geocode_status = ZERO_RESULTS` (debe seguir
bloqueando con «Dirección no encontrada»); una orden con job marcado de configuración (debe
asignarse); y un lote mixto que deje alguna orden asignada sin ubicación (debe mostrar el aviso de
R31 en el mismo bloque de resultado, sin identificar cuál). Mirar el toast y el panel de bloqueadas de
los dos modales de asignación.
**Hecho cuando:** hay una nota en `progress/impl_400_frontend.md` con lo que se vio, textualmente. Ver
la app encuentra lo que la suite da por bueno.

---

## Fase 4 — Recuperación idempotente para el próximo incidente, hoy sin sujetos (R17-R18)

### T18. Script de backfill
**Depende de:** T2.
**Hacer:** `scripts/backfill-marcador-config-geocode.ts` (design §7): solo-lectura por defecto
(imprime candidatas y desglose por estado), escribe solo con `--apply`; `WHERE` acotado a
`tipo = 'geocodificacion'` + `estado = 'failed'` + texto legado de configuración + **no** marcada ya;
prefija el marcador y **no** toca `estado`, `intentos`, `run_after`, `dedupe_key` ni `payload`.
**Hecho cuando:** el script existe, tipa (recordar que el build de Vercel type-checkea `scripts/**`) y
su `--dry-run` no escribe (comprobado contra la base local).

### T19. Test de integración del backfill
**Depende de:** T18.
**Hacer:** `tests/integration/db/backfill-marcador-config-geocode.test.ts` (nuevo): siembra filas
legadas + **filas testigo** (otro `tipo`; `estado` distinto; otro `last_error`; una ya marcada), corre
el backfill **dos veces**.
**Hecho cuando:** verde afirmando R17 (idempotencia: el marcador aparece **una** vez) y R18 (las
testigo quedan byte a byte igual; `estado`/`intentos`/`run_after`/`dedupe_key` intactos). ⚠️ **El test
debe fallar si no encuentra las filas que sembró** — nada de `if (!filas) return;`, que reporta
`passed` sin comprobar nada. Y al correr el gate, mirar los `skipped`: sin `.env` la carpeta
`integration/db` se salta entera y el «init OK» no significa nada.

### T20. Confirmar en producción que el backfill no tiene sujetos hoy — **PUERTA HUMANA solo si aparece alguna candidata**
**Depende de:** T19, y el merge de la ficha desplegado.
**Hacer:** correr el `--dry-run` contra producción. **Corrección 2026-09-09:** el resultado esperado
es **0 candidatas** — el incidente que originó esta ficha ya se resolvió a mano (ver
`requirements.md`), así que el `WHERE` del script no debería encontrar ninguna fila. Si el número es
0: documentar y cerrar, sin `--apply` (no hay nada que escribir). Si el número es MAYOR que 0 —señal
de que hubo un incidente nuevo entre el `spec_ready` y este despliegue— entonces sí aplica la puerta
humana original: **decir el número al humano**, esperar su OK, y solo entonces `--apply`; después,
volver a medir los tres números de T1.
**Hecho cuando:** el resultado del `--dry-run` está en `progress/` con su fecha. Si fue 0, la tarea
queda cerrada así —**probada y lista, no ejecutada**—, sin necesitar aprobación. Si fue mayor que 0,
se sigue el protocolo de aprobación y el antes/después queda documentado igual que si el humano
prefiere no escribir en producción: la tarea queda `pendiente` **explícitamente**, nunca cerrada en
silencio.

---

## Fase 5 — Cierre

### T21. Gate completo, con el árbol quieto
**Depende de:** todas las anteriores excepto T20.
**Hacer:** `./init.sh` **completo** (obligatorio: la ficha toca `lib/interfaces/`, cimiento; el modo
rápido se niega solo). Sin ningún subagente mutando el árbol a la vez. Escribir `INIT_EXIT=$?`
**dentro** del log, no con un `echo` posterior que lo tape, y no canalizar por `tail` (trunca en
origen y el rojo se queda sin nombre).
**Hecho cuando:** el log dice `INIT_EXIT=0`, y el recuento de `skipped` se ha mirado (si
`integration/db` salió saltada, el resultado de T19 **no** cuenta).

### T22. Trazabilidad R → test
**Depende de:** T21.
**Hacer:** escribir en `progress/impl_400_backend.md` / `impl_400_frontend.md` el mapa definitivo
`R<n> → archivo::nombre del test`, contrastado con la tabla de `requirements.md`. R28 y R29 son
requisitos de NO-hacer: se acreditan con el `git diff --stat` (no aparece el cron, ni el notificador,
ni `geocode_precision`).
**Hecho cuando:** los 36 requisitos tienen fila y ninguna dice «pendiente». El reviewer rechaza si
falta alguno.

### T23. Comentarios normativos al día (R30)
**Depende de:** T21. **[P]** con T22.
**Hacer:** repasar que no sobreviva ningún comentario que afirme lo contrario de la regla vigente:
la cabecera de `AsignabilidadCoordenadasService`, el docstring de `esAsignable`, el de
`GeocodeIntentoFallidoError`, y la cabecera de `geocodificacion-motivo-messages.ts` (que hoy dice que
hay dos mensajes).
**Hecho cuando:** cada uno nombra la ficha 400 y su fecha, y el guard de T5 lo comprueba para la
cabecera del gate.

### T24. PR
**Depende de:** T21, T22, T23.
**Hacer:** commits por task lógica (`feat(400): …`, `test(400): …`), PR contra `dev`.
**Hecho cuando:** el PR está abierto con el gate en verde adjunto. Recordar: **el check de Vercel es
un build, no la suite** — un PR verde no dice nada de los tests; el veredicto es el log de T21. Y
verificar el blob commiteado (no basta con que el árbol local lo tenga).

---

## Grafo de dependencias

```
T0 ──┬── T2 ── T3 ──┬── T4
     │              ├── T5 [P]
     │              └── T6 [P] ── (necesita T9)
     │
     ├── T7 ── T8 ── T9 ──┬── T10 ──────────┬── T17
     │    │               └── T10b ─────────┤
     │    │                                 │
     │    ├── T11 [P] ─────────────────────┤
     │    ├── T12 [P] ─────────────────────┤
     │    │                                 │
     │    └── T13 ──┬── T14 ── T15 ────────┤
     │              ├── T13b ── T16b ──────┤
     │              └── T16 ────────────────┘
     │
     └── T1 [P] ─────────────────────────► T20 (tras despliegue)

T2 ── T18 ── T19 ──► T20  (PUERTA HUMANA solo si T20 encuentra candidatas)
T10b ──► T16b (necesita el campo `sinUbicacion` para mostrarlo)

todo lo anterior ── T21 ── T22 ──┐
                        └ T23 [P]┴── T24
```

**Camino crítico:** T0 → T7 → T8 → T9 → T10/T10b → T13/T13b → T14/T16/T16b → T21 → T24.
**Paralelizable de verdad:** T1 con T0; T5/T6 entre sí; T11/T12 con T10/T10b; T13b con T14/T16;
T22 con T23.
**Nunca en paralelo:** T21 con cualquier cosa que mute el árbol.
**Añadidas el 2026-09-09** (Bloque F, R31-R36): T10b, T13b, T16b.
