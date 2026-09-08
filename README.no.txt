Denne appen legger til støtte for Gree-kompatible klimaanlegg i Homey.

Støttede Wi-Fi-klimaanlegg:
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

Hvis du har oppdaget at klimaanlegget ditt fungerer og merket ikke er nevnt ovenfor, opprett gjerne en sak (issue) slik at vi kan legge til dette merket som kompatibelt.

Denne appen er testet med Cooper & Hunter Alpha CH-S18FTXE.


TILKOBLINGSMÅTER

Denne appen tilbyr to enhetstyper. Legg til hvert klimaanlegg via én av dem, ikke begge.

EWPE Smart klimaanlegg (lokalt nettverk)
• Standardvalget. Kommuniserer direkte med klimaanlegget over Wi-Fi-nettverket, oppdateres i løpet av sekunder og krever ingen konto. Bruk dette når det fungerer.

Gree Cloud klimaanlegg (Gree-konto)
• Styrer klimaanlegget via Grees servere med Gree-kontoen din. Langsommere (statusen hentes omtrent én gang i minuttet) og avhengig av at Gree-skyen er tilgjengelig, men det fungerer der den lokale protokollen ikke gjør det: for eksempel når klimaanlegget er på et annet nettverk eller VLAN, når UDP er blokkert, eller med nyere fastvare og enheter som bare virker via skyen og aldri svarer på lokal oppdagelse.
• Gree tillater bare én aktiv innlogging per konto. Når Homey logger inn, blir Gree+ / EWPE Smart-appen på telefonen logget ut og kan advare om at noen andre kjenner passordet ditt. Vil du fortsette å bruke mobilappen, oppretter du en ny Gree-konto, inviterer den som familiemedlem til hjemmet ditt i Gree+-appen og logger inn Homey med den kontoen.
• E-postadressen og passordet ditt lagres på Homey slik at den kan logge inn på nytt selv, og brukes bare til å kommunisere med Grees servere. Sky-API-et er ikke publisert av Gree, så det kan endres eller slutte å virke uten varsel.

MERKNADER

Viftehastighet
• Hastighetsmodusene "Middels lav" og "Middels høy" er ikke tilgjengelige for klimaanlegg med 3 hastigheter.

X-Fan
• "X-Fan"-modus kan slås av automatisk av klimaanlegget når HVAC-modus byttes fra Avfukting og Kjøling.
• Det betyr at du må slå den på manuelt når du bytter til Avfukting-/Kjøling-modus hvis du vil bruke den.

Vertikal svinging
• Posisjonen "Deaktivert"/"Standard" betyr at den vertikale svingingen stoppes og blir stående i gjeldende posisjon.
