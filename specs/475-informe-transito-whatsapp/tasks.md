# 475 — Informe de tránsito por WhatsApp — tasks

Zona `fullstack`: backend (F0–F5) y después frontend (F6), en secuencia. `[P]` = paralelizable con
las demás `[P]` de la misma fase. Gate: `./init.sh --rapido` (nunca el completo; ver design §0/§14).
Rutas de test bajo `tests/`; «int» = `tests/integration/db/` contra Postgres.

## F0 — Arranque

- [x] **T0.1** Rama `feature/475-informe-transito-whatsapp` desde la 474: si la 474 ya está en
  `origin/dev`, desde `origin/dev`; si no, desde `origin/feature/474-envios-automaticos-whatsapp`.
  Anotar el SHA de partida en `progress/impl_475.md` y comprobar
  `git merge-base --is-ancestor <sha-474> HEAD`.
  *Hecho:* existe `lib/whatsapp-envios/informes/catalogo.ts` con `INFORMES_WHATSAPP` y el SHA está anotado.
- [x] **T0.2** Base propia del worktree (clon de la local) y `node_modules` propio; `prisma migrate
  status` limpio. *Hecho:* el `.env` del worktree apunta al clon (dicho sin imprimir la credencial).

## F1 — Parámetros (depende de T0.1)

- [x] **T1.1** `lib/whatsapp-envios/informes/transito/parametros.ts`: `HITOS`, `CIERRE_LOGISTICO`,
  `ESTADOS_OFRECIDOS`, `PARTIDA_PLAZO`, `PARAMETROS_POR_DEFECTO`, `parametrosTransitoSchema` (con los
  `superRefine` de aviso < plazo, zona única, estado único, >= 1 incluido), `plazoEfectivo()`.
  Módulo puro (sin Prisma). *Hecho:* tests de T1.2 verdes.
- [x] **T1.2** `unit/whatsapp-envios/informe-transito-parametros.test.ts`: cada rechazo de R4 con su
  ruta de campo; partida exacta de R5; `ESTADOS_OFRECIDOS` = `ORDER_STATUS_SEED` − `CIERRE_LOGISTICO`
  (igualdad de conjuntos); `plazoEfectivo` con entrada, sin entrada central (10/2) y sin entrada fuera
  (20/5). *Hecho:* verde, y quitar un estado de `ESTADOS_OFRECIDOS` lo pone rojo.

## F2 — Lectura en la base (depende de T1.1)

- [x] **T2.1** `lib/interfaces/repositories/IInformeTransitoRepository.ts` y
  `lib/whatsapp-envios/informes/transito/tipos.ts` (`FilaTransito`, `ConsultaTransito`, `ZonaInforme`,
  DTO de la vista previa). Nada en `lib/types/`. *Hecho:* typecheck verde.
- [x] **T2.2** `lib/repositories/InformeTransitoRepository.ts` (design §4): `zonas`, `filasEnAlerta`,
  `contarSinHito`; `Prisma.sql`, fragmento del hito desde un mapa cerrado. *Hecho:* T2.3–T2.6 verdes.
- [x] **T2.3** [P] int `informe-transito-seleccion.test.ts`: borrada fuera; estado no incluido fuera;
  `entregado`/`devuelta_a_tienda` fuera aunque la consulta los pida; incluida dentro; solo vuelven
  las filas en alerta (una orden de la misma zona por debajo del umbral no vuelve).
  *Hecho:* verde; M1, M2, M3 matadas.
- [x] **T2.4** [P] int `informe-transito-zonas.test.ts`: dos zonas con cortes distintos y una orden
  de cada una con los mismos días (una entra, otra no); frontera exacta `hito = corte − 1 ms` entra y
  `hito = corte` no; zona leída por `zona_id` aunque el cantón/distrito «parezca» de otra zona; una
  zona ausente de `cortes` no aporta filas. *Hecho:* verde; M4, M5 matadas.
- [x] **T2.5** [P] int `informe-transito-hitos.test.ts`: central = PRIMERA entrada (orden que salió y
  volvió); transición a otro destino no cuenta; creación = `orden.created_at`; guía por
  `generacion_guia`, por creación en `por_recolectar_en_tienda` y por `ruteo_satelite`, y sin
  `num_guia` no hay hito; `contarSinHito` cuenta solo estados incluidos sin hito.
  *Hecho:* verde; M6, M7, M8, M10 matadas.
- [x] **T2.6** [P] int `informe-transito-parados.test.ts`: `ultimaTransicionAt` es la más reciente
  (con dos filas del mismo `created_at`, desempate por `id`); orden sin historial → `null`.
  *Hecho:* verde; M9 matada.
- [x] **T2.7** unit `informe-transito-repo-consultas.test.ts`: con 1 y con 500 órdenes simuladas,
  `generar` hace exactamente 3 llamadas al repositorio (R40). *Hecho:* verde.

## F3 — Cálculo y variables (depende de T1.1; [P] con F2)

- [x] **T3.1** [P] `transito/calculo.ts`: `cortesPorZona`, `clasificar`, `variables` (design §5).
  *Hecho:* T3.2 verde.
- [x] **T3.2** [P] unit `informe-transito-calculo.test.ts`: corte ⇔ `diasNaturalesCRDesde >= umbral`
  en 23:59/00:00 CR (05:59/06:00 UTC); 10/10 por vencer y 11/10 vencido; parado con `>` estricto, sin
  umbral y sin historial; zona sin entrada usa partida de su tipo; entrada de zona inexistente
  ignorada; orden de zonas (central primero, luego nº, días, nombre) y de filas (días desc, guía asc);
  ATENCIÓN por orden de flujo; `por_cobrar` exacto con montos `null`, enteros grandes
  (`99999999999.00`) y suma sin `Number`; `fecha` `DD/MM/YYYY` CR; GAM/fuera por `esCentral`.
  *Hecho:* verde; M11, M12 matadas.

## F4 — PDF (depende de T3.1)

- [x] **T4.1** `transito/pdf.ts` (design §7) con la fuente embebida de etiquetas. *Hecho:* T4.2 verde.
- [x] **T4.2** unit `pdf/informe-transito-pdf.test.ts` con `tests/unit/pdf/pdf-inspector.ts`
  (decodifica `/ToUnicode`): A4 vertical; encabezado, fecha larga y hora CR, hito en palabras;
  4 totales; ATENCIÓN presente con parados y ausente sin ellos; columnas y «—» de guía y de por cobrar;
  «N/plazo»; textos «VENCIDO» y «PARADO»; «Sin paquetes en alerta: …»; resumen de parámetros y
  sin hito; pie «Página X de Y» en todas; `₡` legible; con 200 filas, cabecera repetida y nº de filas
  dibujadas = nº de paquetes; ningún teléfono, dirección, correo, tienda, mensajero, producto ni uuid
  sembrado aparece en el texto; PDF vacío con «No hay paquetes en alerta». *Hecho:* verde.

## F5 — Informe, catálogo y vista previa (depende de F2, F3, F4)

- [x] **T5.1** `transito/informe.ts` (`crearInformeTransito`) y registro en `catalogo.ts`; descriptor
  `panel` añadido a `DescriptorParametro` (`informes/tipos.ts`). *Hecho:* T5.2–T5.4 verdes.
- [x] **T5.2** unit `whatsapp-envios/informe-transito-informe.test.ts`: metadatos de R1; variables de
  R2 (y que `catalogoDeVariables("transito")` añade `destinatario_nombre`); vacío sin
  `enviarSiVacio`; contenido a cero con él y PDF «No hay paquetes»; valores de R20; sin documento no
  hay PDF; nombre `transito-YYYY-MM-DD.pdf` con fecha CR a las 23:30 CR; error de lectura propagado con
  contexto, nunca vacío. *Hecho:* verde; M14 matada; `catalogo-informes.test.ts` de la 474 sigue verde.
- [x] **T5.3** int `informe-transito-catalogo-real.test.ts`: el informe del catálogo (no uno
  construido en el test), con una orden sembrada en alerta, devuelve `total_en_alerta = "1"`.
  *Hecho:* verde; M13 matada.
- [x] **T5.4** `lib/actions/informe-transito.ts` + unit `actions/informe-transito-actions.test.ts`:
  `unauthenticated`, `forbidden` para admin/adminSatelite/adminTienda/mensajero sin tocar el repo;
  inválido → `validation_error` con zonas; válido → conteos iguales a los de `generar` con el mismo
  doble; el doble del repo no expone escrituras. *Hecho:* verde.
- [x] **T5.5** Commit del backend, gate `./init.sh --rapido` con `INIT_EXIT` dentro del log
  (`progress/gate_475_backend.log`); revisar `skipped` (integración no saltada).
  *Hecho:* `INIT_EXIT=0` y 0 archivos de `integration/db` saltados.

## F6 — Panel (depende de T5.4; frontend)

- [x] **T6.1** `ParamsTransito.tsx` y la rama `panel` en `ParametrosInforme.tsx` (design §8).
  *Hecho:* T6.2 verde.
- [x] **T6.2** components `ParamsTransito.test.tsx` (action doblada): pinta todas las zonas con
  «entra en alerta el día N»; zona sin entrada con partida de su tipo y guardado con todas; tres
  radios; desmarcar un estado → «no entra» y número deshabilitado; «Volver a los valores de partida»;
  texto de cierre logístico; conteo «hoy entrarían N paquetes (M parados)» y sin hito; error por campo
  y sin conteo con aviso ≥ plazo. *Hecho:* verde.
- [ ] **T6.3** Ver la app (memoria «ver la app encuentra lo que la suite no»): crear un envío con el
  informe, comprobar el panel contra la maqueta y «Probar ahora» con una plantilla con documento en
  local; abrir el PDF descargado del historial. *Hecho:* capturas y observaciones en `progress/impl_475.md`.
- [x] **T6.4** Commit del frontend y gate `./init.sh --rapido` (`progress/gate_475_frontend.log`).
  *Hecho:* `INIT_EXIT=0`.

## F7 — Cierre

- [x] **T7.1** `progress/impl_475.md`: mapa R→test (abajo), tabla de mutaciones con cifras medidas,
  desvíos del spec. **Commiteado** (memoria «informe sin commitear»). *Hecho:* `git log` lo muestra.
- [ ] **T7.2** `EXPLAIN` (solo lectura, MCP de Supabase) de `filasEnAlerta` en producción con los
  valores de partida; anotar plan y tiempo. *Hecho:* anotado; si hay seq scan sobre el historial, ficha
  aparte (esta no migra).
- [x] **T7.3** `gh pr checks` verde antes de mergear (el gate no corre `next build`).

## Mapa R → test

| R | Test |
| --- | --- |
| R1 | unit `informe-transito-informe` |
| R2 | unit `informe-transito-informe` |
| R3 | unit `informe-transito-parametros` |
| R4 | unit `informe-transito-parametros`; components `ParamsTransito` (error por campo) |
| R5 | unit `informe-transito-parametros` |
| R6 | unit `informe-transito-parametros`; unit `informe-transito-calculo` |
| R7 | unit `informe-transito-calculo` |
| R8 | int `informe-transito-zonas` |
| R9 | int `informe-transito-seleccion`; int `informe-transito-zonas` |
| R10 | int `informe-transito-seleccion` |
| R11 | int `informe-transito-hitos` |
| R12 | int `informe-transito-hitos` |
| R13 | int `informe-transito-hitos` |
| R14 | int `informe-transito-hitos`; unit `informe-transito-pdf`; components `ParamsTransito` |
| R15 | unit `informe-transito-calculo` |
| R16 | unit `informe-transito-calculo`; int `informe-transito-parados` |
| R17 | unit `informe-transito-calculo`; int `informe-transito-zonas` |
| R18 | unit `informe-transito-informe` |
| R19 | unit `informe-transito-informe`; unit `informe-transito-pdf` |
| R20 | unit `informe-transito-calculo`; unit `informe-transito-informe`; int `informe-transito-catalogo-real` |
| R21 | unit `informe-transito-informe` |
| R22 | unit `informe-transito-informe` |
| R23–R33 | unit `informe-transito-pdf` (R33 en `informe-transito-informe`) |
| R34–R38 | components `ParamsTransito` |
| R39 | unit `informe-transito-actions` |
| R40 | unit `informe-transito-repo-consultas`; int `informe-transito-seleccion` |
