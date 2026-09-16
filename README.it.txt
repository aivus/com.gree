Questa app aggiunge il supporto per i condizionatori compatibili Gree a Homey.

Condizionatori Wi-Fi supportati:
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

Se hai riscontrato che il tuo condizionatore funziona e la marca non è elencata sopra, crea per favore una issue per aggiungere questa marca come compatibile.

Questa app è testata utilizzando Cooper & Hunter Alpha CH-S18FTXE.


MODALITÀ DI CONNESSIONE

Questa app offre due tipi di dispositivo. Aggiungi ogni condizionatore tramite uno dei due, non entrambi.

Condizionatori EWPE Smart (rete locale)
• L'impostazione predefinita. Comunica direttamente con il condizionatore tramite la rete Wi-Fi, si aggiorna in pochi secondi e non richiede alcun account. Usala ogni volta che funziona.

Condizionatori Gree Cloud (account Gree)
• Controlla il condizionatore tramite i server di Gree con il tuo account Gree. Più lento (lo stato viene richiesto circa una volta al minuto) e dipendente dalla raggiungibilità del cloud Gree, ma funziona dove il protocollo locale non riesce: per esempio quando il condizionatore è su un'altra rete o VLAN, quando UDP è bloccato, o con firmware più recenti e unità solo cloud che non rispondono al rilevamento locale.
• Gree consente un solo accesso attivo per account. Quando Homey accede, l'app Gree+ / EWPE Smart sul telefono viene disconnessa e può avvisarti che qualcun altro conosce la tua password. Per continuare a usare l'app sul telefono, crea un secondo account Gree, invitalo come familiare nella tua casa dall'app Gree+ e accedi con Homey usando quel secondo account.
• Il tuo indirizzo e-mail e la password sono salvati sul tuo Homey così che possa accedere di nuovo da solo, e vengono usati solo per comunicare con i server di Gree. L'API cloud non è pubblicata da Gree, quindi può cambiare o smettere di funzionare senza preavviso.

NOTE

Velocità della ventola
• Le velocità "Medio-bassa" e "Medio-alta" non sono disponibili per i condizionatori a 3 velocità.

X-Fan
• La modalità "X-Fan" potrebbe essere disattivata automaticamente dall'AC quando si cambia la modalità HVAC da Deumidificazione e Raffreddamento.
• Ciò significa che devi attivarla manualmente quando passi alla modalità Deumidificazione/Raffreddamento se vuoi usarla.

Oscillazione verticale
• La posizione "Disabilitato"/"Predefinito" significa che l'oscillazione verticale verrà fermata e lasciata nella posizione attuale.
