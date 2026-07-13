# Racing Physical Phone HTTPS Test

Motion sensors on real phones usually require a secure context. For local testing, use one of these methods:

## HTTPS Tunnel

1. Start Pocket Arena normally:

   ```sh
   npm run dev
   ```

2. Start an HTTPS tunnel to port 3000 with your preferred tool.
3. Restart Pocket Arena with the tunnel as the public base URL:

   ```sh
   PUBLIC_BASE_URL=https://your-tunnel.example npm run dev
   ```

4. Open the printed local host URL on the laptop. QR codes should now point at the HTTPS tunnel.

## Local HTTPS Certificate

If your phone trusts a local certificate, start the server with certificate files:

```sh
HTTPS_KEY_FILE=certs/local-key.pem HTTPS_CERT_FILE=certs/local-cert.pem npm run dev
```

The printed LAN URL and QR URLs will use `https://`.

## Acceptance Flow

Run this exact flow on a physical phone:

1. Create a Racing room on the host.
2. Scan the QR code.
3. Enter a nickname.
4. Tap Enable Motion.
5. Grant motion permission if prompted.
6. Rotate the phone sideways.
7. Complete calibration.
8. Verify all four checks before Ready unlocks:
   - Turn left: steering becomes negative.
   - Turn right: steering becomes positive.
   - Tilt top edge away: throttle rises.
   - Tilt top edge toward player: brake rises.
9. Tap Ready.
10. Start the race from the host.
11. Confirm the car turns, accelerates, and brakes from phone input.

Also verify:

- `window.isSecureContext` is true in `?dev=1` diagnostics.
- Backgrounding the phone neutralizes input.
- Disconnecting neutralizes input.
- Recalibrating clears Ready verification and neutralizes input.
- Reconnecting does not create duplicate sensor loops.
- Landscape-left and landscape-right are both tested when available.
