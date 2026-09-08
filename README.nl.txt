Deze app voegt ondersteuning van Gree-compatibele HVAC's toe aan Homey.

Ondersteunde Wi-Fi HVAC's:
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

Als je hebt vastgesteld dat je HVAC werkt met deze app en je het merk hierboven niet terugziet, maak dan a.u.b. een ticket aan zodat we de ondersteuning voor dit merk kunnen vermelden.

Deze app is getest met het volgende apparaat: Cooper & Hunter Alpha CH-S18FTXE.


VERBINDINGSMODI

Deze app biedt twee apparaattypen. Voeg elke airco toe via één ervan, niet via beide.

EWPE Smart airco's (lokaal netwerk)
• De standaard. Communiceert direct met de airco via je wifinetwerk, werkt binnen enkele seconden bij en heeft geen account nodig. Gebruik dit wanneer het werkt.

Gree Cloud airco's (Gree-account)
• Bedient de airco via de servers van Gree met je Gree-account. Langzamer (de status wordt ongeveer één keer per minuut opgevraagd) en afhankelijk van de bereikbaarheid van de Gree-cloud, maar het werkt wanneer het lokale protocol dat niet doet: bijvoorbeeld wanneer de airco op een ander netwerk of VLAN zit, wanneer UDP wordt geblokkeerd, of bij nieuwere firmware en cloud-only units die niet op lokale detectie reageren.
• Gree staat maar één actieve aanmelding per account toe. Wanneer Homey inlogt, wordt de Gree+ / EWPE Smart-app op je telefoon uitgelogd en kan die waarschuwen dat iemand anders je wachtwoord kent. Wil je de telefoonapp blijven gebruiken, maak dan een tweede Gree-account aan, nodig het in de Gree+-app als gezinslid uit voor je woning en log Homey in met dat tweede account.
• Je e-mailadres en wachtwoord worden op je Homey opgeslagen zodat die zelf opnieuw kan inloggen, en worden alleen gebruikt om met de servers van Gree te communiceren. De cloud-API is niet door Gree gepubliceerd en kan dus zonder aankondiging veranderen of stoppen met werken.

OPMERKINGEN

Ventilatorsnelheid
• De "Medium Laag" en "Medium Hoog" ventilatorsnelheden zijn niet beschikbaar voor HVAC's met 3 snelheden, zoals de Argo Milo Plus.

X-Fan
• De "X-Fan" modus kan automatisch door het apparaat worden uitgeschakeld wanneer de HVAC-modus wordt omgeschakeld naar Droog of Koel.
• Dit betekent dat je het handmatig moet inschakelen wanneer je de HVAC-modus wijzigt naar Droog of Koel en je het wilt blijven gebruiken.

Verticale zwaai
• "Uitgeschakeld"/"Standaard" positie betekent dat de verticale zwaai wordt gestopt en op de huidige positie blijft staan.
