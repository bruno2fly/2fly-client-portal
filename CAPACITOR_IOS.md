# 2FlyFlow iOS App (Capacitor)

The client portal is wrapped as a native iOS app that loads the live site from **https://2flyflow.com**. Web updates appear in the app without resubmitting to the App Store.

## What’s done

- Capacitor + iOS platform added
- `capacitor.config.ts` points to `https://2flyflow.com` (no bundled static files)
- Info.plist: display name "2FlyFlow", camera & photo library usage descriptions
- Bundle ID: `com.2flymarketing.clientportal`
- Push Notifications plugin installed
- iOS 15.0+ deployment target

## Next steps (you do these)

### 1. App icon (1024×1024)

- Add a **1024×1024** PNG (2FlyFlow logo on blue `#1a56db`).
- Use [appicon.co](https://appicon.co) (or similar) to generate all sizes.
- Replace contents of `ios/App/App/Assets.xcassets/AppIcon.appiconset/` with the generated set.

### 2. Splash screen

- Use a blue `#1a56db` background with the white 2FlyFlow logo centered.
- Configure in Xcode or via Capacitor splash assets if you add custom images.

### 3. Build and run in Xcode

```bash
npx cap sync ios
npx cap open ios
```

In Xcode:

- Select your **Apple Developer Team** (Signing & Capabilities).
- Choose a simulator or a connected device.
- Build and run (⌘R).

### 4. App Store submission

- In [App Store Connect](https://appstoreconnect.apple.com): create app with bundle ID `com.2flymarketing.clientportal`.
- Fill in name "2FlyFlow", category Business, description, keywords, privacy URL (e.g. https://2flyflow.com/privacy.html).
- In Xcode: **Product → Archive**, then **Distribute App → App Store Connect**.

Apple Developer Program ($99/year) required: [developer.apple.com](https://developer.apple.com).
