/**
 * @format
 */

import 'text-encoding-polyfill';
import 'react-native-gesture-handler';
import {AppRegistry, Platform} from 'react-native';
import {getMessaging, setBackgroundMessageHandler} from '@react-native-firebase/messaging';
import notifee, {EventType} from '@notifee/react-native';
import App from './App';
import {name as appName} from './app.json';
import {displayPushNotification, handleNotificationPress} from './src/services/pushNotifications';
import {startCrashReporting} from './src/services/crashReporting';

// Before anything renders: installs Crashlytics' JS fatal-error handler, so a crash
// on the very first screen still leaves a report behind.
startCrashReporting();

// Edge function sends data-only FCM messages so the OS won't auto-display
// the notification. We render it via notifee here (in the headless JS
// task that wakes up when a high-priority data message arrives), which
// lets us use MessagingStyle with a circular avatar in background too.
setBackgroundMessageHandler(getMessaging(), async remoteMessage => {
  try {
    await displayPushNotification(remoteMessage?.data);
  } catch (e) {
    console.warn('[push] background display failed', e);
  }
});

// Android hands a tap on a backgrounded app only to this handler (getInitialNotification
// is read once, at launch), so route it here. iOS taps arrive through FCM's handlers.
// See kb/architecture/realtime.md, Push notifications.
notifee.onBackgroundEvent(async ({type, detail}) => {
  if (type !== EventType.PRESS || !detail.notification?.data) { return; }
  if (Platform.OS === 'android') {
    handleNotificationPress(detail.notification);
  } else {
    console.log('[push] background tap', detail.notification.data);
  }
});

AppRegistry.registerComponent(appName, () => App);
