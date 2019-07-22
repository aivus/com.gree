## Configuring HVAC WiFi

HVAC must be connected to the same WiFi network where is Homey.
It can be done using standard application, for example *EWPE Smart* ([Android](https://play.google.com/store/apps/details?id=com.gree.ewpesmart) or [iOS](https://apps.apple.com/us/app/ewpe-smart/id1189467454)) or manually using CLI (advanced users):

1. Make sure your HVAC is running in AP mode. You can reset the WiFi config by pressing MODE +WIFI (or MODE + TURBO) on the AC remote for 5s.
2. Connect with the AP wifi network (the SSID name should be a 8-character alfanumeric, e.g. "u34k5l166").
3. Run the following in your UNIX terminal:

```shell
echo -n "{\"psw\": \"YOUR_WIFI_PASSWORD\",\"ssid\": \"YOUR_WIFI_SSID\",\"t\": \"wlan\"}" | nc -cu 192.168.1.1 7000
````