Cette application ajoute la prise en charge des HVAC compatibles Gree à Homey.

HVAC Wi-Fi pris en charge :
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

Si tu constates que ton HVAC fonctionne et que la marque n'est pas mentionnée ci-dessus, merci de créer une issue afin d'ajouter cette marque comme compatible.

Cette application a été testée avec le Cooper & Hunter Alpha CH-S18FTXE.


MODES DE CONNEXION

Cette application propose deux types d'appareils. Ajoutez chaque climatiseur via l'un des deux, pas les deux.

Climatiseurs EWPE Smart (réseau local)
• Le mode par défaut. Communique directement avec le climatiseur via votre réseau Wi-Fi, se met à jour en quelques secondes et ne nécessite aucun compte. Utilisez-le dès qu'il fonctionne.

Climatiseurs Gree Cloud (compte Gree)
• Contrôle le climatiseur via les serveurs de Gree avec votre compte Gree. Plus lent (l'état est interrogé environ une fois par minute) et dépendant de la disponibilité du cloud Gree, mais fonctionne là où le protocole local échoue : par exemple lorsque le climatiseur est sur un autre réseau ou VLAN, lorsque UDP est bloqué, ou avec des firmwares récents et des appareils uniquement cloud qui ne répondent jamais à la détection locale.
• Gree n'autorise qu'une seule connexion active par compte. Lorsque Homey se connecte, l'application Gree+ / EWPE Smart de votre téléphone est déconnectée et peut vous avertir que quelqu'un d'autre connaît votre mot de passe. Pour continuer à utiliser l'application mobile, créez un second compte Gree, invitez-le comme membre de la famille dans votre maison depuis l'application Gree+, et connectez Homey avec ce second compte.
• Votre adresse e-mail et votre mot de passe sont stockés sur votre Homey afin qu'il puisse se reconnecter seul, et servent uniquement à communiquer avec les serveurs de Gree. L'API cloud n'est pas publiée par Gree : elle peut donc changer ou cesser de fonctionner sans préavis.

REMARQUES

Vitesse du ventilateur
• Les modes de vitesse "Moyen faible" et "Moyen élevé" ne sont pas disponibles pour les HVAC à 3 vitesses.

X-Fan
• Le mode "X-Fan" peut être désactivé automatiquement par le climatiseur lors du passage du mode HVAC depuis Déshumidification et Refroidissement.
• Cela signifie que tu dois l'activer manuellement lorsque tu passes en mode Déshumidification/Refroidissement si tu veux l'utiliser.

Balayage vertical
• La position "Désactivé"/"Par défaut" signifie que le balayage vertical sera arrêté et laissé dans la position actuelle.
