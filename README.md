# Gree

This app adds support of Gree compatible HVACs to Homey.

![Gree HVAC](https://raw.githubusercontent.com/aivus/com.gree/master/assets/images/small.png)

## Supported devices
* Gree Wi-Fi HVACs
* Cooper&Hunter Wi-Fi HVACs
* Daitsu Wi-Fi HVACs
* Tosot Wi-Fi HVACs

*If you found that your HVAC works and brand is not mentioned above please create an issue to add this brand as compatible*

## Links
[Gree app in Homey Apps](https://apps.athom.com/app/com.gree)

[Gree app GitHub repository](https://github.com/aivus/com.gree)

## This app is tested using next devices:
* Cooper&Hunter Alpha CH-S18FTXE (Wi-Fi)

## Translation
Help wanted to verify and update any incorrect translation.

Feel free to create issues/pull requests. 

## Changelog
v0.1.6 (21.10.2019)
* Fix connection issue in case of changing IP address by the HVAC
* Use MAC instead of HVAC name for storing ACs info
* Use fork for gree-hvac-client to catch and ignore invalid JSON
* Use fork for gree-hvac-client to prevent "Error [ERR_SOCKET_DGRAM_NOT_RUNNING]: Not running" error

v0.1.3 (02.09.2019)
* Fix connection bug when few HVACs are in use.

v0.1.0 (30.07.2019)
* First version of app.
* Allows to turn on and off
* Change HVAC modes
* Control temperature
