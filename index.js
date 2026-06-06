/**
 * @format
 */

import 'text-encoding-polyfill';
import 'react-native-gesture-handler';
import {AppRegistry} from 'react-native';
import {getMessaging, setBackgroundMessageHandler} from '@react-native-firebase/messaging';
import notifee, {EventType} from '@notifee/react-native';
import App from './App';
import {name as appName} from './app.json';
import {displayPushNotification} from './src/services/pushNotifications';

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

// Tap-while-backgrounded: we can't navigate from a headless task, but the
// default press action brings the app to foreground where initPush()
// reads notifee.getInitialNotification() and routes there.
notifee.onBackgroundEvent(async ({type, detail}) => {
  if (type === EventType.PRESS && detail.notification?.data) {
    console.log('[push] background tap', detail.notification.data);
  }
});

AppRegistry.registerComponent(appName, () => App);
