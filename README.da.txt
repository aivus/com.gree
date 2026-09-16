Denne app tilføjer understøttelse af Gree-kompatible HVAC'er til Homey.

Understøttede Wi-Fi-HVAC'er:
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

Hvis du har konstateret, at din HVAC virker, og mærket ikke er nævnt ovenfor, bedes du oprette et issue, så vi kan tilføje dette mærke som kompatibelt.

Denne app er testet med Cooper & Hunter Alpha CH-S18FTXE.


FORBINDELSESMÅDER

Denne app tilbyder to enhedstyper. Tilføj hvert anlæg via én af dem, ikke begge.

EWPE Smart HVAC'er (lokalt netværk)
• Standardvalget. Kommunikerer direkte med anlægget over dit Wi-Fi-netværk, opdateres inden for sekunder og kræver ingen konto. Brug denne, når den virker.

Gree Cloud HVAC'er (Gree-konto)
• Styrer anlægget via Grees servere med din Gree-konto. Langsommere (status hentes omkring én gang i minuttet) og afhængig af, at Gree-skyen kan nås, men det virker, hvor den lokale protokol ikke gør: for eksempel når anlægget er på et andet netværk eller VLAN, når UDP er blokeret, eller med nyere firmware og enheder, der kun virker via skyen og aldrig svarer på lokal registrering.
• Gree tillader kun ét aktivt login pr. konto. Når Homey logger ind, bliver Gree+ / EWPE Smart-appen på telefonen logget ud og advarer måske om, at nogen andre kender din adgangskode. Vil du blive ved med at bruge telefonappen, så opret en ekstra Gree-konto, inviter den som familiemedlem til dit hjem i Gree+-appen, og log Homey ind med den konto.
• Din e-mailadresse og adgangskode gemmes på din Homey, så den selv kan logge ind igen, og bruges kun til at kommunikere med Grees servere. Sky-API'et er ikke offentliggjort af Gree, så det kan ændre sig eller holde op med at virke uden varsel.

BEMÆRKNINGER

Ventilatorhastighed
• Hastighederne "Mellem lav" og "Mellem høj" er ikke tilgængelige for HVAC'er med 3 hastigheder.

X-Fan
• "X-Fan"-tilstanden kan blive slået fra automatisk af airconditionanlægget, når HVAC-tilstanden skiftes fra Affugtning og Køl.
• Det betyder, at du skal slå den til manuelt, når du skifter til Affugtning/Køl-tilstand, hvis du vil bruge den.

Lodret svingning
• Positionen "Deaktiveret"/"Standard" betyder, at den lodrette svingning stoppes og efterlades i den aktuelle position.
