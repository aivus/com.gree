Esta app añade a Homey compatibilidad con HVAC compatibles con Gree.

HVAC Wi-Fi compatibles:
• Gree
• Argo
• Cooper & Hunter
• Daitsu
• Tosot
• Wilfa
• Innova
• Tadiran
• Copmax
• Syen
• Trane
• Proklima
• Heiwa
• Ekokai
• Lessar
• Altech

Si has comprobado que tu HVAC funciona y la marca no aparece arriba, crea una incidencia para añadir esta marca como compatible.

Esta app se ha probado con un Cooper & Hunter Alpha CH-S18FTXE.


MODOS DE CONEXIÓN

Esta app ofrece dos tipos de dispositivo. Añade cada aire acondicionado mediante uno de ellos, no los dos.

Aires acondicionados EWPE Smart (red local)
• La opción predeterminada. Se comunica directamente con el equipo a través de tu red Wi-Fi, se actualiza en segundos y no necesita cuenta. Úsala siempre que funcione.

Aires acondicionados Gree Cloud (cuenta Gree)
• Controla el equipo a través de los servidores de Gree con tu cuenta Gree. Más lento (el estado se consulta aproximadamente una vez por minuto) y dependiente de que la nube de Gree esté accesible, pero funciona donde el protocolo local no lo hace: por ejemplo cuando el equipo está en otra red o VLAN, cuando UDP está bloqueado, o con firmware más reciente y equipos exclusivos de nube que nunca responden a la detección local.
• Gree solo permite un inicio de sesión activo por cuenta. Cuando Homey inicia sesión, la app Gree+ / EWPE Smart del teléfono se cierra y puede avisarte de que otra persona conoce tu contraseña. Para seguir usando la app del teléfono, crea una segunda cuenta Gree, invítala como miembro de la familia a tu hogar en la app Gree+ e inicia sesión en Homey con esa segunda cuenta.
• Tu dirección de correo y tu contraseña se guardan en tu Homey para que pueda volver a iniciar sesión por sí mismo, y solo se usan para comunicarse con los servidores de Gree. La API de la nube no está publicada por Gree, por lo que puede cambiar o dejar de funcionar sin avisar.

NOTAS

Velocidad del ventilador
• Los modos de velocidad "Medio bajo" y "Medio alto" no están disponibles para HVAC de 3 velocidades.

X-Fan
• El modo "X-Fan" puede ser apagado automáticamente por el aire acondicionado al cambiar el modo HVAC desde Deshumidificar y Enfriar.
• Esto significa que debes activarlo manualmente al cambiar al modo Deshumidificar/Enfriar si quieres usarlo.

Oscilación vertical
• La posición "Desactivado"/"Predeterminado" significa que la oscilación vertical se detendrá y permanecerá en la posición actual.
