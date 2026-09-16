Ta aplikacja dodaje do Homey obsługę klimatyzatorów zgodnych z Gree.

Obsługiwane klimatyzatory Wi-Fi:
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

Jeśli okazało się, że Twój klimatyzator działa, a jego marki nie ma na powyższej liście, utwórz zgłoszenie (issue), abyśmy mogli dodać tę markę jako zgodną.

Ta aplikacja została przetestowana z urządzeniem Cooper & Hunter Alpha CH-S18FTXE.


TRYBY POŁĄCZENIA

Ta aplikacja udostępnia dwa typy urządzeń. Dodaj każdy klimatyzator przez jeden z nich, nie przez oba.

Klimatyzatory EWPE Smart (sieć lokalna)
• Opcja domyślna. Komunikuje się z klimatyzatorem bezpośrednio przez sieć Wi-Fi, aktualizuje się w ciągu kilku sekund i nie wymaga konta. Używaj jej, kiedy tylko działa.

Klimatyzatory Gree Cloud (konto Gree)
• Steruje klimatyzatorem przez serwery Gree za pomocą Twojego konta Gree. Wolniejsze (stan odpytywany jest około raz na minutę) i zależne od dostępności chmury Gree, ale działa tam, gdzie protokół lokalny zawodzi: na przykład gdy klimatyzator jest w innej sieci lub VLAN-ie, gdy UDP jest zablokowany, albo w przypadku nowszego oprogramowania i urządzeń działających wyłącznie w chmurze, które nigdy nie odpowiadają na lokalne wykrywanie.
• Gree pozwala tylko na jedno aktywne zalogowanie na konto. Gdy Homey się zaloguje, aplikacja Gree+ / EWPE Smart w telefonie zostanie wylogowana i może ostrzec, że ktoś inny zna Twoje hasło. Aby dalej korzystać z aplikacji w telefonie, utwórz drugie konto Gree, zaproś je w aplikacji Gree+ jako członka rodziny do swojego domu i zaloguj Homey tym kontem.
• Twój adres e-mail i hasło są przechowywane na Homey, aby mógł samodzielnie zalogować się ponownie, i służą wyłącznie do komunikacji z serwerami Gree. Interfejs API chmury nie jest publikowany przez Gree, więc może się zmienić lub przestać działać bez ostrzeżenia.

UWAGI

Prędkość wentylatora
• Tryby prędkości "Średnio niska" i "Średnio wysoka" nie są dostępne dla klimatyzatorów 3-biegowych.

X-Fan
• Tryb "X-Fan" może zostać automatycznie wyłączony przez klimatyzator podczas przełączania trybu HVAC z osuszania i chłodzenia.
• Oznacza to, że musisz włączyć go ręcznie przy przełączaniu na tryb osuszania/chłodzenia, jeśli chcesz z niego korzystać.

Wahanie pionowe
• Pozycja "Wyłączone"/"Domyślne" oznacza, że wahanie pionowe zostanie zatrzymane i pozostanie w bieżącej pozycji.
