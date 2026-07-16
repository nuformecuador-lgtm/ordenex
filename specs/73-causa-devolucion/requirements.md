# Feature 73 — Causa tipificada de la devolución — requirements.md

> **Estado: gate F1.4 APROBADA por el humano el 2026-07-15.** Todas las preguntas abiertas
> quedaron RESUELTAS; sus decisiones y el razonamiento que las produjo se conservan al final
> del documento como registro (§F1.4). Este spec ya es implementable.

> Pedido literal del humano (2026-07-15): *"en el item devolver debe listar las opciones
> Cliente no localizado, numero de celular errado, direccion errada, el motivo(textarea) es
> obligatorio"*.
>
> Esta feature tipifica el **POR QUÉ** falló un intento de entrega. Hoy ese porqué es texto
> libre (`gestion_orden.motivo`, `String?`). **NO** toca los intentos de entrega: esos ya los
> resolvió la feature 47 (done) y los deriva la 49. Esta feature NO cambia el contador, ni el
> umbral, ni la regla de reintento/escalado.
>
> Notación EARS. Cada `R<n>` es testeable y mapea a un test concreto (ver `tasks.md`).
> Zona: fullstack. Complejidad: medium. Depende de la feature 47.

## ⚠ Alcance: la columna nace de SOLO ESCRITURA (decisión consciente, F1.4-c)

**Esta feature CAPTURA la causa; NO la muestra en ninguna parte.** El humano eligió
explícitamente, en la gate F1.4 del 2026-07-15, la alternativa "sólo capturar" sobre la
recomendación del spec_author de mostrarla en la línea de tiempo del historial.

Consecuencia deliberada: durante este ciclo la columna `gestion_orden.causa_devolucion` se
escribe y **nadie la lee** desde la aplicación. Mostrarla y agruparla ("devoluciones por
causa", detección de tiendas con datos malos) es **follow-up**, no parte de esta feature.

> **Para quien lea este spec dentro de 3 meses:** que la causa no se vea en la UI **no es un
> olvido ni un bug** — es una decisión registrada. La captura y el esquema se entregan ahora
> para empezar a acumular el dato; la lectura llega después. Si encuentras esta columna sin
> consumidores, ese es el estado esperado y aprobado.

## Glosario

- **Causa de devolución:** valor de una lista CERRADA que tipifica por qué falló el intento
  de entrega. Es un dato ESTRUCTURADO (consultable/agrupable), distinto del `motivo`.
- **Motivo:** el textarea de texto libre que YA existe y YA es obligatorio en la rama
  `devuelta` (`motivoSchema`, `lib/types/gestion-orden.ts:93`). Esta feature lo CONSERVA tal
  cual y añade la causa APARTE; no lo sustituye ni afloja su obligatoriedad.
- **Rama `devuelta`:** la variante `resultado = "devuelta"` de `gestionarSchema`
  (`lib/types/gestion-orden.ts:112-116`) y de `GestionarInput`
  (`IMisAsignacionesService.ts:93`). Único alcance de esta feature.
- **Intento de entrega fallido (feature 47):** una gestión con `resultado = devuelta`. El
  contador es DERIVADO del historial (`OrdenHistorialService.contarIntentos`, feature 49) y
  el umbral es configurable (`lib/config/reintentos.ts`, default 3).
- **Fuente única de verdad (SEED):** módulo que lista los valores del enum y los ancla al
  enum de Prisma con un chequeo de exhaustividad que rompe el build si divergen (patrón
  `METODO_PAGO_SEED`, `lib/types/metodo-pago.ts`).

## Estado actual verificado contra el código

- `gestionarSchema` rama `devuelta` pide SOLO `{ordenId, resultado, motivo}`.
- `motivoSchema` (`:93`) YA es `z.string().trim().min(1, "motivo requerido")` → obligatorio.
- UI: `GestionarOrdenPanel.tsx:437-439` (rama `devuelta` → `<MotivoField>` a secas).
- `gestion_orden.motivo` (`db/schema.prisma:392`) es `String?` compartido por
  REPROGRAMAR/DEVOLUCIÓN/RECHAZO.
- NO existe hoy ninguna noción de causa tipificada en el esquema, el borde ni la UI.
- `components/ui/` NO tiene `radio-group`, y sus primitivas se construyen sobre
  `@base-ui/react` (v1.6), NO sobre Radix/shadcn-CLI (ver `design.md §6` y F1.4-f).

---

## Catálogo de causas (lista cerrada, decisión (c) del humano)

**R1** — El sistema DEBE reconocer EXACTAMENTE tres causas de devolución, identificadas por
los valores `not_found`, `wrong_number` y `wrong_address`. El sistema NO DEBE ofrecer una
opción "Otro" ni aceptar un valor fuera de esa lista.

**R2** — El sistema DEBE mantener UNA sola fuente de verdad del par valor→etiqueta,
consumida tanto por la validación de borde (servidor) como por el selector (cliente), de
modo que el enum persistido, el schema de validación y la UI NO puedan divergir. SI el enum
persistido gana o pierde un valor que la fuente de verdad no lista, ENTONCES el build DEBE
romper (patrón `METODO_PAGO_SEED` + `_EnsureExhaustive`, `lib/types/metodo-pago.ts:13-21`).

**R3** — CUANDO la interfaz presenta una causa de devolución, el sistema DEBE mostrar su
etiqueta legible en español —"Cliente no localizado", "Número de celular errado", "Dirección
errada"— y NUNCA el valor crudo del enum (`not_found`/`wrong_number`/`wrong_address`),
reutilizando el patrón de presentación de `estatus-label`
(`app/(app)/ordenes/_components/estatus-label.ts`). El mapa de etiquetas DEBE estar anclado
al catálogo por tipo, de forma que añadir o quitar una causa rompa el build.

## Captura: selector obligatorio en la rama `devuelta`

**R4** — CUANDO un mensajero elige el resultado "Devolver" en el panel de gestión, el sistema
DEBE presentarle las tres causas de R1 para que escoja UNA, además del textarea de motivo.

**R5** — CUANDO un mensajero elige un resultado distinto de "Devolver"
(`entregada`/`reprogramada`/`rechazada`), el sistema NO DEBE presentar el selector de causa.

**R6** — El sistema DEBE exigir una causa para registrar una gestión `devuelta`: SI la
entrada de una gestión `devuelta` no trae causa, o trae un valor fuera del catálogo (R1),
ENTONCES el sistema DEBE rechazarla con un error asociado al campo de la causa y NO DEBE
producir efecto alguno (ni gestión, ni cambio de estado, ni transición de seguimiento de la
feature 47).

**R7** — El sistema DEBE CONSERVAR la obligatoriedad YA existente del motivo (texto libre) en
la rama `devuelta`: SI una gestión `devuelta` llega sin motivo o con motivo en blanco,
ENTONCES el sistema DEBE seguir rechazándola como hoy. La causa NO sustituye al motivo ni
afloja su validación.

**R8** — SI una gestión `devuelta` llega sin causa Y sin motivo, ENTONCES el sistema DEBE
reportar AMBOS errores por campo (causa y motivo) en la misma respuesta, sin efectos.

**R9** — El sistema DEBE validar la causa en el BORDE con el MISMO schema en cliente y
servidor (patrón de la feature 36/R24: `gestionarSchema` se usa en
`GestionarOrdenPanel.handleConfirm` y se revalida en la Server Action). La validación de
cliente NO DEBE ser la única defensa: una petición que evite la UI DEBE ser rechazada igual.

**R10** — El sistema NO DEBE aceptar una causa de devolución en las ramas
`entregada`/`reprogramada`/`rechazada`: la entrada discriminada por `resultado` DEBE dejar la
causa FUERA de esas tres variantes, de modo que un cliente que la envíe no consiga
persistirla.

## Persistencia: campo propio + enum (decisión (a) del humano)

**R11** — CUANDO el sistema registra una gestión `devuelta`, DEBE persistir la causa en una
COLUMNA PROPIA de `gestion_orden` respaldada por un enum nativo de Postgres, para que sea
consultable y agrupable por un consumidor FUTURO (F1.4-c: en este ciclo no hay lector).

**R12** — El sistema NO DEBE concatenar, prefijar ni embeber la causa dentro del texto libre
de `motivo`. El `motivo` DEBE persistirse EXACTAMENTE como lo escribió el mensajero, sin
decoración añadida por la causa.

**R13** — CUANDO el sistema registra una gestión `devuelta`, DEBE persistir la causa en la
MISMA transacción que registra la gestión, cambia `orden.estatus_id` y aplica la transición
de seguimiento de la feature 47. SI algo de esa transacción falla, ENTONCES la causa NO DEBE
quedar persistida (atomicidad todo-o-nada, ya provista por `crearGestionYTransicionar`).

**R14** — El sistema DEBE entregar la columna y el enum mediante una migración Prisma
versionada con su `down.sql` (`docs/architecture.md` §"Migraciones up/down"), y DEBE demostrar
el round-trip `db:migrate` → `db:rollback` → `db:migrate`.

**R15** — La migración DEBE ser ADITIVA: NO DEBE alterar ni borrar columnas, datos, índices ni
policies preexistentes de `gestion_orden`. Al no crear tabla nueva, NO introduce superficie
RLS nueva: `gestion_orden` conserva su RLS habilitada sin policies (solo service role, desde
`20260711150000`).

**R16** — El sistema DEBE preservar las gestiones `devuelta` YA existentes en la base, que no
tienen causa y cuya causa NO es derivable del texto libre. El sistema NO DEBE inventar,
adivinar ni backfillear una causa para el histórico. La columna es NULLABLE (F1.4-a) y la
obligatoriedad vive en el borde (R6), no en la base (F1.4-b).

## No regresión sobre las features 36 / 47 / 49

**R17** — El sistema NO DEBE alterar la regla de intentos de la feature 47: toda gestión
`devuelta` DEBE seguir contando como UN intento de entrega fallido, con INDEPENDENCIA de su
causa. Las devoluciones 1..N-1 DEBEN seguir devolviendo la orden a su bodega responsable
limpiando el mensajero, y la N-ésima (N = umbral) DEBE seguir escalando a `rechazada` en la
misma transacción (decisión F1.4-e: todas las causas cuentan igual).

**R18** — El sistema NO DEBE alterar el contador derivado de la feature 49
(`contarIntentos`, conteo de transiciones a `devuelta`) ni introducir una segunda fuente de
verdad de intentos. La causa es un ATRIBUTO de la gestión, no un insumo del conteo.

**R19** — El sistema NO DEBE introducir regresión en las otras tres ramas de la feature 36:
`entregada`, `reprogramada` y `rechazada` DEBEN conservar su comportamiento observable
(campos exigidos, estado destino, evidencia, atomicidad y autorización). En particular
`rechazada` DEBE conservar su motivo libre + evidencia SIN selector de causa (decisión (b)
del humano). Los tests previos DEBEN seguir pasando sin ser modificados para acomodar esta
feature.

**R20** — El sistema NO DEBE requerir un `order_status` nuevo, ni un valor nuevo del enum
`orden_historial_origen_tipo`, ni una columna materializada de contador.

## Verificación

**R21** — El sistema DEBE mantener `./init.sh` en verde y NO DEBE empeorar el baseline de
`typecheck`/`lint`/tests. El baseline DEBE MEDIRSE en un worktree limpio ANTES de implementar
y citarse con el número medido: `dev` viene de estar en rojo (feature 72) y el baseline de
typecheck NO es 0. NO DEBE afirmarse "verde" sin haberlo medido (precedente 72: baseline
falso).

**R22** — Cada `R<n>` DEBE mapear a al menos un test concreto (unit del catálogo y su
exhaustividad; unit del schema de borde por rama; unit del service/repo de la persistencia;
integración del round-trip de la migración; componente del selector; no-regresión de
36/47/49), documentado en `progress/impl_73-*.md`.

---

## §F1.4 — Preguntas abiertas: **TODAS RESUELTAS** (aprobado 2026-07-15)

> Registro de qué se decidió y por qué. Se conserva el razonamiento completo (recomendación +
> alternativa) para que la decisión sea auditable dentro de 3 meses. **No re-litigar sin una
> razón nueva.**
>
> **Nota de numeración:** al caer la visualización (F1.4-c), los tres requisitos de
> visualización que este spec proponía —ex-R17 "causa en el timeline", ex-R18 "autorización de
> la visualización", ex-R19 "omitir causa ausente"— se RETIRARON y el resto se renumeró. El
> spec quedó en **22 requisitos** (antes 25). Ningún otro documento referenciaba esos números
> (la feature aún no se implementa).

**(a) ¿La columna es NULLABLE o NOT NULL?** → ✅ **RESUELTA: NULLABLE** (recomendación
aceptada).
- **Decisión:** columna nullable + guarda en el borde (zod exige causa SÓLO en la rama
  `devuelta`, R6). El histórico `devuelta` queda sin causa.
- **Razonamiento conservado:** hay gestiones `devuelta` ya existentes cuya causa NO se puede
  derivar del texto libre; un NOT NULL exigiría inventarles un valor (o un default) — justo lo
  que el arnés prohíbe ("No inventes", CLAUDE.md §6). Además la columna es nullable POR
  NATURALEZA: `gestion_orden` es una tabla con discriminador `resultado` y campos nullable por
  rama (`monto_recibido`, `metodo_pago`, `fecha_reprogramacion`, `motivo` ya lo son). NULL =
  "gestión que no es `devuelta`, o `devuelta` anterior a la feature 73".
- **Alternativa descartada:** NOT NULL con relleno para el histórico (p. ej. `not_found` o un
  `desconocido` reservado). Fabrica un dato que nadie observó y contamina justo las métricas
  que motivan la feature; y `desconocido` reintroduce por la puerta de atrás el "Otro" que la
  decisión (c) del humano descartó.

**(b) ¿Se refuerza la obligatoriedad en la BASE, además del borde?** → ✅ **RESUELTA: SIN
CHECK en la base** (recomendación aceptada).
- **Decisión:** la obligatoriedad vive SOLO en el borde (zod, R6/R9). Sin CHECK constraint.
- **Razonamiento conservado:** es coherente con el resto de la tabla — así viven hoy las
  obligatoriedades por rama de `monto_recibido`/`metodo_pago`/`evidencia` (la feature 36 no
  puso CHECK para ninguna). Añadir un CHECK sólo para la causa sería una asimetría y
  bloquearía a las filas históricas.
- **Alternativa descartada:** `CHECK (resultado <> 'devuelta' OR causa_devolucion IS NOT NULL)
  NOT VALID` (no valida el histórico; sí las nuevas). Más rigor a coste de incoherencia.
  Barato de añadir después si algún día se quiere.

**(c) ¿DÓNDE se muestra la causa una vez guardada?** → ✅ **RESUELTA: SOLO CAPTURAR. La causa
NO se muestra en la UI en este ciclo.**
- **Decisión del humano: se eligió la ALTERNATIVA, no la recomendación del spec_author.** La
  columna nace de SOLO ESCRITURA, de forma consciente y aprobada (ver el aviso de alcance al
  inicio de este documento). Mostrarla/agruparla es **follow-up**. Caen del alcance el bloque
  B6 de `tasks.md` y los tres requisitos de visualización (ex-R17/R18/R19); el DTO del
  historial (`OrdenHistorialEntradaDTO`) y `HistorialOrdenTimeline` **NO se tocan**.
- **Razonamiento conservado (recomendación NO adoptada):** el spec_author recomendaba mostrarla
  como mínimo en la línea de tiempo del historial (`HistorialOrdenTimeline`/
  `HistorialOrdenSheet` de la 49, la misma superficie que la 47/R15 usa para "intento X de N"),
  porque `OrdenHistorialEntradaDTO` (`lib/types/orden-historial.ts:57-64`) YA lleva `motivo` y
  el timeline YA lo pinta condicionalmente → habría sido el cambio mínimo. El humano prefirió
  el ciclo más corto: empezar a acumular el dato ya, y decidir la superficie de lectura después
  con el uso real a la vista.
- **Follow-up sugerido (NO registrado por el spec_author; lo decide el leader):** una feature
  posterior que exponga la causa —línea de tiempo del historial y/o un reporte agregado
  "devoluciones por causa" / detección de tiendas con datos malos, que es la MOTIVACIÓN
  declarada de la decisión (a)—. La columna + enum de esta feature lo habilitan sin migración
  adicional.

**(d) ¿El enum se restringe a las 3 causas o reserva valores futuros?** → ✅ **RESUELTA: SOLO
3 VALORES** (recomendación aceptada).
- **Decisión:** `not_found`, `wrong_number`, `wrong_address`. Sin valores reservados.
- **Razonamiento conservado:** reservar valores que nadie escribe crea estados imposibles y
  contradice "No inventes"; `ALTER TYPE ... ADD VALUE IF NOT EXISTS` es aditivo y barato
  (precedentes verificados: `20260714160000_gestion_orden_anulacion`,
  `20260712150000_cierre_estado_vencido`), así que añadir una 4.ª causa el día que se pida NO
  es más caro por no haberla reservado hoy.
- **Alternativa descartada:** reservar valores desde ya (patrón citado de la feature 37, que
  sembró `aprobado`/`rechazado` sin usarlos aún). Evitaría una migración futura, pero el
  `down.sql` de un enum exige RECREAR el tipo (Postgres no soporta DROP VALUE): cada valor de
  más encarece la reversibilidad de HOY por un uso hipotético.

**(e) ¿Alguna causa NO debería contar como intento de entrega (feature 47)?** → ✅ **RESUELTA:
TODAS CUENTAN igual** (recomendación aceptada).
- **Decisión:** toda gestión `devuelta` cuenta como un intento, sea cual sea su causa (R17). La
  feature 47 NO se toca.
- **Razonamiento conservado:** es el comportamiento ACTUAL. La 47 definió el intento por el
  `resultado`, no por su causa, y el conteo lo deriva la 49 del historial de transiciones a
  `devuelta`: hacerlo depender de la causa exigiría reabrir el derivador de la 49 y el glosario
  legal de "mínimo 3 intentos por ley".
- **Alternativa descartada:** que, p. ej., `wrong_address` o `wrong_number` no cuenten como
  intento (culpa del dato de la tienda, no del cliente). Es una decisión de NEGOCIO con
  implicación legal; **si algún día se quiere, es una feature APARTE** (cambia el derivador de
  la 49 y la regla de la 47), nunca un ajuste silencioso dentro de la 73.

**(f) ¿UI del selector: `<select>`, radios o botones?** → ✅ **RESUELTA: RADIOS**
(recomendación aceptada).
- **Decisión:** radios (3 opciones fijas, móvil-first, sin dropdown que abrir en la calle,
  navegable por teclado y anunciado por lector de pantalla con `<fieldset>`/`<legend>`).
- **Verificación del componente (hecha tras la aprobación):** `components/ui/` **NO** tiene
  `radio-group` → hay que añadirlo, y está explicitado como task **T5.0** de `tasks.md` (no
  aparecerá por sorpresa en la implementación). **Corrección importante al design original:**
  este repo NO usa Radix — sus primitivas se construyen sobre **`@base-ui/react` v1.6**
  (`components/ui/select.tsx:4`, `checkbox.tsx:3`; `package.json:23`), igual que `Modal`/
  `Toast`. Por tanto `npx shadcn add radio-group` (Radix) es la instrucción EQUIVOCADA para
  este repo; el camino correcto es una primitiva sobre Base UI siguiendo el patrón de
  `Select`/`Checkbox`. Ver `design.md §6`.
- **Alternativas descartadas:** (1) el `<select>` ya usado para "Método de pago"
  (`GestionarOrdenPanel.tsx:378-384`) → máxima consistencia y cero componente nuevo, pero peor
  ergonomía en la calle; con 3 opciones un dropdown esconde información sin ganar espacio.
  (2) botones grandes tipo `RESULTADO_BOTONES` (`:53-86`) → ese patrón hoy significa "elegir y
  AVANZAR de paso", no "seleccionar un campo del formulario": reusarlo sería ambiguo.

**(g) ¿Nombre de la columna y del enum?** → ✅ **RESUELTA: `causa_devolucion` +
`gestion_causa_devolucion` con valores en INGLÉS. Inconsistencia ACEPTADA explícitamente.**
- **Decisión:** columna `causa_devolucion` (snake_case, `docs/conventions.md`) mapeada a
  `causaDevolucion` en Prisma; enum Postgres `gestion_causa_devolucion` / Prisma
  `GestionCausaDevolucion` (espejo de `gestion_resultado`/`GestionResultado`,
  `db/schema.prisma:374`), con valores en inglés `not_found`/`wrong_number`/`wrong_address`.
- **Registro explícito:** que los valores vayan en inglés mientras el enum hermano
  `gestion_resultado` los tiene en español (`entregada`/`devuelta`/…) es una **decisión
  consciente del humano, aceptada en la gate — NO es deuda técnica ni un descuido**. Viene del
  pedido literal (decisión (c)) y el front traduce igual (R3). No abrir tickets de
  "consistencia" por esto.
- **Alternativa descartada:** valores en español (`cliente_no_localizado`, `telefono_errado`,
  `direccion_errada`) por coherencia con `gestion_resultado` y `order_status`.
