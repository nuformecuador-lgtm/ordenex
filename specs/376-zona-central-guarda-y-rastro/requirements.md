# Ficha 376 — la zona central se apaga sin querer, y apagarla no deja rastro

**Zona:** fullstack. **SDD:** sí. **Rama:** `fix/376-zona-central-guarda-y-rastro`.

## Problema (diagnosticado el 2026-09-07 y confirmado en el árbol real; no se re-investiga)

1. **La marca se apaga por AUSENCIA del campo.** `esCentral: z.boolean().default(false)` vive en
   `zonaFields` (`lib/types/zona.ts:26`), y `actualizarZonaSchema = crearZonaSchema` (`:94`): CREAR y
   ACTUALIZAR comparten el mismo esquema. Un payload de actualización que OMITA el campo llega al
   servicio como `false` —el `default` lo materializa— y `ZonaRepository.update` lo escribe
   (`lib/repositories/ZonaRepository.ts:217`). Nadie pidió apagar nada.
2. **Al encender la marca, la anterior se apaga en silencio.** `ZonaRepository.update:208-213` hace
   `updateMany({ where: { esCentral: true, NOT: { id } }, data: { esCentral: false } })`, y `create`
   hace lo mismo (`:107-109`). La zona que pierde la marca no aparece en el payload, no se nombra en
   ninguna respuesta y no deja rastro.
3. **El formulario solo pregunta al MARCAR.** La confirmación de
   `app/(app)/configuracion/tarifas/_components/CrearZonaForm.tsx:293` está dentro de
   `if (esCentral)`. Al desmarcar no pregunta nada.
4. **Borrar la central no está protegido.** `ZonaRepository.hardDelete` lee `{ id, nombre }` y borra;
   lo único que la frena hoy son las FK `RESTRICT` desde `orden` y `usuario`, y su rechazo se
   devuelve como `referenced` —el MISMO valor que «la zona está en uso»— para todo
   (`ZonaRepository.ts:402`). Una zona central sin órdenes ni usuarios se borra sin más.
5. **Nada garantiza que exista una zona central.** `findCentralZonaId()` (`ZonaRepository.ts:417`)
   devuelve `null` cuando ninguna zona la tiene. El índice único parcial `zona_es_central_unico`
   impone «a lo sumo una», nunca «al menos una».
6. **Con `null`, los consumidores DISCREPAN entre sí.** `GuiaAsignacionService.ts:309` y `:742`
   fallan cerrado (`GAM_NO_CONFIGURADA`, `:87`). `CierreDiaService.ts:592`,
   `LiberacionReprogramadaService.ts:164`, `DevolucionSlaService.ts:94`,
   `RecuperacionBodegaService.ts:59` y `CorteDiarioService.ts:160` caen, vía
   `resolverDestinoCierre` (`lib/utils/bodega-responsable.ts:16-23`), a `bodega_satelite` EN
   SILENCIO. `ManifiestoService.ts:213` escribe un literal de respaldo y `CierresAdminService.ts:770`
   arrastra el `null` hasta el repositorio.
7. **La marca es una entrada de la fórmula del flete y se lee VIVA.** `resolverFlete`
   (`lib/utils/ingreso-ordenex.ts:131,135`) elige `valorFleteGam` o `valorFlete` según `esCentral`, y
   ese valor no se congela hasta que `cierre_detail.es_central` lo fotografía
   (`db/schema.prisma:2239`). Mover la marca re-tarifa dos zonas enteras para todo lo que aún no está
   en un cierre.
8. **El catálogo de auditoría no tiene dónde apuntarlo.** `lib/types/historial-accion.ts` solo
   contiene `zona_borrada` para la entidad `zona`; el `design.md` §7 de la ficha 366 declaró por
   escrito que auditar la edición de una zona era una ficha aparte. Ésta.

## Medido en producción el 2026-09-07 (no es una estimación)

- **1** zona central: GAM.
- **850** órdenes vivas en GAM, de las cuales **19** `reprogramada` y **8** `devuelta`.
- **0** `adminSatelite` con zona GAM —correcto: la central la operan maestro y admin—.

Consecuencia que esta ficha NO resuelve y que hay que decir en voz alta: si GAM dejara de ser
central, el cron de liberación mandaría esas 27 órdenes a `en_bodega_satelite` de una zona sin ningún
`adminSatelite`, donde quedarían invisibles y sin transición de salida. **Eso es la ficha 377**; aquí
se cita como consecuencia medida, no como alcance.

## Decisiones y asunciones de partida

1. **ASUNCIÓN DEL LEADER, NO FIRMADA POR EL HUMANO** — el rastro de esta ficha cubre **SOLO el
   cambio de `es_central`**, no toda edición de una zona (nombre, distritos, tarifas siguen sin dejar
   huella propia). El diseño se hace de forma que ensanchar el rastro después sea barato: un tipo más
   en el mismo catálogo, escrito en el mismo punto y en la misma transacción. Ver Q1: esto necesita
   firma humana.
2. **Fuera de alcance, y por qué:** unificar el desacuerdo entre los consumidores de
   `findCentralZonaId()` —unos fallan cerrado, otros caen a satélite en silencio, otro escribe un
   literal—. Con la guarda de R5/R10, el `null` **deja de ser alcanzable desde la app** y esos
   fallbacks pasan a ser defensa en profundidad. Tocar ocho puntos de llamada en ocho servicios es un
   rediseño; el encargo es arreglar lo evidenciado.

## Requisitos (EARS)

### A — Ausente no es apagado

**R1** — CUANDO se guarde una zona EXISTENTE con un payload que NO incluya el campo de la marca de
zona central, el sistema DEBE dejar esa marca exactamente como estaba antes del guardado.

**R2** — CUANDO se CREE una zona con un payload que NO incluya el campo de la marca de zona central,
el sistema DEBE crear la zona SIN la marca.

**R3** — CUANDO un payload de guardado SÍ incluya el campo de la marca, el sistema DEBE tratar su
valor como una petición EXPLÍCITA de poner o de quitar la marca, sujeta a R5–R9.

**R4** — El sistema DEBE aplicar R1 sin alterar ninguna otra parte del guardado: nombre, distritos y
tarifas se siguen reemplazando por completo con lo que traiga el payload.

### B — Nunca sin zona central

**R5** — SI existe una zona central y un guardado pide explícitamente quitarle la marca a esa misma
zona, ENTONCES el sistema DEBE rechazar el guardado COMPLETO y no aplicar ninguno de sus cambios.

**R6** — CUANDO el sistema rechace un guardado por R5, DEBE responder con un motivo que señale el
campo de la marca de zona central y que sea distinguible de cualquier otro error de validación de la
zona.

**R7** — El sistema DEBE hacer cumplir R5 en el servidor, de modo que un guardado que llegue sin
pasar por el formulario reciba exactamente el mismo rechazo.

**R8** — MIENTRAS no exista ninguna zona central, el sistema DEBE aceptar guardar y crear zonas sin
la marca.

**R9** — CUANDO un guardado ponga la marca en una zona que no la tenía y otra zona sí la tuviera, el
sistema DEBE trasladar la marca —la zona guardada la gana, la otra la pierde— y terminar con
EXACTAMENTE una zona central.

### C — Borrar la zona central

**R10** — SI se pide borrar la zona que tiene la marca de zona central, ENTONCES el sistema DEBE
rechazar el borrado y no borrar nada, exista o no alguna orden o algún usuario que la referencie.

**R11** — CUANDO el sistema rechace un borrado por R10, DEBE responder con un motivo distinguible del
rechazo por «la zona está en uso», de forma que quien lo lea sepa cuál de los dos ocurrió sin
inferirlo.

### D — El rastro

**R12** — CUANDO un guardado o una creación cambie efectivamente la marca de zona central, el sistema
DEBE registrar en el historial de acciones UNA fila por CADA zona cuya marca haya cambiado, incluida
la zona que la pierde sin que nadie la haya nombrado en el payload.

**R13** — Cada fila de R12 DEBE identificar quién hizo el cambio, cuándo, sobre qué zona, y qué valor
tenía la marca antes y después.

**R14** — Ninguna fila de R12 DEBE contener datos del destinatario de una orden ni texto libre
escrito por una persona.

**R15** — Todas las filas de R12 producidas por un mismo guardado —o por una misma creación— DEBEN
compartir un identificador de lote, distinguible del de cualquier otro acto.

**R16** — El sistema DEBE clasificar el registro de R12 como una acción que MUEVE DINERO.

**R17** — El sistema DEBE escribir las filas de R12 en la MISMA transacción que el cambio de la
marca, de modo que no pueda quedar una fila sin su cambio ni un cambio sin su fila.

**R18** — SI un guardado no cambia la marca —porque la omite (R1) o porque reenvía el valor que la
zona ya tenía—, ENTONCES el sistema NO DEBE registrar ninguna fila por este mecanismo.

**R19** — SI un guardado o un borrado se rechazan (R5, R10), ENTONCES el sistema NO DEBE registrar
ninguna fila por este mecanismo.

### E — El formulario avisa antes y explica después

**R20** — CUANDO quien edita una zona quite en el formulario la marca a la zona que hoy es la
central, el sistema DEBE pedir confirmación antes de enviar nada al servidor, nombrando esa zona y
advirtiendo que tiene que existir una zona central.

**R21** — CUANDO quien crea o edita una zona ponga la marca en el formulario y ya exista otra zona
central, el sistema DEBE pedir confirmación antes de enviar nada al servidor, nombrando la zona que
perderá la marca.

**R22** — SI quien está en una confirmación de R20 o R21 la cancela, ENTONCES el sistema NO DEBE
enviar el guardado y ninguna zona DEBE cambiar.

**R23** — CUANDO el servidor rechace un guardado por R5, el formulario DEBE mostrar el motivo junto a
la casilla de la marca de zona central.

**R24** — CUANDO el servidor rechace un borrado por R10, la pantalla DEBE decir que no se puede
borrar la zona central, con un texto distinto del que usa para «la zona está en uso».

## Preguntas abiertas

**Q1 — La asunción del alcance del rastro necesita firma.** Esta ficha audita SOLO el cambio de
`es_central`. Editar el nombre de una zona, sus distritos o sus tarifas sigue sin dejar huella
propia, y las tarifas son dinero. ¿Se firma el alcance reducido —con el ensanche declarado como
ficha futura barata— o el humano quiere ya la auditoría genérica de «se editó una zona»?

**Q2 — Al DESMARCAR: ¿confirmar y enviar, o bloquear en el formulario?** Con la guarda de R5, quitar
la marca a la única zona central **siempre** termina en rechazo del servidor. El diseño elegido
(`design.md` §8) confirma y ENVÍA, y pinta el rechazo junto a la casilla (R23): así la regla vive en
UN solo sitio —el servidor— y el formulario no la duplica. La alternativa es que el formulario además
lo impida de entrada (más amable, pero es una segunda copia de la regla que un día divergirá).
¿Cuál prefiere el humano?

**Q3 — Nombre y etiqueta del tipo nuevo del catálogo.** El diseño propone `zona_central_cambiada`,
etiqueta legible «Cambió la marca de zona central», categoría «mueve dinero» (`design.md` §4). Es la
misma pregunta que la 366 cerró como su Q1. ¿Se aprueba tal cual?

**Q4 — ¿La confirmación debe decir cuántas órdenes cambian de columna de flete?** Medido el
2026-09-07: mover la marca fuera de GAM re-tarifa **850** órdenes vivas (todo lo que aún no está
congelado en un cierre). El diseño actual NO cuenta nada: la confirmación nombra las zonas, no el
impacto. Contarlo es una consulta más dentro del guardado y un número más en el modal —el precedente
existe (`ordenesReconciliadas` de la 366)—, pero no lo pidió nadie. ¿Se añade?
