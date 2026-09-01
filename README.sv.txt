Den här appen lägger till stöd för Gree-kompatibla HVAC:er i Homey.

Wi-Fi-HVAC:er som stöds:
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

Om du har upptäckt att din HVAC fungerar och märket inte finns med ovan, skapa gärna ett ärende så att vi kan lägga till märket som kompatibelt.

Den här appen har testats med Cooper & Hunter Alpha CH-S18FTXE.


ANSLUTNINGSSÄTT

Den här appen erbjuder två enhetstyper. Lägg till varje luftkonditionering via en av dem, inte båda.

EWPE Smart-luftkonditioneringar (lokalt nätverk)
• Standardvalet. Kommunicerar direkt med enheten över ditt Wi-Fi-nätverk, uppdateras inom sekunder och kräver inget konto. Använd detta när det fungerar.

Gree Cloud-luftkonditioneringar (Gree-konto)
• Styr enheten via Grees servrar med ditt Gree-konto. Långsammare (statusen hämtas ungefär en gång i minuten) och beroende av att Gree-molnet går att nå, men det fungerar där det lokala protokollet inte gör det: till exempel när enheten sitter på ett annat nätverk eller VLAN, när UDP blockeras, eller med nyare firmware och enheter som bara fungerar via molnet och aldrig svarar på lokal identifiering.
• Gree tillåter bara en aktiv inloggning per konto. När Homey loggar in loggas Gree+ / EWPE Smart-appen i telefonen ut och kan varna för att någon annan känner till ditt lösenord. Vill du fortsätta använda mobilappen skapar du ett andra Gree-konto, bjuder in det som familjemedlem till ditt hem i Gree+-appen och loggar in Homey med det kontot.
• Din e-postadress och ditt lösenord lagras på din Homey så att den kan logga in igen på egen hand, och används bara för att kommunicera med Grees servrar. Moln-API:et är inte publicerat av Gree och kan därför ändras eller slutas fungera utan förvarning.

ANMÄRKNINGAR

Fläkthastighet
• Hastighetslägena "Medellåg" och "Medelhög" är inte tillgängliga för HVAC:er med 3 hastigheter.

X-Fan
• "X-Fan"-läget kan slås av automatiskt av AC:n när HVAC-läget växlas från Avfuktning och Kyla.
• Det innebär att du måste slå på det manuellt när du växlar till läget Avfuktning/Kyla om du vill använda det.

Vertikal svängning
• Positionen "Inaktiverad"/"Standard" innebär att den vertikala svängningen stoppas och lämnas i den aktuella positionen.
