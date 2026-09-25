# Feature 462 — Aviso a primera hora: reprogramadas de hoy que esperan la aprobación de un cierre

> Ficha `feature_list.json#462` (zona `fullstack`, `sdd: true`, complejidad media). Pedida y aprobada por
> el humano el 2026-09-25. Alcance ampliado y **confirmado el mismo día**: cuatro sitios (campana, push,
> marca en `/cierres-admin`, franja en `/ordenes`). Entra en la release completa con SF-001, 454-456,
> 459-461. Diseño en `design.md`; desglose en `tasks.md`.

## 0. El problema, medido

- La regla 276 retiene una orden reprogramada nacida de una visita real hasta que se **aprueba** el
  cierre de su gestión vigente (`lib/services/LiberacionReprogramadaService.ts:53-56`,
  `puedeLiberarse`). Tres disparadores la liberan: el reloj de las 00:00 CR, el timbre 315 al aprobar
  (`CierresAdminService.ts:1082`) y la corrección de fecha 371.
- Caso real (prod, 24/09): la guía 46397476 tenía fecha de hoy desde las 11:45 del 24/09 y esperó hasta
  la aprobación de su cierre a las 07:32 del 25/09 (~20 h). Nadie en la oficina sabía que estaba
  retenida ni por qué cierre.
- **El humano NO cambia la regla** (riesgo de un intento de más y del cobro por tope). Quiere que la
  oficina SEPA a primera hora cuántas reprogramadas de hoy siguen retenidas y POR QUÉ CIERRE, para
  aprobarlo antes de asignar.
- Hoy la corrida de medianoche ya cuenta `esperandoCierre` y solo lo escribe en el log
  (`LiberacionReprogramadaService.ts:246-252`); la 215 §7bis dejó escrito que «M3 — alerta operativa»
  deja de ser opcional. Esta ficha es esa alerta.
- Con la 454 (en `dev`), la gestión `reprogramado` de calle **ya no mueve la orden**: queda en
  `en_reparto` con la gestión pendiente hasta aprobar el cierre. La población retenida vive por tanto en
  DOS formas (ver glosario) y el conteo tiene que ver las dos sin confundirlas con las `en_reparto`
  normales.

## 1. Glosario (los términos que usan los requisitos)

- **Hoy CR**: la fecha calendario de Costa Rica del instante de la lectura (`startOfDayCR` /
  `fechaCalendarioCR`; nunca `toISOString().slice(0,10)`).
- **Reprogramada de hoy**: orden viva (no borrada) cuya gestión `reprogramado` vigente tiene fecha de
  reprogramación **igual o anterior** a hoy CR. «De hoy» incluye las vencidas de días anteriores.
- **Gestión reprogramada vigente**: la más reciente no anulada con resultado `reprogramado` de la orden
  (correlación única `GESTION_REPROGRAMADA_VIGENTE`, 371).
- **Visita real**: la gestión tiene una fila de historial enlazada cuya familia está en
  `ORIGEN_TIPOS_VISITA_REAL` (la reprogramación de escritorio de la tienda NO lo es).
- **Cierre no aprobado**: sin cierre (`cierre_id` nulo), `solicitado`, `vencido` o `rechazado`.
- **Gestión pendiente de confirmar**: la de la 454 (`lib/repositories/gestion-pendiente.ts`): no
  anulada, con evento `gestion_registrada`, cierre no aprobado.
- **Retenida**: una reprogramada de hoy que sigue sin volver a bodega porque su cierre no está aprobado.
  Tiene exactamente dos formas:
  - **Forma A (estado `reprogramado`)**: la orden está en `reprogramado`, su gestión reprogramada vigente
    nace de una visita real y su cierre no está aprobado. Es la población que el reloj cuenta como
    `esperandoCierre` (= `!puedeLiberarse`). Población legada y transicional tras la 454.
  - **Forma B (454, estado `en_reparto`)**: la orden está en `en_reparto` y su gestión de calle vigente
    más reciente es una gestión pendiente de confirmar con resultado `reprogramado` y fecha igual o
    anterior a hoy CR.
- **Cierre que la retiene**: el cierre de esa gestión vigente. Si la gestión no tiene cierre, la retenida
  pertenece al grupo **«sin cierre enviado»** de su mensajero.
- **Ámbito** de una retenida: el alcance que puede aprobar su cierre. Cierre con destino
  `bodega_central` → **central** (maestro y admin). Cierre con destino `bodega_satelite` → la **zona**
  destino (su `adminSatelite`). Sin cierre → el destino que tendría según la bodega responsable de la
  zona de la orden (`resolverDestinoCierre`).
- **Alcance del actor**: maestro y admin → central; `adminSatelite` → su zona. Es el mismo alcance con
  el que `CierresAdminService.resolveAlcance` decide qué cierres ve cada uno en `/cierres-admin`.
- **Las cuatro superficies**: (S1) el aviso agregado de la campana, (S2) el push, (S3) la marca por
  cierre en `/cierres-admin`, (S4) la franja de `/ordenes`.

---

## A. El conteo (una sola definición para las cuatro superficies)

- **R1** — El sistema DEBE considerar retenida toda orden que cumpla la Forma A o la Forma B del
  glosario, y ninguna otra.
- **R2** — El sistema NO DEBE contar como retenida: una orden `en_reparto` sin gestión pendiente; una
  orden cuya gestión pendiente más reciente tenga un resultado distinto de `reprogramado`; una gestión con
  fecha de reprogramación posterior a hoy CR; una gestión anulada; una gestión cuyo cierre esté
  `aprobado`; en la Forma A, una gestión que no nazca de visita real; una orden borrada lógicamente; una
  orden que ya está en bodega (`en_bodega_central`, `en_bodega_satelite`) o en cualquier otro estado.
- **R3** — Para la Forma A, el sistema DEBE decidir «sigue retenida» con exactamente la misma regla que
  la puerta de la liberación (`puedeLiberarse`, 276): para un mismo conjunto de candidatas y un mismo hoy
  CR, el conteo de la Forma A DEBE coincidir con el `esperandoCierre` de la corrida.
- **R4** — Para la Forma B, el sistema DEBE decidir «gestión pendiente de confirmar» con el predicado
  único de la 454, sin reescribirlo.
- **R5** — El sistema DEBE atribuir cada retenida al cierre de su gestión vigente; SI esa gestión no
  tiene cierre, ENTONCES DEBE atribuirla al grupo «sin cierre enviado» de su mensajero.
- **R6** — El sistema DEBE asignar a cada retenida su ámbito según el glosario, y toda cifra que se
  muestre a un actor DEBE estar acotada al alcance de ese actor: maestro y admin ven solo las de ámbito
  central; el `adminSatelite` solo las de su zona.
- **R7** — Para un mismo instante y un mismo alcance, las cuatro superficies DEBEN dar la misma cifra
  total y la misma atribución por cierre (leen el mismo conjunto).
- **R8** — El conteo DEBE ser de solo lectura: no DEBE cambiar estado de orden, mensajero asignado,
  fecha de reparto, fecha de reprogramación, cierre, historial, dinero, ni encolar trabajos, webhooks o
  notificaciones distintas de las de esta ficha.

## B. S1 — El aviso agregado en la campana

- **R9** — CUANDO corra el proceso diario de avisos de las 07:00 CR y en un ámbito haya al menos una
  retenida, el sistema DEBE emitir UN aviso agregado `reprogramadas_esperan_cierre` para ese ámbito: a
  los roles `maestro` y `admin` sin alcance si el ámbito es central; al rol `adminSatelite` acotado a la
  zona si el ámbito es una zona. Un aviso por ámbito y por destinatario, jamás uno por orden ni uno por
  cierre.
- **R10** — SI un ámbito no tiene retenidas en el instante de la corrida, ENTONCES el sistema NO DEBE
  emitir aviso para ese ámbito.
- **R11** — CUANDO la corrida se repita el mismo día CR para el mismo ámbito, el sistema DEBE producir
  un solo aviso por destinatario (deduplicación estructural, por índice único); días CR distintos DEBEN
  producir avisos distintos.
- **R12** — CUANDO dos ámbitos distintos (dos zonas, o una zona y el central) tengan retenidas el mismo
  día, cada uno DEBE recibir su aviso con su propia cifra: ningún ámbito DEBE quedar silenciado por otro.
- **R13** — El título del aviso DEBE componerse en cada lectura con la cifra viva acotada al alcance del
  actor, con singular y plural explícitos y nombrando el resultado por su nombre visible de la 455:
  «Reprogramado para hoy: 1 paquete espera la aprobación de su cierre» /
  «Reprogramado para hoy: N paquetes esperan la aprobación de su cierre».
  > Literal vigente desde la decisión del leader del 2026-09-25 (`progress/impl_462_frontend.md` §Decisión): se
  > habla del PAQUETE en masculino; el plural femenino del estado retirado («reprogramadas», 455 §0.3) no aparece
  > en ningún texto visible. Sustituye a «1 orden espera» / «N órdenes esperan». Test: `catalogo-avisos.test.ts`.
- **R14** — La cifra viva DEBE resolverse por el actor que consulta: `maestro`/`admin` → ámbito central;
  `adminSatelite` con zona → su zona. SI el actor es un `adminSatelite` sin zona útil, o cualquier otro
  rol, ENTONCES la resolución DEBE fallar con causa (nunca devolver 0) y el aviso DEBE mostrarse sin
  número.
- **R15** — MIENTRAS la cifra viva del alcance del actor sea 0, el aviso NO DEBE mostrarse ni contar en
  «por hacer», sin que nadie lo lea, marque o descarte; CUANDO vuelva a ser mayor que 0 el mismo día, el
  aviso DEBE reaparecer en el siguiente sondeo sin que se emita una segunda fila.
- **R16** — El aviso DEBE ser accionable para `maestro`, `admin` y `adminSatelite`, con atajo
  «Revisar cierres» a `/cierres-admin`, ruta que los tres roles ven en su menú.
- **R17** — El texto persistido del aviso (el detalle) DEBE ser en lenguaje llano, sin número, sin
  identificadores internos, sin guía, remisión, nombre de destinatario, dirección, teléfono ni monto:
  «No se pueden asignar hasta que se apruebe el cierre del mensajero que los visitó. Revisa los cierres
  marcados «Retiene paquetes reprogramados para hoy» y apruébalos antes de asignar.»
  > Literal vigente desde el 2026-09-25 (misma decisión que R13): «los visitó» y «Retiene paquetes reprogramados
  > para hoy» sustituyen a «las visitó» y «Retiene reprogramadas de hoy». Es `TEXTO_REPROGRAMADAS_ESPERAN_CIERRE`
  > (`lib/notificaciones/emitir.ts`); test: `emitir-reprogramadas-esperan-cierre.test.ts`.
- **R18** — SI la emisión para un ámbito falla, ENTONCES el sistema DEBE registrar el fallo con su causa
  y DEBE seguir emitiendo para los demás ámbitos y los otros dos avisos agregados de la corrida; la
  corrida NO DEBE terminar en error por un aviso.
- **R19** — El composition root del cron DEBE pasar el notificador real como argumento (no basta con
  importarlo), y el composition root de la campana DEBE inyectar el resolutor de la cifra viva de este
  evento.
- **R20** — El sistema NO DEBE emitir este aviso desde la corrida de medianoche de liberación ni desde la
  aprobación de un cierre ni desde la corrección de fecha; el log `esperandoCierre` del reloj DEBE seguir
  escribiéndose igual que hoy.

## C. S2 — El push a primera hora

- **R21** — El evento DEBE declararse elegible para push para los roles `admin` y `adminSatelite`, y no
  para `maestro`; MIENTRAS una persona no haya activado «Avisarme en este dispositivo», NO DEBE recibir
  push de este evento.
- **R22** — El sistema DEBE emitir como mucho un push por (usuario, evento, jornada CR) de este evento,
  por muchos avisos elegibles que se creen ese día.
- **R23** — El cuerpo del push DEBE ser la presentación del aviso (título con la cifra del instante de
  la emisión y el detalle de R17), y NO DEBE contener PII ni identificadores internos.
- **R24** — El push de este evento DEBE salir con la emisión de las 07:00 CR y en ningún otro momento
  del día.
- **R25** — SI en el instante del envío el aviso ya fue leído o descartado por su destinatario, ENTONCES
  el sistema NO DEBE enviar el push (regla vigente 410/R8; se afirma que aplica a este evento).

## D. S3 — La marca por cierre en `/cierres-admin`

- **R26** — CUANDO se sirva una página de la cola de pendientes o del histórico de cierres del día, cada
  fila DEBE traer resuelto en el servidor cuántas reprogramadas de hoy retiene ese cierre, con una sola
  consulta por página (nunca una por fila).
- **R27** — MIENTRAS un cierre retenga una o más reprogramadas de hoy, su comprobante en la lista y la
  cabecera de su detalle DEBEN mostrar la marca «Retiene 1 paquete reprogramado para hoy» /
  «Retiene N paquetes reprogramados para hoy»; con 0 NO DEBEN mostrar nada de esta ficha.
  > Literal vigente desde el 2026-09-25 (misma decisión que R13); sustituye a «Retiene 1 reprogramada de hoy» /
  > «Retiene N reprogramadas de hoy». La nota de la marca (`title` y nombre accesible) es «N paquete(s)
  > reprogramado(s) para hoy no se puede(n) asignar hasta que se apruebe este cierre.» Tests:
  > `retiene-reprogramadas-labels.test.ts`, `RetieneReprogramadasBadge.test.tsx`.
- **R28** — La marca DEBE aparecer en cierres `solicitado`, `vencido` y `rechazado` que retengan; un
  cierre `aprobado` NO DEBE llevarla nunca.
- **R29** — La marca NO DEBE cambiar ninguna acción existente de la pantalla (aprobar, rechazar,
  destrabar, forzar solicitud, pagar, corregir) ni el orden ni el conteo de la cola.
- **R30** — El `adminSatelite` DEBE ver la marca en los cierres de su zona y `maestro`/`admin` en los de
  ámbito central: exactamente los cierres que ya ven, sin ampliar ni recortar el alcance.
- **R31** — La marca NO DEBE entrar en las descargas (CSV/XLSX) de la cola ni del histórico.

## E. S4 — La franja de `/ordenes`

- **R32** — CUANDO un actor de acceso total (`maestro`/`admin`) abra `/ordenes` y en el ámbito central
  haya al menos una retenida, el sistema DEBE mostrar al principio de la página, antes del listado, una
  franja con el texto «Hay 1 paquete reprogramado para hoy que todavía no puedes asignar: falta 1 cierre
  por aprobar.» / «Hay N paquetes reprogramados para hoy que todavía no puedes asignar: faltan M cierres
  por aprobar.» y un enlace «Revisar cierres» a `/cierres-admin`.
  > Literal vigente desde el 2026-09-25 (misma decisión que R13); sustituye a «Hay N reprogramadas de hoy que no
  > puedes asignar todavía: …». Test: `FranjaReprogramadasRetenidas.test.tsx` (las frases a mano).
- **R33** — La franja DEBE listar los cierres que retienen, uno por línea, con el nombre del mensajero,
  la fecha de la jornada en palabras (o «cierre del día» si no hay jornada fiable), el estado en palabras
  («Solicitado», «Vencido», «Rechazado») y cuántas retiene; cada línea DEBE enlazar al detalle de ese
  cierre (`/cierres-admin?cierre=<id>`), con el identificador solo en la dirección, nunca en el texto.
- **R34** — SI hay retenidas sin cierre enviado, ENTONCES la franja DEBE añadir «1 de ellos es de un
  mensajero que todavía no envió su cierre.» / «K de ellos son de mensajeros que todavía no enviaron su
  cierre.», esas K NO DEBEN contarse en M y no DEBEN llevar enlace de detalle; SI todas están sin cierre
  (M = 0), ENTONCES el texto principal DEBE decir «Hay N paquetes reprogramados para hoy que todavía no
  puedes asignar: sus mensajeros todavía no enviaron el cierre.» (con un solo mensajero: «…: su mensajero
  todavía no envió el cierre.»).
  > Literal vigente desde el 2026-09-25 (misma decisión que R13); «de ellos» concuerda con «paquetes» y
  > sustituye a «K de ellas son de…» y a «Hay N reprogramadas de hoy que no puedes asignar todavía: …». Test:
  > `FranjaReprogramadasRetenidas.test.tsx`.
- **R35** — SI no hay retenidas en el ámbito central, ENTONCES la franja NO DEBE renderizarse.
- **R36** — El `adminTienda` NO DEBE ver la franja ni recibir el aviso ni el push; `mensajero` y
  `adminSatelite` no llegan a `/ordenes` y no DEBEN ganar acceso por esta ficha.
- **R37** — SI la lectura de la franja falla, ENTONCES la página DEBE renderizarse sin la franja, con el
  listado intacto, y el fallo DEBE quedar registrado con su causa.
- **R38** — Las cifras y las fechas de la franja DEBEN resolverse en el servidor con el día CR del
  servidor; el navegador NO DEBE calcular fechas ni conteos.
- **R39** — La franja DEBE vivir como bloque independiente (un componente y una lectura), de modo que
  quitarla no toque el listado ni las otras tres superficies.

## F. Casos borde

- **R40** — CUANDO se apruebe el cierre que retiene, sus retenidas DEBEN dejar de contarse en las cuatro
  superficies en la siguiente lectura (en la campana, en el siguiente sondeo), aunque el timbre 315 falle
  y la orden siga en `reprogramado` con el cierre ya aprobado.
- **R41** — CUANDO un cierre sea rechazado, sus retenidas DEBEN seguir contándose, atribuidas a ese
  cierre con estado «Rechazado», hasta que se vuelva a solicitar y se apruebe.
- **R42** — Un cierre `vencido` que retenga DEBE contarse igual, atribuido a ese cierre con estado
  «Vencido».
- **R43** — SI una orden tiene más de una gestión viva, ENTONCES solo la vigente DEBE decidir (Forma A:
  la gestión reprogramada vigente; Forma B: la gestión de calle pendiente más reciente); la aprobación
  del cierre de la otra gestión NO DEBE cambiar el conteo.
- **R44** — Las retenidas cuyo cierre tenga destino `bodega_satelite` DEBEN contarse para el
  `adminSatelite` de esa zona y NO DEBEN entrar en la cifra de `maestro`/`admin` ni en la franja de
  `/ordenes`.
- **R45** — CUANDO la corrección de fecha (371) deje una orden con fecha de hoy y desenlace «espera su
  cierre», esa orden DEBE contarse en las cuatro superficies en la siguiente lectura sin emitir un aviso
  ni un push adicional en ese instante; SI el aviso del día de su ámbito ya existe, ENTONCES su cifra viva
  DEBE subir.
- **R46** — CUANDO la corrección de fecha (371) lleve la fecha a un día futuro, la orden DEBE dejar de
  contarse.
- **R47** — CUANDO la gestión vigente de una retenida no tenga cierre y el corte nocturno o el mensajero
  la vinculen a un cierre, la retenida DEBE pasar del grupo «sin cierre enviado» a ese cierre en la
  siguiente lectura.

## G. No regresión y seguridad

- **R48** — La regla 276, el timbre 315 y la liberación tras corregir fecha (371) DEBEN liberar las
  mismas órdenes en los mismos instantes que hoy: esta ficha no toca `puedeLiberarse`, `liberarOrden` ni
  los tres disparadores.
- **R49** — Ningún movimiento de dinero, fila de historial, job, webhook ni cambio de estado DEBE nacer
  de esta ficha.
- **R50** — Los tres avisos agregados existentes (`novedades_sin_gestionar`, `devoluciones_represadas`,
  `reparto_manana`) DEBEN conservar sus cifras, textos, destinatarios y deduplicación.
- **R51** — Ninguna de las cuatro superficies DEBE ejecutar una consulta por fila: una lectura por cifra
  viva, una por página de cierres, una por render de `/ordenes`.
- **R52** — Ningún log, aviso, push ni respuesta de cron de esta ficha DEBE contener datos personales,
  guías, remisiones ni identificadores de orden; el cron responde solo conteos y la fecha CR.
- **R53** — El sistema DEBE aceptar el evento `reprogramadas_esperan_cierre` y la entidad
  `reprogramadas_esperan_cierre_dia` en el catálogo de notificaciones mediante una migración aditiva con
  `down.sql` que revierta exactamente lo que añade.

## H. Verificación

- **R54** — El predicado de retenidas (Forma A ∪ Forma B, exclusiones de R2, atribución de R5, ámbito de
  R6) DEBE probarse contra Postgres real, con siembras que no puedan pasar por vacío y con las mutaciones
  obligatorias del diseño.
- **R55** — DEBE existir un script SQL de solo lectura, ejecutable contra producción, que cuente las
  retenidas por cierre con el mismo predicado, para medir cada madrugada cuántas quedan y por qué cierre.
- **R56** — Antes de dar la ficha por hecha DEBE haber un recorrido por rol (maestro, admin,
  adminSatelite, adminTienda, mensajero) que compruebe con números qué ve cada uno en las cuatro
  superficies, y que adminTienda y mensajero no ven nada de esta ficha.

---

## Decisiones tomadas (con la alternativa que se descartó)

El humano ya aprobó el alcance; estas dudas se cierran aquí como decisión + alternativa. Si alguna no le
gusta, se cambia la decisión, no el resto del spec.

1. **Hora de emisión del aviso: 07:00 CR, desde el cron `avisos-diarios`.** El título de la ficha dice
   «a primera hora», el push tiene que salir a esa hora y no a medianoche, y a las 00:00 CR el corte
   nocturno y el reloj de liberación corren en el mismo minuto (`0 6 * * *` y el job
   `liberar_reprogramadas`), así que una emisión desde el reloj podría no ver los cierres `vencido` que el
   corte crea en ese instante. Las superficies S3 y S4 son vivas y muestran la retención desde el momento
   en que existe, incluida la madrugada. *Alternativa descartada:* emitir desde la corrida de medianoche
   (`ejecutarLiberacion`) — push a las 00:00 y carrera con el corte.
2. **El push no llega al maestro.** Se sigue el precedente aprobado de los dos avisos hermanos sobre
   cierres (`cierre_dia_por_aprobar`, `devoluciones_represadas`: «para admin y bodega satélite»). El
   maestro lo ve en su campana. *Alternativa:* incluir `maestro` — una línea en `push-elegibles.ts`.
3. **Maestro y admin cuentan solo el ámbito central, no el total del sistema.** En `/cierres-admin` solo
   ven cierres con destino `bodega_central`; un aviso que dijera 5 y una pantalla que enseñara 3 marcas
   quedaría desacreditado el primer día. *Alternativa:* total global como en `devoluciones_represadas`.
4. **Sin franja en la pantalla del satélite (`/recepcion-satelite/en-bodega`).** El `adminSatelite`
   recibe campana, push y marca en su cola de cierres. *Alternativa:* la misma franja en su pantalla de
   asignación, reutilizando el componente; queda declarada para otra ficha si el humano la pide.
5. **Entidad del aviso = `${ambito}:${diaCR}` (una fila por ámbito y día, patrón 409).** Las filas de
   días consecutivos se apilan mientras la cifra viva sea > 0 y desaparecen todas a la vez al llegar a 0.
   *Alternativa:* entidad sin día (una fila por ámbito para siempre) — un «descartar» la silenciaría de
   por vida.
6. **El detalle persistido de la campana no nombra el estado del cierre; la franja y la marca sí, y en
   vivo.** El estado de un cierre cambia durante el día (rechazado → solicitado) y un texto persistido
   mentiría. *Alternativa:* persistir «solicitado/vencido/rechazado» en el detalle — texto rancio.
7. **La franja lista los cierres con enlace al detalle de cada uno.** Es la respuesta a «por qué cierre»
   en el sitio donde se asigna. *Alternativa:* solo la frase con el enlace a `/cierres-admin`.
8. **Ámbito de las retenidas sin cierre: por la zona de la orden** (`resolverDestinoCierre`), que es la
   bodega a la que volverá. Es una aproximación declarada para una población que a las 07:00 es
   normalmente vacía (el corte ya vinculó las gestiones sin cierre). *Alternativa:* por la zona del
   mensajero (una consulta más).
9. **La marca no entra en las descargas** de la cola ni del histórico. *Alternativa:* una columna más en
   el CSV — la 184 define esas columnas con su propia guardia y no es lo que se pidió.
10. **Sin emisión desde la 371.** Quien corrige está delante de la pantalla y ya lee el desenlace
    «espera su cierre»; la franja y la marca lo reflejan al instante. *Alternativa:* emitir el aviso del
    día en ese momento (un cuarto disparador y un push a media mañana).

## Fuera de alcance

- Cambiar la regla 276, el tope de intentos o los disparadores de liberación.
- Avisar al mensajero o a la tienda de la retención.
- Renombrar estados o resultados (455) y reescribir avisos ya emitidos.
- Una pantalla nueva: las cuatro superficies viven en piezas existentes.
- Ordenar la cola de `/cierres-admin` por retenidas.
