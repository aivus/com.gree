# Gree

This app adds support of Gree compatible HVACs to Homey.

![Gree HVAC](https://raw.githubusercontent.com/aivus/com.gree/master/assets/images/small.png)


## Donation
This app is an Open Source Software developed in free time by one developer.

If you want to thank the author of this app you can use [GitHub Sponsors](https://github.com/aivus/com.gree?sponsor=1), [PayPal](https://www.paypal.me/iantypenko) or [Patreon](https://patreon.com/aivus)

## Supported Wi-Fi HVACs
* Gree
* Argo
* Cooper & Hunter
* Daitsu
* Tosot
* Wilfa
* Innova
* Tadiran
* Copmax
* Syen
* Trane
* Proklima
* Heiwa
* Ekokai
* Lessar
* Altech

*This app is tested using Cooper & Hunter Alpha CH-S18FTXE*

*If you found that your HVAC works and brand is not mentioned above please create an issue to add this brand as compatible*

## Connection modes

This app offers two device types. Add each air conditioner through **one** of them, not both.

### EWPE Smart HVACs (local network)
The default. Talks to the HVAC directly over your Wi-Fi network, updates within seconds and needs no account. Use this whenever it works.

### Gree Cloud HVACs (Gree account)
Controls the HVAC through Gree's servers using your Gree account. Slower (status is polled about once a minute) and depends on Gree's cloud being reachable, but it works when the local protocol does not — for example when the HVAC is on another network or VLAN, when UDP is blocked, or with newer firmware and cloud-only units that never answer local discovery.

**Gree allows only one active sign-in per account.** When Homey signs in, the Gree+ / EWPE Smart app on your phone is signed out and may warn you that someone else knows your password. To keep using the phone app, create a second Gree account, invite it as a family member to your home in the Gree+ app, and sign Homey in with that second account.

Your e-mail address and password are stored on your Homey so it can sign in again on its own, and are only used to talk to Gree's servers. The cloud API is not published by Gree, so it may change or stop working without notice.

## Notes
### Fan speed
"Medium Low" and "Medium High" speed modes are not available for 3-speed HVACs

### X-Fan
"X-Fan" mode might be turned off automatically by AC in case of switching HVAC mode from Dry and Cool.

That means you need to turn it on manually when switch to Dry/Cool mode if you want to use it.

### Vertical swing
"Disabled"/"Default" position means that vertical swing will be stopped and left on the current position.

## Links
[Gree app in Homey Apps](https://apps.athom.com/app/com.gree)

[Support topic on Homey Community Forum](https://community.athom.com/t/gree-hvac-app/30801)

## Translation
Help wanted to verify and update any incorrect translation.

Feel free to create issues/pull requests.
