# Revisión — Ficha 474 «Envíos automáticos por WhatsApp»

- **Revisor:** reviewer (subagente), 2026-10-05.
- **HEAD revisado:** `09ee9780` (`origin/feature/474-envios-automaticos-whatsapp`), con `origin/dev` ya integrado (merge `a3a7b197`).
- **Spec:** `specs/474-envios-automaticos-whatsapp/` (R1–R53 + la enmienda del leader en R16), `design-whatsapp/` (maqueta aprobada).
- **Búsqueda de código:** casi todo por lectura directa de los archivos del diff, que son nuevos y había que leerlos enteros. Usé `grep` para los productores de avisos (`new NotificacionRepository(`, uso de `tx`) y para los índices parciales de `jobs`. El grafo MCP no se consultó.

## Veredicto: **APROBADO** (para mergear a `dev`)

No encontré bloqueantes de merge. Todos los R tienen un test que existe y verifica, la seguridad y la idempotencia se sostienen, el puente está inyectado de verdad en `repoReal()` y las migraciones son reversibles.

**Antes de pasar a `done`** hay que cerrar M1–M4: `tasks.md` está sin marcar, falta ver la app real (T10.4), falta la nota de release (T11.3) y falta la entrada en `history.md`. Es el mismo criterio que en las reviews 461, 462, 465 y 473: estos puntos bloquean el `done`, no el merge. T11.4 (recorrido contra la API real de Meta) depende del despliegue y se queda abierta a propósito.

## Verificación ejecutable (lo que corrí yo)

- **Gate:** no corrí `./init.sh` (regla 5, por orden del leader). Leí `progress/gate_474_integrado.log`:
  - `modo rapido AMPLIADO` y `DATABASE_URL resuelta: los 345 archivos de tests contra Postgres SI se ejecutan`;
  - typecheck y lint pasan;
  - relacionados: 525/525;
  - guardias: 274/274;
  - integración: 432/433. El único rojo, `corte-diario-segundo-cierre-sql-real`, es ajeno a la 474 y salió verde repetido en aislado (intermitente);
  - `INIT_EXIT=0`;
  - los 15 archivos de integración de la 474 aparecen en verde. Los únicos `skipped` son los 17 de `AnaliticaPage`, que son ajenos.
- **Mis tests:** corrí en este worktree, sin `DATABASE_URL`, los **49 archivos de test no-integración del diff**: **49/49 archivos y 441/441 tests verdes**. La integración de este worktree se salta; no la cuento ni como verde ni como rojo y me apoyo en el log del leader.
- Revisé los 15 archivos de `integration/db` de la 474. Ninguno tiene un `if (!x) return` vacío: todos usan `describe.skip` sin base y siembran sus filas. El del puente (`whatsapp-envio-puente-aviso`) se autocomprueba: verifica que el aviso SÍ se creó (2 filas) antes de contar los jobs.

## Checklist (CHECKPOINTS.md)

### Especificación
- [x] `requirements.md` con R1–R53 en EARS, con la enmienda D1–D4 y la del leader en R16.
- [x] `design.md` con alternativas descartadas (§9).
- [ ] `tasks.md` con todas las tasks `[x]`: **0 de 42 marcadas**. F0–F10.3 están hechas, con evidencia en `impl_474.md`. T10.4, T11.3 y T11.4 no están hechas. → M1, M2, M3.

### Trazabilidad
- [x] Cada R1–R53 mapea a un test concreto que existe en el árbol (ver la tabla de abajo).
- [x] `progress/impl_474.md` contiene el mapa R→test de backend y de frontend, con 20 + 6 mutaciones medidas y la autocomprobación del arnés.

### Calidad de código
- [x] typecheck y lint pasan (log del leader).
- [x] Tests: 441/441 los míos sin base; integración verde en el log del leader.
- [x] E2E: no aplica. No hay harness y está declarado fuera de alcance. El webhook tocado (R38) tiene un test de cableado y un test de «200 aunque falle».

### Datos y seguridad
- [x] RLS habilitada, sin policies, en las 4 tablas nuevas (`whatsapp_envio`, `_destinatario`, `_ejecucion`, `_entrega`).
- [x] Las 3 migraciones tienen su `down.sql`. El de `job_tipo` recrea el enum con **los mismos 11 valores** que tiene `JobTipo` en `origin/dev` hoy. Comprobé que no hay ningún valor posterior a 9a9e37a8, así que no borra nada. Suelta y recrea el índice parcial de la 401, que es el único índice de `jobs` con predicado por `tipo`. La bitácora mide deploy, rollback, deploy y diff vacío.
- [x] Sin secretos. Busqué cadenas de conexión, tokens `EAA…` y JWT en el diff y en los tres gate logs commiteados: 0 resultados.
- [x] Webhook: los estados de las entregas se aplican **después** de la verificación de firma ya existente y de la ingesta. Un fallo no cambia el 200. El rango hace la operación idempotente (no retrocede).

### Capas
- [x] La action valida sesión y zod. El service hace rol y reglas, sin HTTP. El repo solo hace queries, con la idempotencia en SQL. Las interfaces están en `lib/interfaces/`.

### Permisos
- [x] Las 4 páginas son Server Components que resuelven el rol en el servidor: un rol que no sea `maestro` ve el aviso y no se lee nada.
- [x] Todas las actions hacen `unauthenticated` antes que nada. `forbidden` lo deciden el service (11 métodos) o la propia action (`listarEjecuciones`, `obtenerEjecucion`, `firmarPdfEjecucion`) **antes** de leer. `estadoAppMeta` también exige maestro.
- [x] Las mutaciones son Server Actions; no hay rutas API nuevas.

### Multi-país / configuración
- [x] No hay país, moneda ni dominio hardcodeado: el `enlace` sale de `NEXT_PUBLIC_APP_URL`/`SITE_URL`, y `ordenex.co` solo aparece como texto de **ejemplo** para Meta. Todo tiene default por env (D2).

### Verificación final
- [x] Gate `--rapido` ampliado verde (log del leader). El completo es obligatorio antes de la release a `prod` (regla 5).
- [x] Este archivo existe.
- [ ] Entrada en `progress/history.md`: falta. → M4.

## Foco pedido por el leader

1. **Trazabilidad R1–R53:** cada R tiene al menos un test que existe y que verifica. Los muestreé en el código: la enmienda de R16 tiene dos casos (rol `adminTienda` y usuario `adminTienda` con `aviso_interno`, ambos rechazados); R49 tiene el censo exacto de 18 claves más el `satisfies` medido con tsc; R50 cubre tx, `null`, filas no puenteables y el repo que lanza; R26 tiene el binding real contra Postgres.
2. **Seguridad:**
   - solo maestro, comprobado en el servidor (service o action), no solo en el menú;
   - el token va en la cabecera `Authorization`, nunca en la URL ni en los logs, que solo llevan operación, estado y código;
   - los motivos de Meta se mapean a texto fijo (`motivoMeta`);
   - el teléfono se enmascara en el repo (`detalle`) y en la vista previa;
   - el bucket se crea privado, con `upsert: false` y URL firmada de 300 s.
3. **Idempotencia:**
   - los tres únicos existen: el parcial `(envio_id, fecha_cr) WHERE origen='programado'`, el parcial `(envio_id, evento_clave, evento_referencia) WHERE origen='evento'` y el `(ejecucion_id, usuario_id)`;
   - los `ON CONFLICT` repiten el predicado y, si chocan, devuelven la fila existente;
   - «como mucho una vez» se cumple: una entrega reclamada (`en_curso`) cuya llamada a Meta lanza nunca se reenvía (el reclamo es un UPDATE condicional sobre `pendiente` y `resolverEntrega` solo actúa sobre `en_curso`);
   - las mutaciones M1, M7–M11 y M15–M16 están medidas contra Postgres.
4. **Puente:**
   - `repoReal()` devuelve `conEnviosWhatsapp(conPushWeb(new NotificacionRepository(...)))`. Es el único `new NotificacionRepository(` fuera de la tx de `orden_rechazada`, que está declarado no disponible;
   - los bindings `notificar*Real` no pasan `tx`;
   - con `tx` se sale sin consultar; con `null` (dedupe de la campana) también;
   - el trabajo va dentro de `emitirBestEffort`, que registra en el log con `cause`;
   - nunca llama a Meta en el camino del aviso;
   - M17 y M20 lo matan.
5. **Migraciones:** correctas (ver checklist).
6. **Desvíos declarados:** los acepto todos.
   - `encendido @map("activo")` y `recibida`/`rechazo_permanente` los obligan las guardias 374 y 455, sin cambio semántico.
   - La guardia push se relaja en una sola aserción y la nueva guardia la amplía.
   - La siembra duplicada en `SIEMBRAS_RECURRENTES` usa la misma `dedupe_key`, y está probada con una sola fila.
   - `soloPorEvento` y `aptoParaAdminTienda` concretan lo que el design dejaba implícito y la enmienda R16.
   - «Probar ahora guarda antes» y las diferencias con la maqueta también los acepto, con m1 y m3.
7. **Fallos mudos:** encontré uno potencial (m2) y lo dejo como menor por su alcance actual. El resto de caminos dan toast o un aviso inline: encender rechazado deja la lista de motivos y el interruptor apagado; una prueba fallida da texto y queda en el historial; sin credencial, la ejecución queda en `error` visible; sin app de Meta hay aviso R48.
8. **Alcance:** todo el diff está dentro de la ficha. Los censos se amplían, no se relajan.

## Hallazgos

### Mayores (bloquean el `done`, no el merge)

- **M1 — `tasks.md` sin marcar (0/42).** CHECKPOINTS lo exige. Hay que marcar `[x]` lo hecho (F0–F10.3, T11.1) y dejar abiertas, con nota, T10.4, T11.2 (la parte del check de Vercel), T11.3 y T11.4.
- **M2 — T10.4 no hecha: nadie ha visto la app real.** La verificación visual de frontend se hizo con un arnés temporal bajo una ruta pública, sin base, sin layout autenticado y sin middleware. Falta el recorrido de la task con la sesión de maestro contra una base migrada:
  - crear una plantilla de informe con documento y ver el aviso R48 con WhatsApp sin configurar;
  - crear un envío a hora fija y otro por evento;
  - ver los avisos de teléfono;
  - «Probar ahora» con el error visible en el historial.
- **M3 — T11.3, la nota de release, no está escrita** (design §12):
  - ninguna variable obligatoria;
  - `NEXT_PUBLIC_APP_URL`/`SITE_URL` en Production;
  - verificar con «Prueba de envío» y con un envío por evento;
  - **apagar el sistema externo de Daniel antes de encender nada**.

  T11.4 (Meta real: `GET /app` y la subida reanudable, que **nunca se han ejecutado contra Meta**) queda para después del despliegue y hay que anotarla en `impl_474.md`.
- **M4 — Falta la entrada en `progress/history.md`.**

### Menores

- **m1 — «Probar ahora» con cambios sin guardar en un envío ENCENDIDO deja los cambios en vivo.** `onProbar` llama a `guardar()`, que hace `actualizarEnvio` y re-encola si está encendido. El texto lo avisa («se guardan antes»), pero quien quiere *probar* un cambio de destinatarios o de hora lo aplica en producción sin pulsar «Guardar». Se propone deshabilitar «Probar» con cambios pendientes en un envío encendido, o pedir confirmación. No bloquea: está declarado y R39 se cumple («con la configuración guardada»).
- **m2 — Descarga del PDF en el historial: `window.open` tras un `await`** (`HistorialEnvios.tsx:283-284`). El propio repo documenta que «tras un `await` el navegador la bloquea» (`app/(app)/mi-wallet/_components/VerComprobanteMiMovimiento.tsx:44`, que abre la pestaña ANTES del await). En Safari/iOS el maestro pulsa el PDF y no pasa nada, sin aviso: es un fallo mudo. Hoy solo afecta al PDF de «Prueba de envío», pero hay que arreglarlo antes de 475/476, que son las que traen PDFs reales. Hay que calcar el patrón de `VerComprobanteMiMovimiento`.
- **m3 — Diferencias con la maqueta aprobada**, decididas por frontend y declaradas, pero el humano aprobó la maqueta:
  - la lista no tiene la columna «Destinatarios» ni «4 de 5 enviados», porque el DTO no los trae;
  - el historial va por ejecución con un desplegable y no por persona;
  - el historial no tiene filtros de fecha, resultado ni persona.

  R42 queda cumplido (solo exige el filtro por envío), así que no bloquea. Conviene que el leader confirme con Carlos si lo acepta así o abre una ficha.
- **m4 — Enmienda R16 solo al guardar o encender.** Si un usuario elegido por **usuario** cambia luego su rol a `adminTienda`, `resolverDestinatarios` lo sigue resolviendo (`adminTienda` es un rol permitido) y un informe no apto le llegaría. Hoy el único informe no apto es `aviso_interno`. Para 475 (tránsito, con datos de varias tiendas) conviene filtrar también al ejecutar.
- **m5 — `tests/unit/api/procesar-jobs-registro.test.ts` aparece reescrito entero (+334/−236)** por un cambio de fin de línea (CRLF→LF). Ignorando el CR al final de línea, el cambio real es de +8. Solo es ruido de diff, sin efecto.
- **m6 — `listarEjecuciones` parsea zod antes del chequeo de rol.** Un rol que no sea maestro con una entrada inválida recibe `validation_error` y no `forbidden`. No lee datos, así que R1 se cumple. Es solo un tema de orden.
- **m7 — La ventana de 30 s de R41 no resiste dos clics concurrentes** (`ultimaPruebaDe` seguido de `insertarPrueba`, sin único). En la UI lo cubre `ocupado`. Es aceptable.

## Mapa R → test (verificado que existe)

| R | Tests |
| --- | --- |
| R1 | `unit/services/whatsapp-envio-service.test.ts`, `unit/actions/envios-whatsapp-actions.test.ts`, `unit/services/ejecucion-envio-prueba.test.ts`, `unit/actions/estado-app-meta.test.ts`, `components/ConfiguracionEnviosWhatsappPage.test.tsx` |
| R2 | `unit/auth/menu-visibility-envios-whatsapp.test.ts`, `unit/auth/menu-visibility.test.ts` |
| R3 | `unit/services/plantilla-mensaje-informe.test.ts`, int `plantilla-mensaje-informe-checks`, `components/PlantillasInforme.test.tsx` |
| R4 | `unit/whatsapp-envios/catalogo-de-variables.test.ts`, `unit/services/whatsapp-template-port-documento.test.ts`, `PlantillasInforme.test.tsx` |
| R5 | `unit/utils/whatsapp-template-documento.test.ts`, `whatsapp-template-port-documento.test.ts`, `unit/clients/whatsapp-subida-reanudable.test.ts` |
| R6, R7 | `plantilla-mensaje-informe.test.ts`, int `plantilla-mensaje-informe-checks` (R6), `PlantillasInforme.test.tsx` |
| R8 | int `plantilla-enviables-excluye-informe`, `unit/services/plantilla-bienvenida-informe.test.ts`, `PlantillasInforme.test.tsx` |
| R9 | `unit/services/plantilla-enviar-aprobacion-sin-app-id.test.ts` |
| R10 | `plantilla-mensaje-informe.test.ts`, `unit/actions/plantillas-composition-root-474.test.ts` |
| R11–R16 | `whatsapp-envio-service.test.ts` (R16 con la enmienda), int `whatsapp-envio-defaults`, int `whatsapp-envio-resolver-destinatarios`, `components/envios-whatsapp-formulario.test.tsx` |
| R17 | `unit/services/previsualizar-destinatarios.test.ts`, int `resolver-destinatarios`, formulario |
| R18–R21 | `whatsapp-envio-service.test.ts`, `unit/services/jobs/whatsapp-envio-handlers.test.ts`, `ejecucion-envio-service.test.ts`, int `idempotencia-evento`, `EnviosWhatsappLista.test.tsx` |
| R22 | `unit/whatsapp-envios/proxima-ocurrencia.test.ts`, `unit/api/procesar-jobs-registro-envios.test.ts`, handlers |
| R23, R24 | int `whatsapp-envio-idempotencia-programado` (concurrente), handlers |
| R25 | handlers, int `whatsapp-envio-cadena-rota`, `whatsapp-envio-service.test.ts`, `EnviosWhatsappLista.test.tsx` |
| R26 | int `whatsapp-envio-puente-aviso` (binding real), `unit/notificaciones/notificacion-repo-con-envios-whatsapp.test.ts`, `unit/guards/envios-whatsapp-cableado.guardia.test.ts` |
| R27 | int `whatsapp-envio-idempotencia-evento`, handlers |
| R28–R35 | `unit/services/ejecucion-envio-service.test.ts`, int `resolver-destinatarios`, `telefono.test.ts`, `sanear-valor.test.ts`, `informe-prueba-envio.test.ts`, `whatsapp-template-documento.test.ts` |
| R36, R37 | `ejecucion-envio-service.test.ts`, handlers, int `whatsapp-envio-entrega-reclamo`, `EnviosWhatsappHistorial.test.tsx` |
| R38 | int `whatsapp-envio-entrega-estado-webhook`, `unit/services/entrega-estado-service.test.ts`, `unit/api/webhook-whatsapp-entregas.test.ts` |
| R39–R41 | `unit/services/ejecucion-envio-prueba.test.ts`, int `whatsapp-envio-prueba-limite`, actions, formulario |
| R42–R44 | int `whatsapp-envio-historial`, int `whatsapp-envio-purga-seleccion`, `unit/storage/supabase-almacen-envios-whatsapp.test.ts`, actions, handlers, `EnviosWhatsappHistorial.test.tsx` |
| R45 | `motivo-meta.test.ts`, `ejecucion-envio-sin-pii.test.ts`, `whatsapp-app-id.test.ts`, `whatsapp-subida-reanudable.test.ts`, `entrega-estado-service.test.ts` |
| R46, R47 | `unit/whatsapp-envios/catalogo-informes.test.ts`, `informe-prueba-envio.test.ts` |
| R48 | `unit/clients/whatsapp-app-id.test.ts`, `estado-app-meta.test.ts`, `components/plantillas-aviso-app-meta.test.tsx` |
| R49 | `unit/whatsapp-envios/eventos-envio.test.ts` (+ `satisfies` medido con tsc), actions, formulario |
| R50 | `notificacion-repo-con-envios-whatsapp.test.ts`, `fila-puenteable.test.ts`, guardia de cableado |
| R51, R52 | `informe-aviso-interno.test.ts`, `ejecucion-envio-prueba.test.ts`, int `puente-aviso` (claves del payload) |
| R53 | `ejecucion-envio-service.test.ts`, `catalogo-de-variables.test.ts`, `ejecucion-envio-prueba.test.ts`, formulario |
