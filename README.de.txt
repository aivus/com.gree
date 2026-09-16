Diese App fügt Homey Unterstützung für Gree-kompatible Klimaanlagen hinzu.

Unterstützte WLAN-Klimaanlagen:
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

Wenn du festgestellt hast, dass deine Klimaanlage funktioniert und die Marke oben nicht aufgeführt ist, erstelle bitte ein Issue, damit wir diese Marke als kompatibel eintragen können.

Diese App wurde mit der Cooper & Hunter Alpha CH-S18FTXE getestet.


VERBINDUNGSARTEN

Diese App bietet zwei Gerätetypen. Füge jede Klimaanlage über einen von beiden hinzu, nicht über beide.

EWPE Smart Klimaanlagen (lokales Netzwerk)
• Der Standard. Kommuniziert direkt über dein WLAN mit der Klimaanlage, aktualisiert innerhalb von Sekunden und braucht kein Konto. Nutze dies, wann immer es funktioniert.

Gree Cloud Klimaanlagen (Gree-Konto)
• Steuert die Klimaanlage über die Server von Gree mit deinem Gree-Konto. Langsamer (der Status wird etwa einmal pro Minute abgefragt) und abhängig von der Erreichbarkeit der Gree-Cloud, funktioniert aber dort, wo das lokale Protokoll versagt: etwa wenn die Klimaanlage in einem anderen Netzwerk oder VLAN hängt, wenn UDP blockiert ist, oder bei neuerer Firmware und Cloud-only-Geräten, die nicht auf die lokale Erkennung antworten.
• Gree erlaubt nur eine aktive Anmeldung pro Konto. Wenn sich Homey anmeldet, wird die Gree+ / EWPE Smart-App auf deinem Telefon abgemeldet und warnt möglicherweise, dass jemand anderes dein Passwort kennt. Um die Telefon-App weiter zu nutzen, erstelle ein zweites Gree-Konto, lade es in der Gree+-App als Familienmitglied zu deinem Zuhause ein und melde Homey mit diesem zweiten Konto an.
• Deine E-Mail-Adresse und dein Passwort werden auf deinem Homey gespeichert, damit er sich selbst neu anmelden kann, und nur für die Kommunikation mit den Servern von Gree verwendet. Die Cloud-API wird von Gree nicht veröffentlicht und kann sich daher ohne Ankündigung ändern oder ausfallen.

HINWEISE

Lüftergeschwindigkeit
• Die Geschwindigkeitsstufen "Mittel-Niedrig" und "Mittel-Hoch" sind für Klimaanlagen mit 3 Stufen nicht verfügbar.

X-Fan
• Der "X-Fan"-Modus kann vom Gerät automatisch ausgeschaltet werden, wenn der Betriebsmodus von Trocknen und Kühlen umgeschaltet wird.
• Das bedeutet, dass du ihn beim Umschalten in den Trocknen-/Kühlen-Modus manuell einschalten musst, wenn du ihn verwenden möchtest.

Vertikale Schwenkung
• Die Position "Deaktiviert"/"Standard" bedeutet, dass die vertikale Schwenkung gestoppt und in der aktuellen Position belassen wird.
