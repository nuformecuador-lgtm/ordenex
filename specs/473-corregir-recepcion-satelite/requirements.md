# 473 — Corregir la recepción de dinero de una satélite · requirements

> Fuente: `progress/investigacion_corregir_recepcion_satelite.md` (2026-10-05) y la ficha 473 de
> `feature_list.json`. Alcance: **arreglo mínimo**. Hoy «Corregir» (solo visible en «Recibido
> incompleto») llama a la acción de MARCAR, cuyo `WHERE` exige una consolidación SIN marcar
> (`CierresBodegaAdminRepository.ts:528`): responde `conflict` el 100 % de las veces sin escribir
> nada, y el aviso promete «Actualizando la lista» sin refrescar. El único caso real (FGAM Zona Sur,
> 2026-10-01) se corrigió a mano con Desmarcar + Marcar.
>
> Vocabulario: **consolidación** = una fila de `cierre_bodega`. **Conciliada** = tiene marca de
> recibido. **Declarado** = el efectivo que la bodega dijo que mandó. Los tres estados visibles
> («Pendiente de conciliar», «Recibido incompleto», «Recibido») son los que ya deriva la pantalla
> hoy: incompleto = conciliada y declarado − recibido > 0.

## Requisitos

### Corrección del monto (servidor)

- **R1** — CUANDO un usuario con acceso total confirma una corrección con un monto válido sobre una
  consolidación conciliada, el sistema DEBE sustituir su monto recibido por el monto nuevo en una
  sola operación, y la consolidación DEBE seguir conciliada (nunca pasar por «Pendiente de
  conciliar»).
- **R2** — CUANDO se aplica una corrección, el sistema DEBE registrar como autor e instante de la
  conciliación al usuario que corrige y el momento de la corrección.
- **R3** — CUANDO se aplica una corrección, el sistema DEBE guardar como nota de la conciliación la
  nota enviada en la corrección, y SI la corrección no trae nota, ENTONCES la consolidación DEBE
  quedar sin nota.
- **R4** — CUANDO se aplica una corrección, el sistema DEBE escribir **exactamente una** fila en el
  registro de acciones, que DEBE llevar el monto nuevo como importe, el monto anterior y el monto
  nuevo como valores anterior/nuevo, y NO DEBE llevar el texto de la nota.
- **R5** — El sistema DEBE escribir el cambio de monto y su fila del registro de acciones de forma
  atómica: o quedan los dos o no queda ninguno.
- **R6** — SI la consolidación no está conciliada en el momento de aplicar la corrección (pendiente
  de conciliar o rechazada), ENTONCES el sistema DEBE responder «conflicto» y NO DEBE escribir nada,
  ni en la consolidación ni en el registro de acciones.
- **R7** — SI la consolidación indicada no existe, ENTONCES el sistema DEBE responder «no
  encontrada» y NO DEBE escribir nada.
- **R8** — SI el monto recibido de la consolidación cambia entre la lectura del monto anterior y la
  escritura de la corrección, ENTONCES el sistema DEBE responder «conflicto» y NO DEBE escribir nada.
- **R9** — SI quien corrige no tiene acceso total, ENTONCES el sistema DEBE responder «prohibido»
  sin leer ni escribir la consolidación.
- **R10** — SI no hay sesión, ENTONCES el sistema DEBE responder «no autenticado» sin validar la
  entrada ni ejecutar la corrección.
- **R11** — SI el monto está ausente, no es numérico, es menor o igual a cero o tiene más de dos
  decimales, o la petición trae claves no previstas, o la nota supera 500 caracteres, ENTONCES el
  sistema DEBE responder «error de validación» por campo y NO DEBE ejecutar la corrección.
- **R12** — El sistema NO DEBE escribir en ningún libro de dinero (`wallet_movimiento`,
  `wallet_tienda_movimiento`, `pago_mensajero_movimiento`) al corregir.
- **R13** — CUANDO una corrección deja el monto recibido mayor o igual que lo declarado, la
  consolidación DEBE presentarse como «Recibido» (sin faltante y sin ofrecer «Corregir»); y SI el
  monto corregido sigue siendo menor que lo declarado, ENTONCES DEBE seguir presentándose como
  «Recibido incompleto» con el faltante recalculado.

### Interfaz

- **R14** — CUANDO el usuario confirma el diálogo abierto desde «Corregir», la interfaz DEBE invocar
  la operación de corrección y NO DEBE invocar la de marcar; y CUANDO lo confirma desde «Marcar
  recibido», DEBE invocar la de marcar y NO la de corrección.
- **R15** — MIENTRAS el diálogo esté en modo corrección, su botón de confirmar DEBE rotularse
  «Corregir» (no «Marcar recibido») y el campo de monto DEBE arrancar con el monto ya registrado.
- **R16** — CUANDO la corrección responde éxito, la interfaz DEBE cerrar el diálogo, mostrar un aviso
  que diga el monto corregido y refrescar la lista de la pantalla que lo monta.
- **R17** — CUANDO marcar o corregir responden «conflicto», la interfaz DEBE cerrar el diálogo,
  mostrar el aviso de conflicto y refrescar la lista de la pantalla que lo monta, de modo que lo que
  el aviso dice («Actualizando la lista») ocurra de verdad.

## Fuera de alcance

- Tipo nuevo de historial / migración de enum (ver `design.md §3`, decisión D1).
- Detectar que OTRA persona corrigió mientras el diálogo estaba abierto (el cliente no envía el
  monto que vio). Ver `design.md §5`.
- Cambios en «Marcar recibido» y «Desmarcar» salvo el comportamiento ante conflicto (R17).
- Pruebas E2E (no hay harness en el repo).

## Preguntas abiertas

Ninguna bloqueante. Dos decisiones técnicas tomadas con evidencia que el humano puede revertir al
aprobar (detalle en `design.md`):

1. **D1 — tipo de historial.** Se REUTILIZA `cierre_bodega_conciliado` (sin migración), y la fila de
   una corrección se distingue de la de una marca por llevar `valor_anterior` (la marca lo deja
   nulo). La pantalla del registro la rotulará «Marcó recibida una consolidación de bodega». Si se
   prefiere un rótulo propio («Corrigió el monto recibido…»), la alternativa es un tipo nuevo con
   migración de enum, descrita y costeada en `design.md §3`.
2. **D3 — la corrección mueve la fecha de la conciliación** (y su espejo `resuelto_at`), igual que hoy
   lo hace el rodeo Desmarcar + Marcar: la consolidación pasa a contar en el periodo de la
   corrección en la analítica financiera.
