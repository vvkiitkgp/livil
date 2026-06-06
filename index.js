/**
 * @format
 */

import 'text-encoding-polyfill';
import 'react-native-gesture-handler';
import {AppRegistry} from 'react-native';
import {getMessaging, setBackgroundMessageHandler} from '@react-native-firebase/messaging';
import App from './App';
import {name as appName} from './app.json';

setBackgroundMessageHandler(getMessaging(), async remoteMessage => {
  // FCM auto-displays notifications with a `notification` payload while the
  // app is backgrounded/quit. This handler exists so the messaging module is
  // fully registered in all states and so data-only messages still wake JS.
  console.log('[push] background', remoteMessage?.notification?.title, remoteMessage?.data);
});

AppRegistry.registerComponent(appName, () => App);
